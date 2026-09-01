import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  TradingApiError,
  fetchLatestTick,
  fetchOrders,
  fetchPortfolio,
  fetchTicks4h,
  fetchTrades,
  fetchTransfers,
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

function withEnv(apiBaseUrl, cdnBaseUrl, fn) {
  const previousApi = process.env.TRADING_API_BASE_URL;
  const previousCdn = process.env.TRADING_CDN_BASE_URL;
  process.env.TRADING_API_BASE_URL = apiBaseUrl;
  process.env.TRADING_CDN_BASE_URL = cdnBaseUrl;
  return fn().finally(() => {
    if (previousApi === undefined) delete process.env.TRADING_API_BASE_URL;
    else process.env.TRADING_API_BASE_URL = previousApi;
    if (previousCdn === undefined) delete process.env.TRADING_CDN_BASE_URL;
    else process.env.TRADING_CDN_BASE_URL = previousCdn;
  });
}

test("isCloudMode requires both TRADING_API_BASE_URL and TRADING_CDN_BASE_URL", () => {
  const previousApi = process.env.TRADING_API_BASE_URL;
  const previousCdn = process.env.TRADING_CDN_BASE_URL;
  try {
    delete process.env.TRADING_API_BASE_URL;
    delete process.env.TRADING_CDN_BASE_URL;
    assert.equal(isCloudMode(), false);
    process.env.TRADING_API_BASE_URL = " https://api.example.com/ ";
    assert.equal(isCloudMode(), false); // CDN base still missing
    process.env.TRADING_CDN_BASE_URL = " https://edge.example.com/ ";
    assert.equal(isCloudMode(), true);
  } finally {
    if (previousApi === undefined) delete process.env.TRADING_API_BASE_URL;
    else process.env.TRADING_API_BASE_URL = previousApi;
    if (previousCdn === undefined) delete process.env.TRADING_CDN_BASE_URL;
    else process.env.TRADING_CDN_BASE_URL = previousCdn;
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
    const data = await withEnv(baseUrl, baseUrl, () => fetchPortfolio());
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
    await withEnv(baseUrl, baseUrl, () =>
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
    await withEnv(baseUrl, baseUrl, () => fetchOrders("open"));
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
      withEnv(baseUrl, baseUrl, () => postTransfer({ amount: -1 })),
      (error) =>
        error instanceof TradingApiError &&
        error.status === 400 &&
        error.message === "Insufficient cash.",
    );
  } finally {
    server.close();
  }
});

test("requests fail fast when TRADING_API_BASE_URL is unset", async () => {
  const previous = process.env.TRADING_API_BASE_URL;
  delete process.env.TRADING_API_BASE_URL;
  try {
    await assert.rejects(fetchPortfolio(), /TRADING_API_BASE_URL is not set/);
  } finally {
    if (previous === undefined) delete process.env.TRADING_API_BASE_URL;
    else process.env.TRADING_API_BASE_URL = previous;
  }
});

test("requests fail fast when TRADING_CDN_BASE_URL is unset", async () => {
  const previous = process.env.TRADING_CDN_BASE_URL;
  delete process.env.TRADING_CDN_BASE_URL;
  try {
    await assert.rejects(fetchLatestTick(), /TRADING_CDN_BASE_URL is not set/);
  } finally {
    if (previous === undefined) delete process.env.TRADING_CDN_BASE_URL;
    else process.env.TRADING_CDN_BASE_URL = previous;
  }
});

test("ticks and ledger feeds route through TRADING_CDN_BASE_URL", async () => {
  const requests = [];
  const { server, baseUrl } = await startFakeApi((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    // TRADING_API_BASE_URL points at a dead port; only the CDN base can serve these.
    await withEnv("http://127.0.0.1:1", baseUrl, async () => {
      await fetchLatestTick();
      await fetchTicks4h();
      await fetchTrades();
      await fetchTransfers();
    });
    assert.deepEqual(
      requests.map((r) => r.url),
      [
        "/api/v1/ticks/latest",
        "/api/v1/ticks/4h",
        "/api/v1/trades/50",
        "/api/v1/transfers/50",
      ],
    );
  } finally {
    server.close();
  }
});

test("dynamic routes use TRADING_API_BASE_URL (not the CDN base)", async () => {
  const requests = [];
  const { server, baseUrl } = await startFakeApi((req, res) => {
    requests.push(req.url);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, portfolio: {} }));
  });
  try {
    // TRADING_CDN_BASE_URL points at a dead port; dynamic routes must hit the API base.
    await withEnv(baseUrl, "http://127.0.0.1:1", () => fetchPortfolio());
    assert.deepEqual(requests, ["/api/v1/portfolio"]);
  } finally {
    server.close();
  }
});
