import * as z from "zod";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { account } from "chat-assistant";

/**
 * MCP tool layer over the account service (which proxies trading-api). The
 * service is injectable so tests can substitute a stub.
 */
export function createTradingMcpServer({ service = account } = {}) {
  const server = new McpServer({
    name: "fake-stock-trading-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "get_portfolio_summary",
    {
      description:
        "Get the current portfolio summary: cash, invested amount (cost basis), gains/losses, holdings, and total equity.",
      inputSchema: {},
    },
    async () => {
      const summary = await service.getPortfolioSummary();
      const payload = { account: summary.account };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
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
      const quote = await service.getQuote();
      const payload = {
        symbol: quote.symbol,
        price: quote.price,
        history: quote.history.slice(-30),
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
      const quote = await service.getQuote();
      const tradeValue = Number(quantity) * Number(quote?.price ?? 0);
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

      const result = await service.buy(quantity);
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
      const quote = await service.getQuote();
      const tradeValue = Number(quantity) * Number(quote?.price ?? 0);
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

      const result = await service.sell(quantity);
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
      const result = await service.transfer(amount);
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
      const quote = await service.getQuote();
      const tradeValue = Number(quantity) * Number(quote?.price ?? 0);
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

      const result = await service.placeOrder({ type, side, quantity, price });
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
      const result = await service.listOrders();
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
      const result = await service.cancelOrder(orderId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

export async function startTradingMcpServer(options = {}) {
  const server = createTradingMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  account
    .init()
    .then(() => startTradingMcpServer())
    .then(() => {
      console.log("Fake stock MCP server running on stdio");
    })
    .catch((error) => {
      console.error("Failed to start fake stock MCP server:", error);
      process.exit(1);
    });
}
