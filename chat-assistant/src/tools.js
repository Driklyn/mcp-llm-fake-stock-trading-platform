/**
 * Single source of truth for the assistant's tool names, JSON Schema
 * definitions, and the shared argument semantics they rely on.
 *
 * Leaf module (no imports) so chat.js, llm.js, and the MCP server can all
 * consume it without creating an import cycle. TOOL_NAMES follows the
 * Object.freeze enum convention used by MARKET_PARAMS in trading/account.js.
 *
 * TOOL_SCHEMAS is the descriptive JSON Schema surface (the `parameters` the LLM
 * planner is shown), while TOOL_DEFINITIONS collects the same primitives by
 * execution semantics so a missing argument cannot drift between hosts.
 * {@link toZodShape} turns those definitions into the Zod shape the MCP server
 * validates against, so the guardrails and the agent share one definition.
 */

import * as z from "zod";

export const TOOL_NAMES = Object.freeze({
  getPortfolioSummary: "get_portfolio_summary",
  getQuote: "get_quote",
  buyStock: "buy_stock",
  sellStock: "sell_stock",
  transferCash: "transfer_cash",
  placeOrder: "place_order",
  listOrders: "list_orders",
  cancelOrder: "cancel_order",
  resolveConfirmation: "resolve_confirmation",
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
    "Set to true only when the user has explicitly confirmed the pending action (a trade of 10 shares or more, a trade worth $1,000 or more, or a cash transfer of $500 or more).",
};

const orderTypeProperty = (description) => ({
  type: "string",
  enum: ["limit", "stop"],
  description,
});

const orderSideProperty = (description) => ({
  type: "string",
  enum: ["buy", "sell"],
  description,
});

/**
 * The descriptive JSON Schema surface consumed by the LLM planner. Definitions
 * are keyed by tool name so both hosts render identical parameter shapes.
 */
export const TOOL_SCHEMAS = Object.freeze({
  [TOOL_NAMES.getPortfolioSummary]: {
    description:
      "Get a summary of the user's portfolio: cash available, amount invested, gains/losses, holdings count, and total equity.",
    parameters: { type: "object", properties: {} },
  },
  [TOOL_NAMES.getQuote]: {
    description:
      "Get the current FAKE stock price, symbol, and recent price history.",
    parameters: { type: "object", properties: {} },
  },
  [TOOL_NAMES.buyStock]: {
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
  [TOOL_NAMES.sellStock]: {
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
  [TOOL_NAMES.transferCash]: {
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
  [TOOL_NAMES.placeOrder]: {
    description:
      "Place a conditional limit or stop order on FAKE. Never use this to list or check existing orders.",
    parameters: {
      type: "object",
      properties: {
        type: orderTypeProperty("Order type: limit or stop."),
        side: orderSideProperty("Order side: buy or sell."),
        quantity: wholeShares("trade"),
        price: dollarAmount("Trigger price in dollars."),
        confirm: confirmFlag,
      },
      required: ["type", "side", "quantity", "price"],
    },
  },
  [TOOL_NAMES.listOrders]: {
    description:
      "List the user's current open orders. Optional `type` (limit/stop) and `side` (buy/sell) filters.",
    parameters: {
      type: "object",
      properties: {
        type: orderTypeProperty("Optional filter: only orders of this type."),
        side: orderSideProperty("Optional filter: only orders of this side."),
      },
    },
  },
  [TOOL_NAMES.cancelOrder]: {
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
});

/**
 * The runtime validators every host derives its argument schema from, defined
 * below TOOL_SCHEMAS so descriptions and primitives stay in one place.
 * Populated via {@link buildToolDefinitions} after TOOL_SCHEMAS is initialized.
 */
export const TOOL_DEFINITIONS = {};

export const TOOLS = Object.entries(TOOL_SCHEMAS).map(([name, schema]) => ({
  type: "function",
  function: { name, ...schema },
}));

function buildToolDefinitions() {
  const descriptionOf = (name) => TOOL_SCHEMAS[name].description;

  Object.assign(TOOL_DEFINITIONS, {
    [TOOL_NAMES.getPortfolioSummary]: {
      description: descriptionOf(TOOL_NAMES.getPortfolioSummary),
      schema: {},
      required: [],
    },
    [TOOL_NAMES.getQuote]: {
      description: descriptionOf(TOOL_NAMES.getQuote),
      schema: {},
      required: [],
    },
    [TOOL_NAMES.buyStock]: {
      description: descriptionOf(TOOL_NAMES.buyStock),
      // A market buy converts an optional dollar `amount` into whole shares at
      // the live price (floor), so the amount is a non-negative dollar figure.
      schema: {
        quantity: wholeShares("buy"),
        amount: { type: "number", minimum: 0 },
        confirm: confirmFlag,
      },
      required: [],
    },
    [TOOL_NAMES.sellStock]: {
      description: descriptionOf(TOOL_NAMES.sellStock),
      schema: {
        quantity: wholeShares("sell"),
        amount: { type: "number", minimum: 0 },
        confirm: confirmFlag,
      },
      required: [],
    },
    [TOOL_NAMES.transferCash]: {
      description: descriptionOf(TOOL_NAMES.transferCash),
      schema: {
        amount: dollarAmount(
          "Dollar amount to move. Positive deposits cash; negative withdraws cash.",
        ),
        confirm: confirmFlag,
      },
      required: ["amount"],
    },
    [TOOL_NAMES.placeOrder]: {
      description: descriptionOf(TOOL_NAMES.placeOrder),
      schema: {
        type: orderTypeProperty("Order type: limit or stop."),
        side: orderSideProperty("Order side: buy or sell."),
        quantity: wholeShares("trade"),
        price: dollarAmount("Trigger price in dollars."),
        confirm: confirmFlag,
      },
      required: ["type", "side", "quantity", "price"],
    },
    [TOOL_NAMES.listOrders]: {
      description: descriptionOf(TOOL_NAMES.listOrders),
      schema: {
        type: orderTypeProperty("Optional filter: only orders of this type."),
        side: orderSideProperty("Optional filter: only orders of this side."),
      },
      required: [],
    },
    [TOOL_NAMES.cancelOrder]: {
      description: descriptionOf(TOOL_NAMES.cancelOrder),
      schema: {
        orderId: {
          type: "string",
          description:
            "Id of the order to cancel. Defaults to the pending order.",
        },
      },
      required: [],
    },
    [TOOL_NAMES.resolveConfirmation]: {
      description:
        "Confirm or cancel a pending action that required human confirmation. Pass the confirmationId returned by the tool that requested confirmation.",
      schema: {
        confirmationId: {
          type: "string",
          description: "The confirmationId from the pending action.",
        },
        action: {
          type: "string",
          enum: ["confirm", "cancel"],
          description:
            "Confirm to execute the pending action, cancel to discard it without executing.",
        },
      },
      required: ["confirmationId", "action"],
    },
  });

  return TOOL_DEFINITIONS;
}

buildToolDefinitions();
Object.freeze(TOOL_DEFINITIONS);

export function resolveMarketTradeQuantity({
  quantity,
  amount,
  pricePerShare,
} = {}) {
  const requestedAmount = Number(amount ?? 0);
  const price = Number(pricePerShare ?? 0);
  const explicit = Number(quantity);

  if (Number.isFinite(requestedAmount) && requestedAmount > 0) {
    const shares =
      Number.isFinite(price) && price > 0
        ? Math.floor(requestedAmount / price)
        : 0;
    const spent = shares * price;
    return {
      quantity: shares,
      amount: requestedAmount,
      fromAmount: true,
      spent,
      remainder:
        Number.isFinite(price) && price > 0 ? requestedAmount - spent : 0,
    };
  }

  const shares = Number.isInteger(explicit) && explicit > 0 ? explicit : null;
  return {
    quantity: shares,
    amount: 0,
    fromAmount: false,
    spent: shares != null && Number.isFinite(price) ? shares * price : 0,
    remainder: 0,
  };
}

/**
 * Filter a raw order list down to the open orders the assistant shows, honoring
 * the optional `type` (limit/stop) and `side` (buy/sell) filters.
 */
export function filterOpenOrders(orders, { type, side } = {}) {
  const filterType = String(type ?? "").toLowerCase();
  const filterSide = String(side ?? "").toLowerCase();

  return (Array.isArray(orders) ? orders : []).filter(
    (order) =>
      order.status === "open" &&
      (!filterType || order.type === filterType) &&
      (!filterSide || order.kind === filterSide),
  );
}

/**
 * Convert a JSON Schema fragment into the raw Zod shape `registerTool` expects
 * as `inputSchema`. Every host therefore validates the exact same argument
 * surface it advertises, and only a single definition needs to change.
 *
 * Supported: string (with `enum`), integer, number, boolean. Fields listed in
 * `required` are mandatory and every other field is optional, defaulting to the
 * assistant's contract.
 */
export function toZodShape(schema = {}, { required = [] } = {}) {
  const requiredFields = new Set(required);

  return Object.fromEntries(
    Object.entries(schema).map(([name, property]) => [
      name,
      zodFor(property, requiredFields.has(name)),
    ]),
  );
}

function zodFor(property, isRequired) {
  let validator;
  if (property.type === "integer") {
    validator = z.number().int();
  } else if (property.type === "number") {
    validator = z.number();
  } else if (property.type === "boolean") {
    validator = z.boolean();
  } else if (Array.isArray(property.enum)) {
    validator = z.enum(property.enum);
  } else {
    validator = z.string();
  }

  if (typeof property.minimum === "number") {
    validator = validator.min(property.minimum);
  }
  if (typeof property.maxLength === "number") {
    validator = validator.max(property.maxLength);
  }
  if (property.description) {
    validator = validator.describe(property.description);
  }

  return isRequired ? validator : validator.optional();
}
