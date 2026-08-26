import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  TradingApiError,
  fetchOrders,
  fetchPortfolio,
  isCloudMode,
  postTrade,
  postTransfer,
} from "../src/trading/cloudClient.js";

function startFakeApi(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function withEnv(baseUrl, fn) {
  const previous = process.env.TRADING_API_URL;
  process.env.TRADING_API_URL = baseUrl;
  return fn().finally(() => {
    if (previous === undefined) delete process.env.TRADING_API_URL;
    else process.env.TRADING_API_URL = previous;
  });
}

test("isCloudMode reflects TRADING_API_URL", () => {
  const previous = process.env.TRADING_API_URL;
  try {
    delete process.env.TRADING_API_URL;
    assert.equal(isCloudMode(), false);
    process.env.TRADING_API_URL = " https://edge.example.com/ ";
    assert.equal(isCloudMode(), true);
  } finally {
    if (previous === undefined) delete process.env.TRADING_API_URL;
    else process.env.TRADING_API_URL = previous;
  }
});

test("fetchPortfolio GETs /api/v1/portfolio", async () => {
  const requests = [];
  const { server, baseUrl } = await startFakeApi((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, cash: 10000 }));
  });
  try {
    const data = await withEnv(baseUrl, () => fetchPortfolio());
    assert.deepEqual(data, { ok: true, cash: 10000 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/api/v1/portfolio");
  } finally {
    server.close();
  }
});

test("postTrade sends the trade payload with a fresh idempotencyKey", async () => {
  let received;
  const { server, baseUrl } = await startFakeApi((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      received = { method: req.method, url: req.url, body: JSON.parse(raw) };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    await withEnv(baseUrl, () =>
      postTrade({ symbol: "FAKE", side: "BUY", quantity: 2 }),
    );
    assert.equal(received.method, "POST");
    assert.equal(received.url, "/api/v1/trades");
    assert.equal(received.body.symbol, "FAKE");
    assert.equal(received.body.side, "BUY");
    assert.equal(received.body.quantity, 2);
    assert.match(received.body.idempotencyKey, /^[0-9a-f-]{36}$/);
  } finally {
    server.close();
  }
});

test("fetchOrders passes through the status query parameter", async () => {
  const requests = [];
  const { server, baseUrl } = await startFakeApi((req, res) => {
    requests.push(req.url);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, orders: [] }));
  });
  try {
    await withEnv(baseUrl, () => fetchOrders("open"));
    assert.deepEqual(requests, ["/api/v1/orders?status=open"]);
  } finally {
    server.close();
  }
});

test("non-2xx responses throw TradingApiError with the API error message", async () => {
  const { server, baseUrl } = await startFakeApi((req, res) => {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Insufficient cash." }));
  });
  try {
    await assert.rejects(
      withEnv(baseUrl, () => postTransfer({ amount: -1 })),
      (error) =>
        error instanceof TradingApiError &&
        error.status === 400 &&
        error.message === "Insufficient cash.",
    );
  } finally {
    server.close();
  }
});

test("requests fail fast when TRADING_API_URL is unset", async () => {
  const previous = process.env.TRADING_API_URL;
  delete process.env.TRADING_API_URL;
  try {
    await assert.rejects(fetchPortfolio(), /TRADING_API_URL is not set/);
  } finally {
    if (previous === undefined) delete process.env.TRADING_API_URL;
    else process.env.TRADING_API_URL = previous;
  }
});
