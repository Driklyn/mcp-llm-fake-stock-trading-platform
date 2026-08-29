import test from "node:test";
import assert from "node:assert/strict";
import {
  apiResponse,
  createHandler,
  getProductionAccount,
  handler,
  parsePayload,
} from "../index.mjs";
import { createMemoryPendingStore } from "chat-assistant";

function stubAccount(overrides = {}) {
  return {
    getQuote: async () => ({ symbol: "FAKE", price: 100, history: [] }),
    getPortfolioSummary: async () => ({
      symbol: "FAKE",
      price: 100,
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
      history: [],
      orders: [],
      transactions: [],
    }),
    buy: async (quantity) => ({
      kind: "buy",
      quantity,
      price: 100,
      holdings: quantity,
      cashAvailable: 10000 - 100 * quantity,
    }),
    sell: async (quantity) => ({
      kind: "sell",
      quantity,
      price: 100,
      holdings: 0,
      cashAvailable: 10000,
    }),
    transfer: async (amount) => ({ cashAvailable: 10000 + amount }),
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
// adapter tests hermetic.
function makeHandler(accountService = stubAccount()) {
  return createHandler({
    account: accountService,
    pendingStore: createMemoryPendingStore(),
    llm: { fetchFn: null },
  });
}

test("parsePayload returns {} for a missing or invalid body", () => {
  assert.deepEqual(parsePayload(), {});
  assert.deepEqual(parsePayload({ body: "not json" }), {});
  assert.deepEqual(parsePayload({ body: JSON.stringify({ message: "hi" }) }), {
    message: "hi",
  });
});

test("apiResponse wraps a body with JSON content type and CORS headers", () => {
  const response = apiResponse(200, { ok: true });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.equal(response.headers["access-control-allow-origin"], "*");
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});

test("handler executes a small market buy through the shared assistant", async () => {
  const buys = [];
  const response = await makeHandler(
    stubAccount({
      buy: async (quantity) => {
        buys.push(quantity);
        return {
          kind: "buy",
          quantity,
          price: 100,
          holdings: quantity,
          cashAvailable: 9000,
        };
      },
    }),
  )({ body: JSON.stringify({ message: "buy 2 shares" }) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(buys, [2]);
  const body = JSON.parse(response.body);
  assert.equal(body.plan.tool, "buy_stock");
  assert.match(body.text, /Buy order completed for 2 shares/);
});

test("handler returns 400 for an empty message", async () => {
  const response = await makeHandler()({
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, "A message is required.");
});

test("large trades create a pending confirmation through the adapter", async () => {
  const response = await makeHandler()({
    body: JSON.stringify({ message: "buy 12 shares" }),
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.payload.requiresConfirmation, true);
  assert.ok(body.payload.confirmationId);
  assert.equal(body.plan.tool, "buy_stock");
});

test("the production handler is a function built from environment", () => {
  assert.equal(typeof handler, "function");
});

test("getProductionAccount requires the Lambda env vars (no CloudFront fallback)", () => {
  const previousTrading = process.env.TRADING_API_FUNCTION_NAME;
  const previousTicks = process.env.TICKS_FETCHER_FUNCTION_NAME;
  delete process.env.TRADING_API_FUNCTION_NAME;
  delete process.env.TICKS_FETCHER_FUNCTION_NAME;
  try {
    assert.throws(getProductionAccount, /TRADING_API_FUNCTION_NAME/);
  } finally {
    if (previousTrading === undefined) delete process.env.TRADING_API_FUNCTION_NAME;
    else process.env.TRADING_API_FUNCTION_NAME = previousTrading;
    if (previousTicks === undefined) delete process.env.TICKS_FETCHER_FUNCTION_NAME;
    else process.env.TICKS_FETCHER_FUNCTION_NAME = previousTicks;
  }
});

test("the production handler returns 500 when the Lambda env vars are missing", async () => {
  const previousTrading = process.env.TRADING_API_FUNCTION_NAME;
  const previousTicks = process.env.TICKS_FETCHER_FUNCTION_NAME;
  const originalConsoleError = console.error;
  // The handler logs every caught failure via console.error; the error below is
  // expected, so silence it to keep the test output clean.
  console.error = () => {};
  delete process.env.TRADING_API_FUNCTION_NAME;
  delete process.env.TICKS_FETCHER_FUNCTION_NAME;
  try {
    const response = await handler({
      body: JSON.stringify({ message: "buy 1 share" }),
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), {
      ok: false,
      error: "Internal server error.",
    });
  } finally {
    console.error = originalConsoleError;
    if (previousTrading === undefined) delete process.env.TRADING_API_FUNCTION_NAME;
    else process.env.TRADING_API_FUNCTION_NAME = previousTrading;
    if (previousTicks === undefined) delete process.env.TICKS_FETCHER_FUNCTION_NAME;
    else process.env.TICKS_FETCHER_FUNCTION_NAME = previousTicks;
  }
});
