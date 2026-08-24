import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { WebSocketServer } from "ws";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadStateFromFile, saveStateToFile } from "./storage.js";
import { createTradingMcpServer } from "./mcp/index.js";
import {
  getAssistantResponse,
  normalizeTradeQuantity,
} from "./llm/assistant.js";
import {
  createInitialState,
  buyStock,
  sellStock,
  transferCash,
  tickMarket,
  placeOrder,
  cancelOrder,
  listOrders,
  getPortfolioSummary,
} from "./trading/engine.js";

const stateFile = path.resolve(process.cwd(), "data", "state.json");
const existingState = loadStateFromFile(stateFile) ?? createInitialState();
const state = existingState;
const pendingConfirmations = new Map();

function requiresConfirmationForTradeValue(quantity, price) {
  const qty = Number(quantity);
  const tradeValue = Number(qty) * Number(price ?? 0);
  return (
    Number.isFinite(qty) &&
    qty > 0 &&
    (qty >= 10 || (Number.isFinite(tradeValue) && tradeValue >= 1000))
  );
}

function buildChatResponse(plan, payload, fallbackText) {
  const tool = plan?.tool;

  if (tool === null) {
    return {
      plan,
      payload: null,
      text:
        plan?.fallback ??
        fallbackText ??
        "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.",
    };
  }

  if (!tool) {
    return {
      plan: { tool: "get_account_snapshot", arguments: {} },
      payload: getPortfolioSummary(state),
      text:
        fallbackText ??
        "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.",
    };
  }

  if (tool === "get_account_snapshot") {
    return {
      plan,
      payload: getPortfolioSummary(state),
      text: `Portfolio snapshot: cash $${Number(state.account.cashAvailable ?? 0).toFixed(2)}, holdings ${state.account.holdings}, invested $${Number(state.account.costBasis ?? 0).toFixed(2)}, total equity $${Number(state.account.totalEquity ?? 0).toFixed(2)}, gains/losses $${Number(getPortfolioSummary(state).totalGainsLosses ?? 0).toFixed(2)}.`,
    };
  }

  if (tool === "get_quote") {
    return {
      plan,
      payload: {
        symbol: state.symbol,
        price: state.price,
        history: state.history.slice(-30),
      },
      text: `Current FAKE price: $${Number(state.price ?? 0).toFixed(2)}.`,
    };
  }

  if (tool === "buy_stock") {
    let quantity = normalizeTradeQuantity(plan.arguments?.quantity);
    const amount = Number(plan.arguments?.amount ?? 0);
    const confirmed = plan.arguments?.confirm === true;

    if (!quantity) {
      return {
        plan,
        payload: {
          error: "A quantity of at least 1 share is required to buy.",
        },
        text: "A quantity of at least 1 share is required to buy. For example, say 'buy 2 shares'.",
      };
    }

    // If the assistant supplied a dollar `amount`, compute whole-share quantity using the live price
    if (amount > 0) {
      const computed = Math.floor(amount / Number(state.price ?? 0));
      if (computed <= 0) {
        return {
          plan,
          payload: {
            error: `At the current price of $${Number(state.price ?? 0).toFixed(2)}, $${amount.toFixed(2)} would buy 0 whole shares. Increase the amount or say 'buy 1 share' to proceed.`,
          },
          text: `At the current price of $${Number(state.price ?? 0).toFixed(2)}, $${amount.toFixed(2)} would buy 0 whole shares. Increase the amount or say 'buy 1 share' to proceed.`,
        };
      }
      quantity = computed;
    }

    const pricePerShare = Number(state.price ?? 0);
    const tradeValue = quantity * pricePerShare;

    if (!confirmed && tradeValue >= 1000) {
      const id = randomUUID();
      pendingConfirmations.set(id, {
        tool,
        arguments: { ...(plan.arguments ?? {}) },
      });
      const requestedAmount = Number(plan.arguments?.amount ?? 0);
      let pendingMessage = `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`;
      if (requestedAmount > 0) {
        const executedAmount = quantity * pricePerShare;
        const remainder = requestedAmount - executedAmount;
        pendingMessage = `Requested $${requestedAmount.toFixed(2)}; at $${pricePerShare.toFixed(2)} per share you can buy ${quantity} shares for $${executedAmount.toFixed(2)}${remainder > 0 ? ` (remainder $${remainder.toFixed(2)} not spent)` : ""}. Please confirm before executing.`;
      }

      return {
        plan,
        payload: {
          requiresConfirmation: true,
          confirmationId: id,
          message: pendingMessage,
          quantity,
          value: tradeValue,
          pricePerShare,
        },
        text: pendingMessage,
      };
    }

    // confirmed or not requiring confirmation -> proceed
    try {
      const result = buyStock(state, quantity);
      saveStateToFile(stateFile, state);
      const executedAmount = Number(result.quantity) * pricePerShare;
      const requestedAmount = Number(plan.arguments?.amount ?? 0);
      const remainder =
        requestedAmount > 0
          ? Math.max(0, requestedAmount - executedAmount)
          : null;
      const execText =
        requestedAmount > 0
          ? `Bought ${result.quantity} shares at $${pricePerShare.toFixed(2)} for $${executedAmount.toFixed(2)}${remainder > 0 ? `; $${remainder.toFixed(2)} could not buy another whole share and remains in cash.` : " (exact)."}`
          : `Buy order completed for ${result.quantity} shares. Cash remaining: $${Number(result.cashAvailable ?? 0).toFixed(2)}.`;

      return {
        plan,
        payload: { ...result, executedAmount, pricePerShare, remainder },
        text: execText,
      };
    } catch (error) {
      return {
        plan,
        payload: { error: error?.message ?? String(error) },
        text: error?.message ?? String(error),
      };
    }
  }

  if (tool === "sell_stock") {
    let quantity = normalizeTradeQuantity(plan.arguments?.quantity);
    const amount = Number(plan.arguments?.amount ?? 0);
    const confirmed = plan.arguments?.confirm === true;

    if (!quantity) {
      return {
        plan,
        payload: {
          error: "A quantity of at least 1 share is required to sell.",
        },
        text: "A quantity of at least 1 share is required to sell. For example, say 'sell 2 shares'.",
      };
    }

    if (amount > 0) {
      const computed = Math.floor(amount / Number(state.price ?? 0));
      if (computed <= 0) {
        return {
          plan,
          payload: {
            error: `At the current price of $${Number(state.price ?? 0).toFixed(2)}, $${amount.toFixed(2)} would sell 0 whole shares. Increase the amount or specify a quantity to proceed.`,
          },
          text: `At the current price of $${Number(state.price ?? 0).toFixed(2)}, $${amount.toFixed(2)} would sell 0 whole shares. Increase the amount or specify a quantity to proceed.`,
        };
      }
      quantity = computed;
    }

    const pricePerShare = Number(state.price ?? 0);
    const tradeValue = quantity * pricePerShare;

    if (!confirmed && tradeValue >= 1000) {
      const id = randomUUID();
      pendingConfirmations.set(id, {
        tool,
        arguments: { ...(plan.arguments ?? {}) },
      });
      const requestedAmount = Number(plan.arguments?.amount ?? 0);
      let pendingMessage = `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`;
      if (requestedAmount > 0) {
        const executedAmount = quantity * pricePerShare;
        const remainder = requestedAmount - executedAmount;
        pendingMessage = `Requested $${requestedAmount.toFixed(2)}; at $${pricePerShare.toFixed(2)} per share you can sell ${quantity} shares for $${executedAmount.toFixed(2)}${remainder > 0 ? ` (remainder $${remainder.toFixed(2)} not sold)` : ""}. Please confirm before executing.`;
      }

      return {
        plan,
        payload: {
          requiresConfirmation: true,
          confirmationId: id,
          message: pendingMessage,
          quantity,
          value: tradeValue,
          pricePerShare,
        },
        text: pendingMessage,
      };
    }
    // proceed
    try {
      const result = sellStock(state, quantity);
      saveStateToFile(stateFile, state);
      const executedAmount = Number(result.quantity) * pricePerShare;
      const requestedAmount = Number(plan.arguments?.amount ?? 0);
      const remainder =
        requestedAmount > 0
          ? Math.max(0, requestedAmount - executedAmount)
          : null;
      const execText =
        requestedAmount > 0
          ? `Sold ${result.quantity} shares at $${pricePerShare.toFixed(2)} for $${executedAmount.toFixed(2)}${remainder > 0 ? `; $${remainder.toFixed(2)} could not be sold as whole shares.` : " (exact)."}`
          : `Sell order completed for ${result.quantity} shares. Cash balance: $${Number(result.cashAvailable ?? 0).toFixed(2)}.`;

      return {
        plan,
        payload: { ...result, executedAmount, pricePerShare, remainder },
        text: execText,
      };
    } catch (error) {
      return {
        plan,
        payload: { error: error?.message ?? String(error) },
        text: error?.message ?? String(error),
      };
    }
  }

  if (tool === "transfer_cash") {
    const amount = Number(plan.arguments?.amount ?? 0);
    const result = transferCash(state, amount);
    saveStateToFile(stateFile, state);
    return {
      plan,
      payload: result,
      text: `Cash transfer processed. Available cash is now $${Number(result.cashAvailable ?? 0).toFixed(2)}.`,
    };
  }

  if (tool === "place_order") {
    const orderType = String(plan.arguments?.type ?? "limit").toLowerCase();
    const orderSide = String(plan.arguments?.side ?? "buy").toLowerCase();
    const quantity = normalizeTradeQuantity(plan.arguments?.quantity);
    const triggerPrice = Number(plan.arguments?.price ?? 0);
    const confirmed = plan.arguments?.confirm === true;

    if (!quantity) {
      return {
        plan,
        payload: { error: "A quantity of at least 1 share is required." },
        text: "A quantity of at least 1 share is required for this order. For example, say 'limit buy 2 shares at $95'.",
      };
    }

    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
      return {
        plan,
        payload: { error: "A trigger price greater than $0 is required." },
        text: "A trigger price greater than $0 is required.",
      };
    }

    const tradeValue = quantity * Number(state.price ?? 0);

    if (!confirmed && tradeValue >= 1000) {
      const id = randomUUID();
      pendingConfirmations.set(id, {
        tool,
        arguments: {
          ...(plan.arguments ?? {}),
        },
      });
      return {
        plan,
        payload: {
          requiresConfirmation: true,
          confirmationId: id,
          message: `This ${orderType} ${orderSide} order is worth $${tradeValue.toFixed(2)} at the current price. Please confirm before placing it.`,
          quantity,
          value: tradeValue,
          pricePerShare: Number(state.price ?? 0),
        },
        text: `This ${orderType} ${orderSide} order is worth $${tradeValue.toFixed(2)} at the current price. Please confirm before placing it.`,
      };
    }

    try {
      const result = placeOrder(state, {
        type: orderType,
        side: orderSide,
        quantity,
        price: triggerPrice,
      });
      saveStateToFile(stateFile, state);
      return {
        plan,
        payload: result,
        text: `${orderType} ${orderSide} order placed for ${result.quantity} shares at $${Number(result.price ?? 0).toFixed(2)}.`,
      };
    } catch (error) {
      return {
        plan,
        payload: { error: error?.message ?? String(error) },
        text: error?.message ?? String(error),
      };
    }
  }

  if (tool === "list_orders") {
    const filterType = String(plan.arguments?.type ?? "").toLowerCase();
    const filterSide = String(plan.arguments?.side ?? "").toLowerCase();
    const orders = listOrders(state).orders.filter(
      (order) =>
        order.status === "open" &&
        (!filterType || order.type === filterType) &&
        (!filterSide || order.kind === filterSide),
    );
    return {
      plan,
      payload: { orders },
      text: orders.length
        ? `Open orders: ${orders.map((order) => `${order.type} ${order.kind} ${order.quantity} @ $${Number(order.price ?? 0).toFixed(2)} (${order.status})`).join(", ")}.`
        : "There are no current open orders.",
    };
  }

  if (tool === "cancel_order") {
    const result = cancelOrder(state, plan.arguments?.orderId ?? "pending");
    saveStateToFile(stateFile, state);
    return {
      plan,
      payload: result,
      text:
        result?.status === "cancelled"
          ? `Canceled order ${plan.arguments?.orderId ?? "the selected order"}.`
          : "I could not cancel that order.",
    };
  }

  return {
    plan,
    payload: getPortfolioSummary(state),
    text:
      fallbackText ??
      "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.",
  };
}

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

async function handleChatRequest(req, res) {
  try {
    const message = String(req.body?.message ?? "").trim();

    // Allow requests that perform an action (confirm/cancel) without a textual `message`.
    if (!message && !req.body?.action) {
      res.status(400).json({ error: "A message is required." });
      return;
    }

    // Special client message to cancel or confirm a pending human confirmation
    // Expect JSON actions: { action: 'cancel', confirmationId } or { action: 'confirm', confirmationId }
    if (req.body?.action === "cancel" || req.body?.action === "confirm") {
      const action = req.body.action;
      const confirmationId = req.body.confirmationId;

      if (!confirmationId || !pendingConfirmations.has(confirmationId)) {
        res.json({
          plan: { tool: null, arguments: {} },
          text: "There is no pending trade with that confirmationId.",
        });
        return;
      }

      if (action === "cancel") {
        pendingConfirmations.delete(confirmationId);
        res.json({
          plan: { tool: null, arguments: {} },
          text: "Cancelled pending trade.",
        });
        return;
      }

      // action === 'confirm'
      const pending = pendingConfirmations.get(confirmationId);
      pendingConfirmations.delete(confirmationId);
      const confirmationPlan = {
        tool: pending.tool,
        arguments: {
          ...(pending.arguments ?? {}),
          confirm: true,
        },
      };

      const executed = buildChatResponse(confirmationPlan, null, "");
      res.json({ ...executed, text: executed.text });
      return;
    }

    const confirmationPrompt =
      pendingConfirmations.size > 0 &&
      /(^|\s)(confirm|confirmed|accepted|accept|yes|proceed|go ahead|approve|approved|execute)(\s|$)/.test(
        message.toLowerCase(),
      );

    const response = await getAssistantResponse(
      confirmationPrompt ? message : message,
      {
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/api",
        fetchFn: globalThis.fetch,
        pricePerShare: state.price,
        // If the user replied with a confirmation-like phrase, pass the most recent pending confirmation
        pendingTool: confirmationPrompt
          ? Array.from(pendingConfirmations.values()).slice(-1)[0]
          : undefined,
      },
    );

    const plan = response?.plan ?? {
      tool: "get_account_snapshot",
      arguments: {},
    };
    // If this was a natural-language confirmation and the assistant produced a plan
    // that includes `confirm: true`, clear the most-recent pending confirmation entry.
    if (
      confirmationPrompt &&
      plan?.arguments?.confirm === true &&
      pendingConfirmations.size > 0
    ) {
      const lastId = Array.from(pendingConfirmations.keys()).slice(-1)[0];
      if (lastId) pendingConfirmations.delete(lastId);
    }
    const fallbackText =
      response?.text ??
      "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.";

    const executed = buildChatResponse(plan, null, fallbackText);
    res.json({
      ...response,
      ...executed,
      text: executed.text,
    });
  } catch (error) {
    console.error("Assistant route error:", error);
    res.status(500).json({
      plan: { tool: "get_account_snapshot", arguments: {} },
      text: "I can help with portfolio checks, price quotes, buys, sells, limit and stop orders, deposits, withdrawals, and order cancellations.",
    });
  }
}

app.post("/api/assistant", handleChatRequest);

app.get("/api/snapshot", (req, res) => {
  res.json({
    snapshot: getPortfolioSummary(state),
    price: state.price,
    account: state.account,
    history: state.history,
    orders: listOrders(state).orders,
  });
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
      const serverInstance = createTradingMcpServer({ state });
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

function buildSnapshot() {
  return {
    type: "snapshot",
    payload: getPortfolioSummary(state),
  };
}

setInterval(() => {
  const nextPrice = tickMarket(state);
  saveStateToFile(stateFile, state);
  broadcast({
    type: "market-tick",
    payload: {
      price: nextPrice,
      history: state.history,
      account: state.account,
      orders: listOrders(state).orders,
    },
  });
  broadcast(buildSnapshot());
}, 15000);

wss.on("connection", (ws) => {
  ws.send(JSON.stringify(buildSnapshot()));

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      const pricePerShare = Number(state.price ?? 0);

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
          requiresConfirmationForTradeValue(quantity, state.price) &&
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
          const result = buyStock(state, quantity);
          saveStateToFile(stateFile, state);
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

        broadcast(buildSnapshot());
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
          requiresConfirmationForTradeValue(quantity, state.price) &&
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
          const result = sellStock(state, quantity);
          saveStateToFile(stateFile, state);
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

        broadcast(buildSnapshot());
        return;
      }

      if (data.type === "transfer") {
        const updated = transferCash(state, data.amount ?? 0);
        saveStateToFile(stateFile, state);
        broadcast(buildSnapshot());
        ws.send(
          JSON.stringify({
            type: "trade-result",
            success: true,
            payload: updated,
          }),
        );
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
          requiresConfirmationForTradeValue(quantity, state.price) &&
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

        const updated = placeOrder(state, {
          type: orderType,
          side: orderSide,
          quantity,
          price: orderPrice,
        });
        saveStateToFile(stateFile, state);
        broadcast(buildSnapshot());
        ws.send(
          JSON.stringify({
            type: "trade-result",
            success: true,
            payload: updated,
          }),
        );
        return;
      }

      if (data.type === "cancel_order") {
        const updated = cancelOrder(state, data.orderId);
        saveStateToFile(stateFile, state);
        broadcast(buildSnapshot());
        ws.send(
          JSON.stringify({
            type: "trade-result",
            success: true,
            payload: updated,
          }),
        );
        return;
      }

      if (data.type === "list_orders") {
        ws.send(JSON.stringify({ type: "orders", payload: listOrders(state) }));
        return;
      }

      if (data.type === "get_snapshot") {
        ws.send(JSON.stringify(buildSnapshot()));
        return;
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", error: error.message }));
    }
  });
});

server.listen(3001, "0.0.0.0", () => {
  console.log("Fake stock market server running at ws://localhost:3001");
  saveStateToFile(stateFile, state);
});
