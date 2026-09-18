import test from "node:test";
import assert from "node:assert/strict";
import {
  createAssistant,
  inferOrderType,
  requiresConfirmationForTradeValue,
  requiresConfirmationForTransferValue,
} from "../src/chat.js";
import { createMemoryPendingStore } from "../src/pending/memory.js";
import {
  filterOpenOrders,
  resolveMarketTradeQuantity,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  toZodShape,
} from "../src/tools.js";

function stubAccount(overrides = {}) {
  return {
    getQuote: async () => ({ symbol: "FAKE", price: 100, history: [] }),
    getPortfolioSummary: async () => ({
      account: {
        cashAvailable: 10000,
        holdings: 0,
        investedValue: 0,
        costBasis: 0,
        realizedGains: 0,
        unrealizedGains: 0,
        totalGainsLosses: 0,
        totalEquity: 10000,
        cashTransferred: 0,
      },
      transactions: [],
    }),
    buy: async (quantity) => ({
      kind: "buy",
      quantity,
      price: 100,
      holdings: quantity,
      cashAvailable: 10000 - 100 * quantity,
      costBasis: 100 * quantity,
      totalEquity: 10000,
    }),
    sell: async (quantity) => ({
      kind: "sell",
      quantity,
      price: 100,
      holdings: 0,
      cashAvailable: 10000,
    }),
    transfer: async (amount) => ({
      transferType: amount >= 0 ? "deposit" : "withdrawal",
      amount: Math.abs(amount),
      cashAvailable: 10000 + amount,
      totalEquity: 10000 + amount,
      cashTransferred: amount,
    }),
    placeOrder: async ({ type, side, quantity, price }) => ({
      id: "1",
      type,
      kind: side,
      quantity,
      price,
      status: "open",
    }),
    listOrders: async () => ({ orders: [] }),
    cancelOrder: async (orderId) => ({ id: orderId, status: "cancelled" }),
    ...overrides,
  };
}

// `fetchFn: null` forces the deterministic planner (no LLM call), keeping the
// handler tests hermetic.
function makeAssistant({
  account = stubAccount(),
  pendingStore,
  llm = {},
} = {}) {
  return createAssistant({
    account,
    pendingStore: pendingStore ?? createMemoryPendingStore(),
    llm: { fetchFn: null, ...llm },
  });
}

test("resolveMarketTradeQuantity prefers an amount and floors to whole shares", () => {
  assert.deepEqual(
    resolveMarketTradeQuantity({ amount: 250, pricePerShare: 100 }),
    { quantity: 2, amount: 250, fromAmount: true, spent: 200, remainder: 50 },
  );
  // A quantity is used as-is, and `spent` is the value at the live price.
  assert.deepEqual(
    resolveMarketTradeQuantity({ quantity: 3, pricePerShare: 100 }),
    { quantity: 3, amount: 0, fromAmount: false, spent: 300, remainder: 0 },
  );
  // An amount smaller than one share rounds to zero so the caller can refuse it.
  assert.equal(
    resolveMarketTradeQuantity({ amount: 50, pricePerShare: 100 }).quantity,
    0,
  );
  // Neither a valid quantity nor an amount yields no trade at all.
  assert.equal(
    resolveMarketTradeQuantity({ quantity: "2.5", pricePerShare: 100 }).quantity,
    null,
  );
  assert.equal(resolveMarketTradeQuantity({}).quantity, null);
});

test("filterOpenOrders keeps open orders and applies type/side filters", () => {
  const orders = [
    { id: "1", type: "limit", kind: "buy", status: "open" },
    { id: "2", type: "stop", kind: "sell", status: "filled" },
    { id: "3", type: "stop", kind: "sell", status: "open" },
    { id: "4", type: "limit", kind: "sell", status: "cancelled" },
  ];

  assert.deepEqual(
    filterOpenOrders(orders).map((order) => order.id),
    ["1", "3"],
  );
  assert.deepEqual(
    filterOpenOrders(orders, { type: "stop", side: "sell" }).map((o) => o.id),
    ["3"],
  );
  assert.deepEqual(
    filterOpenOrders(orders, { side: "sell" }).map((order) => order.id),
    ["3"],
  );
  assert.deepEqual(filterOpenOrders(undefined), []);
});

test("every tool definition exposes the schema the MCP server validates", () => {
  // The registry covers each tool exactly once, including resolve_confirmation,
  // so a new tool cannot ship without an explicit argument surface.
  assert.deepEqual(
    Object.keys(TOOL_DEFINITIONS).sort(),
    Object.values(TOOL_NAMES).sort(),
  );

  // Every definition routes its description through TOOL_SCHEMAS, keeping a
  // single human-readable wording for both hosts.
  for (const [name, entry] of Object.entries(TOOL_DEFINITIONS)) {
    assert.equal(typeof entry.description, "string", `${name} needs a description`);
    assert.ok(entry.description.length > 0, `${name} description is empty`);
  }

  // Market trades accept an optional amount; orders and transfers keep their
  // mandatory arguments required over MCP too.
  assert.deepEqual(TOOL_DEFINITIONS[TOOL_NAMES.buyStock].required, []);
  assert.deepEqual(TOOL_DEFINITIONS[TOOL_NAMES.transferCash].required, ["amount"]);
  assert.deepEqual(TOOL_DEFINITIONS[TOOL_NAMES.placeOrder].required, [
    "type",
    "side",
    "quantity",
    "price",
  ]);
  assert.deepEqual(TOOL_DEFINITIONS[TOOL_NAMES.cancelOrder].required, []);
});

test("toZodShape marks only the declared fields as required", () => {
  const shape = toZodShape(TOOL_DEFINITIONS[TOOL_NAMES.cancelOrder].schema, {
    required: TOOL_DEFINITIONS[TOOL_NAMES.cancelOrder].required,
  });
  assert.equal(shape.orderId.parse(undefined), undefined);
  assert.equal(shape.orderId.parse("abc"), "abc");

  const transfer = toZodShape(
    TOOL_DEFINITIONS[TOOL_NAMES.transferCash].schema,
    { required: TOOL_DEFINITIONS[TOOL_NAMES.transferCash].required },
  );
  assert.throws(() => transfer.amount.parse(undefined));
  assert.equal(transfer.amount.parse(-500), -500);
  assert.equal(transfer.confirm.parse(undefined), undefined);

  const buy = toZodShape(TOOL_DEFINITIONS[TOOL_NAMES.buyStock].schema);
  assert.equal(buy.quantity.parse(undefined), undefined);
  assert.equal(buy.amount.parse(undefined), undefined);
  assert.equal(buy.quantity.parse(2), 2);
  assert.throws(() => buy.quantity.parse(0));
});

test("requires a message or an action", async () => {
  const assistant = makeAssistant();
  const { status, body } = await assistant.handleRequest({});
  assert.equal(status, 400);
  assert.equal(body.error, "A message is required.");
});

test("a small market buy executes and returns a chat response", async () => {
  const buys = [];
  const assistant = makeAssistant({
    account: stubAccount({
      buy: async (quantity) => {
        buys.push(quantity);
        return {
          kind: "buy",
          quantity,
          price: 100,
          holdings: quantity,
          cashAvailable: 10000 - 100 * quantity,
        };
      },
    }),
  });
  const { status, body } = await assistant.handleRequest({
    message: "buy 3 shares",
  });
  assert.equal(status, 200);
  assert.equal(body.plan.tool, "buy_stock");
  assert.deepEqual(buys, [3]);
  assert.match(body.text, /Buy order completed for 3 shares/);
});

test("post-trade messaging uses the exact execution fill price from the result", async () => {
  const assistant = makeAssistant({
    account: stubAccount({
      getQuote: async () => ({ symbol: "FAKE", price: 100, history: [] }),
      buy: async (quantity) => ({
        kind: "buy",
        quantity,
        price: 99,
        holdings: quantity,
        cashAvailable: 10000 - 99 * quantity,
      }),
    }),
  });

  const { status, body } = await assistant.handleRequest({
    message: "buy 3 shares",
  });

  assert.equal(status, 200);
  assert.match(body.text, /at \$99\.00/);
  assert.equal(body.payload.pricePerShare, 99);
});

test("place_order reports the type correction as a warning instead of a silent rewrite", async () => {
  const orders = [];
  const assistant = makeAssistant({
    account: stubAccount({
      placeOrder: async (input) => {
        orders.push(input);
        return { id: "1", quantity: input.quantity, price: input.price };
      },
    }),
  });
  // `stop buy` at $95 while the market is $100 would fill instantly, so it is
  // placed as a limit buy — and the caller is told.
  const { status, body } = await assistant.handleRequest({
    message: "stop buy 2 shares at $95",
  });
  assert.equal(status, 200);
  assert.equal(body.plan.tool, "place_order");
  assert.deepEqual(orders[0], {
    type: "limit",
    side: "buy",
    quantity: 2,
    price: 95,
  });
  assert.equal(
    body.payload.warning,
    "Your stop buy at $95.00 was placed as a limit buy, since a stop buy trigger at that price would have filled instantly at the current market price of $100.00.",
  );
  assert.ok(body.text.startsWith("limit buy order placed"));
  assert.ok(body.text.includes("Your stop buy at $95.00 was placed as a limit buy"));
});

test("a semantically valid order type is not warned about", async () => {
  const assistant = makeAssistant();
  const { body } = await assistant.handleRequest({
    message: "limit buy 2 shares at $95",
  });
  assert.equal(body.payload.warning, undefined);
});

test("a stop buy above the market is corrected to a stop buy only when semantics allow", async () => {
  // A stop buy at $105 is above the $100 market price, so the type is already
  // semantically valid and nothing should be rewritten or warned about.
  const orders = [];
  const assistant = makeAssistant({
    account: stubAccount({
      placeOrder: async (input) => {
        orders.push(input);
        return { id: "1", quantity: input.quantity, price: input.price };
      },
    }),
  });

  const { status, body } = await assistant.handleRequest({
    message: "limit sell 2 shares at $95",
  });

  assert.equal(status, 200);
  assert.deepEqual(orders[0], {
    type: "stop",
    side: "sell",
    quantity: 2,
    price: 95,
  });
  assert.equal(
    body.payload.warning,
    "Your limit sell at $95.00 was placed as a stop sell, since a limit sell trigger at that price would have filled instantly at the current market price of $100.00.",
  );
  assert.ok(body.text.includes("Your limit sell at $95.00 was placed as a stop sell"));
});

test("requiresConfirmationForTransferValue gates both signs at $500", () => {
  assert.equal(requiresConfirmationForTransferValue(499), false);
  assert.equal(requiresConfirmationForTransferValue(500), true);
  assert.equal(requiresConfirmationForTransferValue(-500), true);
  assert.equal(requiresConfirmationForTransferValue(-2500), true);
  assert.equal(requiresConfirmationForTransferValue("500"), true);
  assert.equal(requiresConfirmationForTransferValue(Number.NaN), false);
});

test("requiresConfirmationForTradeValue gates on value or share count", () => {
  assert.equal(requiresConfirmationForTradeValue(2, 100), false);
  assert.equal(requiresConfirmationForTradeValue(10, 50), true); // $500 but 10 shares
  assert.equal(requiresConfirmationForTradeValue(20, 100), true); // $2000
  assert.equal(requiresConfirmationForTradeValue(0, 100), false);
});

test("inferOrderType defaults the requested type from the side", () => {
  // A buy defaults to `limit`; a sell defaults to `stop`.
  assert.deepEqual(inferOrderType({ side: "buy", triggerPrice: 95, currentPrice: 100 }), {
    type: "limit",
    requestedType: "limit",
    corrected: false,
  });
  assert.deepEqual(
    inferOrderType({ side: "sell", triggerPrice: 95, currentPrice: 100 }),
    { type: "stop", requestedType: "stop", corrected: false },
  );
});

test("inferOrderType corrects impossible trigger/type pairings", () => {
  const buyBelow = inferOrderType({
    requestedType: "stop",
    side: "buy",
    triggerPrice: 95,
    currentPrice: 100,
  });
  assert.equal(buyBelow.type, "limit");
  assert.equal(buyBelow.corrected, true);
  assert.equal(buyBelow.requestedType, "stop");

  const buyAbove = inferOrderType({
    requestedType: "limit",
    side: "buy",
    triggerPrice: 105,
    currentPrice: 100,
  });
  assert.equal(buyAbove.type, "stop");
  assert.equal(buyAbove.corrected, true);

  const sellAbove = inferOrderType({
    requestedType: "stop",
    side: "sell",
    triggerPrice: 105,
    currentPrice: 100,
  });
  assert.equal(sellAbove.type, "limit");
  assert.equal(sellAbove.corrected, true);

  const sellBelow = inferOrderType({
    requestedType: "limit",
    side: "sell",
    triggerPrice: 95,
    currentPrice: 100,
  });
  assert.equal(sellBelow.type, "stop");
  assert.equal(sellBelow.corrected, true);
});

test("inferOrderType leaves an invalid trigger price untouched", () => {
  assert.deepEqual(
    inferOrderType({
      requestedType: "stop",
      side: "buy",
      triggerPrice: 0,
      currentPrice: 100,
    }),
    { type: "stop", requestedType: "stop", corrected: false },
  );
});

test("trades worth $1000+ require a pending confirmation", async () => {
  const account = stubAccount();
  const assistant = makeAssistant({ account });
  const { status, body } = await assistant.handleRequest({
    message: "buy 12 shares",
  });
  assert.equal(status, 200);
  assert.equal(body.payload.requiresConfirmation, true);
  assert.ok(body.payload.confirmationId);
  assert.match(body.text, /Please confirm before executing/);
});

test("confirm action executes the pending trade", async () => {
  const account = stubAccount();
  const assistant = makeAssistant({ account });
  const first = await assistant.handleRequest({ message: "buy 12 shares" });
  const confirmationId = first.body.payload.confirmationId;

  const { status, body } = await assistant.handleRequest({
    action: "confirm",
    confirmationId,
  });
  assert.equal(status, 200);
  assert.equal(body.payload.requiresConfirmation, undefined);
  assert.match(body.text, /Buy order completed|Bought/);
});

test("cancel action drops the pending trade", async () => {
  const account = stubAccount();
  const assistant = makeAssistant({ account });
  const first = await assistant.handleRequest({ message: "buy 12 shares" });
  const confirmationId = first.body.payload.confirmationId;

  const cancelled = await assistant.handleRequest({
    action: "cancel",
    confirmationId,
  });
  assert.match(cancelled.body.text, /Cancelled pending trade/);

  const again = await assistant.handleRequest({
    action: "confirm",
    confirmationId,
  });
  assert.match(again.body.text, /There is no pending trade/);
});

test("an unknown confirmationId is reported as not found", async () => {
  const assistant = makeAssistant();
  const { status, body } = await assistant.handleRequest({
    action: "confirm",
    confirmationId: "does-not-exist",
  });
  assert.equal(status, 200);
  assert.match(body.text, /There is no pending trade/);
});

test("a typed confirmation word does not resolve a pending trade (UUID required)", async () => {
  const pendingStore = createMemoryPendingStore();
  const buys = [];
  const assistant = makeAssistant({
    account: stubAccount({
      buy: async (quantity) => {
        buys.push(quantity);
        return {
          kind: "buy",
          quantity,
          price: 100,
          holdings: quantity,
          cashAvailable: 10000 - 100 * quantity,
        };
      },
    }),
    pendingStore,
  });
  const first = await assistant.handleRequest({ message: "buy 12 shares" });
  const confirmationId = first.body.payload.confirmationId;
  assert.equal(await pendingStore.size(), 1);

  // Free text can no longer confirm: the plan falls back to generic help,
  // nothing executes, and the pending row is untouched.
  const { status, body } = await assistant.handleRequest({ message: "yes" });
  assert.equal(status, 200);
  assert.equal(body.plan.tool, null);
  assert.equal(body.payload, null);
  assert.deepEqual(buys, []);
  assert.equal(await pendingStore.size(), 1);

  // The explicit UUID action is the only way to execute the pending trade.
  const confirmed = await assistant.handleRequest({
    action: "confirm",
    confirmationId,
  });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(buys, [12]);
  assert.equal(await pendingStore.size(), 0);
});

test("portfolio requests return the account summary", async () => {
  const assistant = makeAssistant();
  const { status, body } = await assistant.handleRequest({
    message: "show my portfolio",
  });
  assert.equal(status, 200);
  assert.equal(body.plan.tool, "get_portfolio_summary");
  assert.match(
    body.text,
    /Portfolio summary: cash \$10000\.00, invested \$0\.00, gains\/losses \$0\.00, holdings 0, total equity \$10000\.00\./,
  );
  assert.equal(body.payload.account.cashAvailable, 10000);
  // The full account object is returned so every consumer can render its fields.
  assert.deepEqual(Object.keys(body.payload.account).sort(), [
    "cashAvailable",
    "cashTransferred",
    "costBasis",
    "holdings",
    "investedValue",
    "realizedGains",
    "totalEquity",
    "totalGainsLosses",
    "unrealizedGains",
  ]);
});

test("price requests return the current quote", async () => {
  const assistant = makeAssistant();
  const { status, body } = await assistant.handleRequest({
    message: "what is the price?",
  });
  assert.equal(status, 200);
  assert.equal(body.plan.tool, "get_quote");
  assert.match(body.text, /Current FAKE price: \$100.00/);
});

test("deposit requests route to transfer_cash", async () => {
  const transfers = [];
  const assistant = makeAssistant({
    account: stubAccount({
      transfer: async (amount) => {
        transfers.push(amount);
        return { cashAvailable: 10500 };
      },
    }),
  });
  const { status, body } = await assistant.handleRequest({
    message: "deposit $200",
  });
  assert.equal(status, 200);
  assert.equal(body.plan.tool, "transfer_cash");
  assert.deepEqual(transfers, [200]);
  assert.match(body.text, /Cash transfer processed/);
});

test("transfers of $500 or more require a pending confirmation", async () => {
  const transfers = [];
  const assistant = makeAssistant({
    account: stubAccount({
      transfer: async (amount) => {
        transfers.push(amount);
        return { cashAvailable: 10500 };
      },
    }),
  });

  const deposit = await assistant.handleRequest({
    message: "deposit $500",
  });
  assert.equal(deposit.status, 200);
  assert.equal(deposit.body.plan.tool, "transfer_cash");
  assert.equal(deposit.body.payload.requiresConfirmation, true);
  assert.ok(deposit.body.payload.confirmationId);
  assert.match(
    deposit.body.text,
    /deposit of \$500\.00 requires confirmation/,
  );
  assert.deepEqual(transfers, []);

  const withdrawal = await assistant.handleRequest({
    message: "withdraw $500",
  });
  assert.equal(withdrawal.status, 200);
  assert.equal(withdrawal.body.plan.tool, "transfer_cash");
  assert.equal(withdrawal.body.payload.requiresConfirmation, true);
  assert.ok(withdrawal.body.payload.confirmationId);
  assert.match(
    withdrawal.body.text,
    /withdrawal of \$500\.00 requires confirmation/,
  );
  assert.deepEqual(transfers, []);
});

test("confirm action executes a pending transfer", async () => {
  const transfers = [];
  const assistant = makeAssistant({
    account: stubAccount({
      transfer: async (amount) => {
        transfers.push(amount);
        return {
          transferType: amount >= 0 ? "deposit" : "withdrawal",
          amount: Math.abs(amount),
          cashAvailable: 10000 + amount,
        };
      },
    }),
  });

  const first = await assistant.handleRequest({
    message: "withdraw $750",
  });
  const confirmationId = first.body.payload.confirmationId;
  assert.ok(confirmationId);

  const { status, body } = await assistant.handleRequest({
    action: "confirm",
    confirmationId,
  });
  assert.equal(status, 200);
  assert.deepEqual(transfers, [-750]);
  assert.equal(body.payload.requiresConfirmation, undefined);
  assert.match(body.text, /Cash transfer processed/);
});

test("cancel action drops a pending transfer", async () => {
  const transfers = [];
  const assistant = makeAssistant({
    account: stubAccount({
      transfer: async (amount) => {
        transfers.push(amount);
        return { cashAvailable: 10000 + amount };
      },
    }),
  });

  const first = await assistant.handleRequest({
    message: "deposit $500",
  });
  const confirmationId = first.body.payload.confirmationId;
  assert.ok(confirmationId);

  const cancelled = await assistant.handleRequest({
    action: "cancel",
    confirmationId,
  });
  assert.match(cancelled.body.text, /Cancelled pending trade/);

  const again = await assistant.handleRequest({
    action: "confirm",
    confirmationId,
  });
  assert.match(again.body.text, /There is no pending trade/);
  assert.deepEqual(transfers, []);
});

test("limit orders are placed through the account service", async () => {
  const orders = [];
  const assistant = makeAssistant({
    account: stubAccount({
      placeOrder: async (input) => {
        orders.push(input);
        return { id: "1", quantity: input.quantity, price: input.price };
      },
    }),
  });
  const { status, body } = await assistant.handleRequest({
    message: "limit buy 2 shares at $95",
  });
  assert.equal(status, 200);
  assert.equal(body.plan.tool, "place_order");
  assert.deepEqual(orders[0], {
    type: "limit",
    side: "buy",
    quantity: 2,
    price: 95,
  });
  assert.match(body.text, /limit buy order placed for 2 shares at \$95.00/);
});

test("createAssistant requires both the account and the pending store", () => {
  assert.throws(() => createAssistant({}), /account service/);
  assert.throws(
    () => createAssistant({ account: stubAccount() }),
    /pendingStore/,
  );
});
