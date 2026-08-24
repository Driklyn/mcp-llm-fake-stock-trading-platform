import * as z from "zod";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  buyStock,
  cancelOrder,
  createInitialState,
  getPortfolioSummary,
  listOrders,
  placeOrder,
  sellStock,
  transferCash,
} from "../trading/engine.js";

export function createTradingMcpServer({ state }) {
  const server = new McpServer({
    name: "fake-stock-trading-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "get_account_snapshot",
    {
      description:
        "Get the current account snapshot, including cash, holdings, cost basis, realized gains, unrealized gains/losses, and total equity.",
      inputSchema: {},
    },
    async () => {
      const summary = getPortfolioSummary(state);
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary,
      };
    },
  );

  server.registerTool(
    "get_quote",
    {
      description: "Get the current FAKE stock price and recent history.",
      inputSchema: {},
    },
    async () => {
      const payload = {
        symbol: "FAKE",
        price: state.price,
        history: state.history.slice(-30),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "buy_stock",
    {
      description: "Buy FAKE shares immediately using available cash.",
      inputSchema: {
        quantity: z
          .number()
          .int()
          .positive()
          .describe("Number of FAKE shares to buy."),
        confirm: z
          .boolean()
          .optional()
          .describe("Set to true only after a human confirms large trades."),
      },
    },
    async ({ quantity, confirm = false }) => {
      const tradeValue = Number(quantity) * Number(state.price ?? 0);
      if (tradeValue >= 1000 && confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  requiresConfirmation: true,
                  message: `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`,
                  quantity,
                  value: tradeValue,
                },
                null,
                2,
              ),
            },
          ],
          structuredContent: {
            requiresConfirmation: true,
            message: `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`,
            quantity,
            value: tradeValue,
          },
        };
      }

      const result = buyStock(state, quantity);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "sell_stock",
    {
      description: "Sell FAKE shares immediately into cash.",
      inputSchema: {
        quantity: z
          .number()
          .int()
          .positive()
          .describe("Number of FAKE shares to sell."),
        confirm: z
          .boolean()
          .optional()
          .describe("Set to true only after a human confirms large trades."),
      },
    },
    async ({ quantity, confirm = false }) => {
      const tradeValue = Number(quantity) * Number(state.price ?? 0);
      if (tradeValue >= 1000 && confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  requiresConfirmation: true,
                  message: `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`,
                  quantity,
                  value: tradeValue,
                },
                null,
                2,
              ),
            },
          ],
          structuredContent: {
            requiresConfirmation: true,
            message: `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`,
            quantity,
            value: tradeValue,
          },
        };
      }

      const result = sellStock(state, quantity);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "transfer_cash",
    {
      description: "Transfer fake cash into or out of the account.",
      inputSchema: {
        amount: z
          .number()
          .positive()
          .describe("Positive dollar amount to transfer."),
      },
    },
    async ({ amount }) => {
      const result = transferCash(state, amount);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "place_order",
    {
      description:
        "Place a limit or stop order for FAKE shares. Limit buy executes when the price falls to or below the limit price; limit sell executes when the price rises to or above it. Stop buy executes when the price rises to or above the stop price; stop sell executes when the price falls to or below it.",
      inputSchema: {
        type: z
          .enum(["limit", "stop"])
          .describe("Order type: 'limit' or 'stop'."),
        side: z.enum(["buy", "sell"]).describe("Trade side: 'buy' or 'sell'."),
        quantity: z
          .number()
          .int()
          .positive()
          .describe("Number of FAKE shares to trade."),
        price: z
          .number()
          .positive()
          .describe("Trigger price at which the order executes."),
        confirm: z
          .boolean()
          .optional()
          .describe("Set to true only after a human confirms large orders."),
      },
    },
    async ({ type, side, quantity, price, confirm = false }) => {
      const tradeValue = Number(quantity) * Number(state.price ?? 0);
      if (tradeValue >= 1000 && confirm !== true) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  requiresConfirmation: true,
                  message: `This order is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`,
                  quantity,
                  value: tradeValue,
                },
                null,
                2,
              ),
            },
          ],
          structuredContent: {
            requiresConfirmation: true,
            message: `This order is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`,
            quantity,
            value: tradeValue,
          },
        };
      }

      const result = placeOrder(state, { type, side, quantity, price });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "list_orders",
    {
      description: "List pending and completed trading orders.",
      inputSchema: {},
    },
    async () => {
      const result = listOrders(state);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "cancel_order",
    {
      description: "Cancel an open limit or stop order.",
      inputSchema: {
        orderId: z.string().describe("The order identifier to cancel."),
      },
    },
    async ({ orderId }) => {
      const result = cancelOrder(state, orderId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

export async function startTradingMcpServer({ state }) {
  const server = createTradingMcpServer({ state });
  await server.connect(new StdioServerTransport());
  return server;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const state = createInitialState();
  startTradingMcpServer({ state })
    .then(() => {
      console.log("Fake stock MCP server running on stdio");
    })
    .catch((error) => {
      console.error("Failed to start fake stock MCP server:", error);
      process.exit(1);
    });
}
