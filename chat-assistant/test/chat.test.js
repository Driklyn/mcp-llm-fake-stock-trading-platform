import test from "node:test";
import assert from "node:assert/strict";
import { createAssistant } from "../src/chat.js";
import { createMemoryPendingStore } from "../src/pending/memory.js";

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
