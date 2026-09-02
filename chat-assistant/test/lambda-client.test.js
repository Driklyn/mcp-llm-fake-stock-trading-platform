import test from "node:test";
import assert from "node:assert/strict";
import { TradingApiError } from "../src/trading/cloudClient.js";
import { createLambdaTradingClient } from "../src/trading/lambdaClient.js";

const TRADING_API = "market-trading-api";
const TICKS_FETCHER = "market-ticks-fetcher";

function apiPayload(statusCode, body) {
  return Buffer.from(
    JSON.stringify({
      statusCode,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

// Returns a client backed by a recording fake LambdaClient whose `send` answers
// with the given InvokeCommand output.
function makeClient(respond) {
  const invokes = [];
  const lambdaClient = {
    send: async (command) => {
      invokes.push(command.input);
      return respond(command.input);
    },
  };
  const client = createLambdaTradingClient({
    tradingApiFunctionName: TRADING_API,
    ticksFetcherFunctionName: TICKS_FETCHER,
    lambdaClient,
  });
  return { invokes, client };
}

test("factory requires both function names", () => {
  assert.throws(
    () => createLambdaTradingClient({ tradingApiFunctionName: TRADING_API }),
    /ticksFetcherFunctionName/,
  );
  assert.throws(
    () =>
      createLambdaTradingClient({ ticksFetcherFunctionName: TICKS_FETCHER }),
    /tradingApiFunctionName/,
  );
});

test("fetchPortfolio invokes trading-api with the portfolio route", async () => {
  const { invokes, client } = makeClient(() => ({
    Payload: apiPayload(200, { ok: true, cash: 10000 }),
  }));

  const data = await client.fetchPortfolio();

  assert.deepEqual(data, { ok: true, cash: 10000 });
  assert.equal(invokes.length, 1);
  assert.equal(invokes[0].FunctionName, TRADING_API);
  assert.equal(invokes[0].InvocationType, "RequestResponse");
  assert.deepEqual(JSON.parse(invokes[0].Payload), {
    routeKey: "GET /api/v1/portfolio",
    isBase64Encoded: false,
  });
});

test("ticks functions invoke ticks-fetcher with rawPath windows", async () => {
  const { invokes, client } = makeClient(() => ({
    Payload: apiPayload(200, { symbol: "FAKE", points: [] }),
  }));

  await client.fetchLatestTick();
  await client.fetchTicks4h();

  assert.equal(invokes.length, 2);
  assert.ok(
    invokes.every((input) => input.FunctionName === TICKS_FETCHER),
    "both ticks reads must target ticks-fetcher",
  );
  assert.deepEqual(JSON.parse(invokes[0].Payload), {
    routeKey: "GET /api/v1/ticks/latest",
    rawPath: "/api/v1/ticks/latest",
    isBase64Encoded: false,
  });
  assert.deepEqual(JSON.parse(invokes[1].Payload), {
    routeKey: "GET /api/v1/ticks/4h",
    rawPath: "/api/v1/ticks/4h",
    isBase64Encoded: false,
  });
});

test("transactions feed resolves the fixed /50 window; fetchOrders invokes orders without status", async () => {
  const { invokes, client } = makeClient(() => ({
    Payload: apiPayload(200, { ok: true, orders: [], trades: [] }),
  }));

  await client.fetchTransactions();
  await client.fetchOrders();

  assert.deepEqual(JSON.parse(invokes[0].Payload), {
    routeKey: "GET /api/v1/transactions/50",
    rawPath: "/api/v1/transactions/50",
    isBase64Encoded: false,
  });
  assert.deepEqual(JSON.parse(invokes[1].Payload), {
    routeKey: "GET /api/v1/orders",
    isBase64Encoded: false,
  });
});

test("transactions feed resolves the fixed /50 window (use fetchTransactions)", async () => {
  const { invokes, client } = makeClient(() => ({
    Payload: apiPayload(200, { ok: true, transfers: [] }),
  }));

  await client.fetchTransactions();

  assert.deepEqual(JSON.parse(invokes[0].Payload), {
    routeKey: "GET /api/v1/transactions/50",
    rawPath: "/api/v1/transactions/50",
    isBase64Encoded: false,
  });
});

test("postTrade sends the trade body with a fresh idempotencyKey", async () => {
  const { invokes, client } = makeClient(() => ({
    Payload: apiPayload(200, { ok: true, trade: {} }),
  }));

  await client.postTrade({ symbol: "FAKE", side: "BUY", quantity: 2 });

  assert.equal(invokes.length, 1);
  const event = JSON.parse(invokes[0].Payload);
  assert.equal(event.routeKey, "POST /api/v1/trades");
  const body = JSON.parse(event.body);
  assert.equal(body.symbol, "FAKE");
  assert.equal(body.side, "BUY");
  assert.equal(body.quantity, 2);
  assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/);
});

test("cancelOrder routes to trading-api with pathParameters", async () => {
  const { invokes, client } = makeClient(() => ({
    Payload: apiPayload(200, {
      ok: true,
      order: { id: "7", status: "cancelled" },
    }),
  }));

  const data = await client.cancelOrder("7");

  assert.deepEqual(data.order, { id: "7", status: "cancelled" });
  const event = JSON.parse(invokes[0].Payload);
  assert.equal(event.routeKey, "POST /api/v1/orders/{orderId}/cancel");
  assert.deepEqual(event.pathParameters, { orderId: "7" });
});

test("non-2xx responses throw TradingApiError with the API error message", async () => {
  const { client } = makeClient(() => ({
    Payload: apiPayload(400, { ok: false, error: "Insufficient cash." }),
  }));

  await assert.rejects(
    client.postTransfer({ amount: -1 }),
    (error) =>
      error instanceof TradingApiError &&
      error.status === 400 &&
      error.message === "Insufficient cash.",
  );
});

test("FunctionError responses surface the Lambda error message", async () => {
  const { client } = makeClient(() => ({
    FunctionError: "Unhandled",
    Payload: Buffer.from(
      JSON.stringify({ errorMessage: "boom", errorType: "Error" }),
    ),
  }));

  await assert.rejects(client.fetchPortfolio(), /boom/);
});

test("invocation failures surface a descriptive error", async () => {
  const lambdaClient = {
    send: async () => {
      throw new Error("networking down");
    },
  };
  const client = createLambdaTradingClient({
    tradingApiFunctionName: TRADING_API,
    ticksFetcherFunctionName: TICKS_FETCHER,
    lambdaClient,
  });

  await assert.rejects(client.fetchPortfolio(), /networking down/);
});
