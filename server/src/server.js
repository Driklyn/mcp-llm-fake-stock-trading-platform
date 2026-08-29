import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { WebSocketServer } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTradingMcpServer } from "./mcp/index.js";
import {
  account,
  createAssistant,
  createMemoryPendingStore,
  isCloudMode,
  requiresConfirmationForTradeValue,
} from "chat-assistant";

// The server is a stateless proxy over the deployed trading-api ledger
// (infra/lambdas/trading-api). There is no local account state anymore —
// every read and mutation is delegated to TRADING_API_URL.
if (!isCloudMode()) {
  console.error(
    "TRADING_API_URL is not set. Point it at the deployed trading-api base URL " +
      "(terraform output `trading_api_base_url`, e.g. https://dxxxx.cloudfront.net).",
  );
  process.exit(1);
}

await account.init();
const pendingStore = createMemoryPendingStore();
const assistant = createAssistant({
  account,
  pendingStore,
  llm: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/api",
    fetchFn: globalThis.fetch,
  },
});
const { currentPrice } = assistant;

const app = express();
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, mcp-session-id, mcp-protocol-version, Authorization",
  );
  res.header(
    "Access-Control-Expose-Headers",
    "mcp-session-id, mcp-protocol-version",
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const transports = new Map();

app.post("/api/assistant", async (req, res) => {
  try {
    const { status, body } = await assistant.handleRequest(req.body ?? {});
    res.status(status).json(body);
  } catch (error) {
    console.error("Assistant route error:", error);
    res.status(500).json({
      plan: { tool: "get_account_snapshot", arguments: {} },
      text: "I can help with portfolio checks, price quotes, buys, sells, limit and stop orders, deposits, withdrawals, and order cancellations.",
    });
  }
});

app.get("/api/snapshot", async (req, res) => {
  try {
    const summary = await account.getPortfolioSummary({ force: true });
    res.json({
      ...summary,
      marketParams: account.getMarketParams(),
    });
  } catch (error) {
    res.status(503).json({ error: error?.message ?? String(error) });
  }
});

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    const isInitialize = req.body && req.body.method === "initialize";

    let transport;
    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitialize) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
        },
      });
      const serverInstance = createTradingMcpServer();
      await serverInstance.connect(transport);
      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };
      await transport.handleRequest(req, res, req.body);
      return;
    } else if (sessionId && !transports.has(sessionId)) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: invalid session ID" },
        id: null,
      });
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session ID" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP POST error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports.get(sessionId);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("MCP GET error:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing SSE request");
    }
  }
});

app.delete("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports.get(sessionId);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("MCP DELETE error:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
});

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) {
      ws.send(message);
    }
  }
}

async function buildSnapshot() {
  const summary = await account.getPortfolioSummary();
  return {
    type: "snapshot",
    payload: {
      ...summary,
      marketParams: account.getMarketParams(),
    },
  };
}

let marketAdvanceInFlight = false;
let lastTickedPrice = null;

async function runMarketAdvance() {
  if (marketAdvanceInFlight) return;
  marketAdvanceInFlight = true;
  try {
    const snapshot = await buildSnapshot();
    const price = Number(snapshot.payload.price ?? 0);
    if (lastTickedPrice === null || price !== lastTickedPrice) {
      lastTickedPrice = price;
      broadcast({
        type: "market-tick",
        payload: {
          price,
          history: snapshot.payload.history,
          account: snapshot.payload.account,
          orders: snapshot.payload.orders,
        },
      });
    }
    broadcast(snapshot);
  } catch (error) {
    console.error("Market refresh failed:", error);
  } finally {
    marketAdvanceInFlight = false;
  }
}

setInterval(runMarketAdvance, 15000);

wss.on("connection", async (ws) => {
  try {
    ws.send(JSON.stringify(await buildSnapshot()));
  } catch (error) {
    ws.send(
      JSON.stringify({ type: "error", error: error?.message ?? String(error) }),
    );
  }

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
      const pricePerShare = await currentPrice();

      if (data.type === "buy") {
        let quantity = Number(data.quantity ?? 1);
        const amount = Number(data.amount ?? 0);
        const confirmed = data.confirm === true;

        if (amount > 0) {
          const computed = Math.floor(amount / pricePerShare);
          if (computed <= 0) {
            ws.send(
              JSON.stringify({
                type: "trade-result",
                success: false,
                payload: {
                  error: `At the current price of $${pricePerShare.toFixed(2)}, $${amount.toFixed(2)} would buy 0 whole shares.`,
                },
              }),
            );
            return;
          }
          quantity = computed;
        }

        const tradeValue = quantity * pricePerShare;
        if (
          requiresConfirmationForTradeValue(quantity, pricePerShare) &&
          !confirmed
        ) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: {
                requiresConfirmation: true,
                message: `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`,
                quantity,
                value: tradeValue,
              },
            }),
          );
          return;
        }

        try {
          const result = await account.buy(quantity);
          const executedAmount = Number(result.quantity) * pricePerShare;
          const remainder =
            amount > 0 ? Math.max(0, amount - executedAmount) : null;
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: true,
              payload: { ...result, executedAmount, pricePerShare, remainder },
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: { error: err.message },
            }),
          );
        }

        broadcast(await buildSnapshot());
        return;
      }

      if (data.type === "sell") {
        let quantity = Number(data.quantity ?? 1);
        const amount = Number(data.amount ?? 0);
        const confirmed = data.confirm === true;

        if (amount > 0) {
          const computed = Math.floor(amount / pricePerShare);
          if (computed <= 0) {
            ws.send(
              JSON.stringify({
                type: "trade-result",
                success: false,
                payload: {
                  error: `At the current price of $${pricePerShare.toFixed(2)}, $${amount.toFixed(2)} would sell 0 whole shares.`,
                },
              }),
            );
            return;
          }
          quantity = computed;
        }

        const tradeValue = quantity * pricePerShare;
        if (
          requiresConfirmationForTradeValue(quantity, pricePerShare) &&
          !confirmed
        ) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: {
                requiresConfirmation: true,
                message: `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`,
                quantity,
                value: tradeValue,
              },
            }),
          );
          return;
        }

        try {
          const result = await account.sell(quantity);
          const executedAmount = Number(result.quantity) * pricePerShare;
          const remainder =
            amount > 0 ? Math.max(0, amount - executedAmount) : null;
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: true,
              payload: { ...result, executedAmount, pricePerShare, remainder },
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: { error: err.message },
            }),
          );
        }

        broadcast(await buildSnapshot());
        return;
      }

      if (data.type === "transfer") {
        try {
          const updated = await account.transfer(data.amount ?? 0);
          broadcast(await buildSnapshot());
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: true,
              payload: updated,
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: { error: err.message },
            }),
          );
        }
        return;
      }

      if (data.type === "place_order") {
        const orderType = String(data.orderType ?? "").toLowerCase();
        const orderSide = String(data.side ?? "buy").toLowerCase();
        const quantity = Number(data.quantity ?? 1);
        const orderPrice = Number(data.price ?? 0);
        const confirmed = data.confirm === true;

        if (!["limit", "stop"].includes(orderType) || !orderType) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: { error: "Order type must be 'limit' or 'stop'." },
            }),
          );
          return;
        }

        if (!Number.isFinite(orderPrice) || orderPrice <= 0) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: {
                error: "A trigger price greater than $0 is required.",
              },
            }),
          );
          return;
        }

        const tradeValue = quantity * pricePerShare;
        if (
          requiresConfirmationForTradeValue(quantity, pricePerShare) &&
          !confirmed
        ) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: {
                requiresConfirmation: true,
                message: `This ${orderType} ${orderSide} order is worth $${tradeValue.toFixed(2)} at the current price. Please confirm before placing it.`,
                quantity,
                value: tradeValue,
              },
            }),
          );
          return;
        }

        try {
          const updated = await account.placeOrder({
            type: orderType,
            side: orderSide,
            quantity,
            price: orderPrice,
          });
          broadcast(await buildSnapshot());
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: true,
              payload: updated,
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: { error: err.message },
            }),
          );
        }
        return;
      }

      if (data.type === "cancel_order") {
        try {
          const updated = await account.cancelOrder(data.orderId);
          broadcast(await buildSnapshot());
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: true,
              payload: updated,
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "trade-result",
              success: false,
              payload: { error: err.message },
            }),
          );
        }
        return;
      }

      if (data.type === "list_orders") {
        ws.send(
          JSON.stringify({
            type: "orders",
            payload: await account.listOrders(),
          }),
        );
        return;
      }

      if (data.type === "get_snapshot") {
        ws.send(JSON.stringify(await buildSnapshot()));
        return;
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", error: error.message }));
    }
  });
});

server.listen(3001, "0.0.0.0", () => {
  console.log("Fake stock market server running at ws://localhost:3001");
});



