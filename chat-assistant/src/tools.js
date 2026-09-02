/**
 * Single source of truth for the assistant's tool names and JSON Schema
 * definitions.
 *
 * Leaf module (no imports) so both chat.js and llm.js can consume it without
 * creating an import cycle. TOOL_NAMES follows the Object.freeze enum
 * convention used by MARKET_PARAMS in trading/account.js; the TOOLS schemas
 * mirror the exact `arguments` shapes buildChatResponse reads for each tool.
 */

export const TOOL_NAMES = Object.freeze({
  getPortfolioSummary: "get_portfolio_summary",
  getQuote: "get_quote",
  buyStock: "buy_stock",
  sellStock: "sell_stock",
  transferCash: "transfer_cash",
  placeOrder: "place_order",
  listOrders: "list_orders",
  cancelOrder: "cancel_order",
});

const wholeShares = (verb) => ({
  type: "integer",
  minimum: 1,
  description: `Number of whole shares to ${verb} (at least 1).`,
});

const dollarAmount = (description) => ({
  type: "number",
  description,
});

const confirmFlag = {
  type: "boolean",
  description:
    "Set to true only when the human user has explicitly confirmed the pending action (a trade worth $1,000 or more, or a cash transfer of $500 or more).",
};

export const TOOLS = [
  {
    type: "function",
    function: {
      name: TOOL_NAMES.getPortfolioSummary,
      description:
        "Get a summary of the user's portfolio: cash available, amount invested, gains/losses, holdings count, and total equity.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_NAMES.getQuote,
      description:
        "Get the current FAKE stock price, symbol, and recent price history.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_NAMES.buyStock,
      description:
        "Buy whole shares of FAKE at the current price. Provide `quantity`, or an `amount` in dollars that is converted to whole shares at the live price.",
      parameters: {
        type: "object",
        properties: {
          quantity: wholeShares("buy"),
          amount: dollarAmount(
            "Optional dollar amount to spend; converted to whole shares at the live price.",
          ),
          confirm: confirmFlag,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_NAMES.sellStock,
      description:
        "Sell whole shares of FAKE at the current price. Provide `quantity`, or an `amount` in dollars that is converted to whole shares at the live price.",
      parameters: {
        type: "object",
        properties: {
          quantity: wholeShares("sell"),
          amount: dollarAmount(
            "Optional dollar amount of shares to sell; converted to whole shares at the live price.",
          ),
          confirm: confirmFlag,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_NAMES.transferCash,
      description:
        "Deposit cash into or withdraw cash from the user's account. Positive amounts deposit; negative amounts withdraw.",
      parameters: {
        type: "object",
        properties: {
          amount: dollarAmount(
            "Dollar amount to move. Positive deposits cash; negative withdraws cash.",
          ),
          confirm: confirmFlag,
        },
        required: ["amount"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_NAMES.placeOrder,
      description:
        "Place a conditional limit or stop order on FAKE. Never use this to list or check existing orders.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["limit", "stop"],
            description: "Order type: limit or stop.",
          },
          side: {
            type: "string",
            enum: ["buy", "sell"],
            description: "Order side: buy or sell.",
          },
          quantity: wholeShares("trade"),
          price: dollarAmount("Trigger price in dollars."),
          confirm: confirmFlag,
        },
        required: ["type", "side", "quantity", "price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_NAMES.listOrders,
      description:
        "List the user's current open orders. Optional `type` (limit/stop) and `side` (buy/sell) filters.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["limit", "stop"],
            description: "Optional filter: only orders of this type.",
          },
          side: {
            type: "string",
            enum: ["buy", "sell"],
            description: "Optional filter: only orders of this side.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: TOOL_NAMES.cancelOrder,
      description:
        "Cancel an existing order by id. Defaults to the user's pending order when no orderId is given.",
      parameters: {
        type: "object",
        properties: {
          orderId: {
            type: "string",
            description:
              "Id of the order to cancel. Defaults to the pending order.",
          },
        },
      },
    },
  },
];
