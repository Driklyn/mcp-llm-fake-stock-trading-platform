import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  applyFill,
  foldTradeLedger,
  orderTriggered,
} from "../index.mjs";

/**
 * Minimal in-memory portfolio store that satisfies the handful of query shapes
 * applyFill issues (SELECT cash/position, DELETE zero positions, upsert rows).
 */
function makeFakeClient({ cash = 10000, positionQty = 0, positionAvg = 0 } = {}) {
  const portfolio = new Map();
  portfolio.set("CASH", { quantity: cash, average_price: 1 });
  if (positionQty > 0) {
    portfolio.set("FAKE", { quantity: positionQty, average_price: positionAvg });
  }
  const client = {
    async query(sql, params = []) {
      if (sql.includes("SELECT quantity FROM portfolio WHERE symbol")) {
        const row = portfolio.get(params[0]);
        return { rows: row ? [{ quantity: row.quantity }] : [] };
      }
      if (
        sql.includes(
          "SELECT quantity, average_price FROM portfolio WHERE symbol",
        )
      ) {
        const row = portfolio.get(params[0]);
        return {
          rows: row
            ? [{ quantity: row.quantity, average_price: row.average_price }]
            : [],
        };
      }
      if (sql.includes("DELETE FROM portfolio WHERE symbol")) {
        portfolio.delete(params[0]);
        return { rows: [] };
      }
      if (sql.includes("ON CONFLICT (symbol) DO UPDATE")) {
        portfolio.set(params[0], {
          quantity: params[1],
          average_price: params[2],
        });
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return { client, portfolio };
}

test("foldTradeLedger computes realized gains using average-cost accounting", () => {
  const { realizedGains, costBasis, holdings } = foldTradeLedger([
    { side: "BUY", quantity: 10, price: 100 },
    { side: "SELL", quantity: 4, price: 110 },
  ]);
  assert.equal(holdings, 6);
  assert.equal(costBasis, 600);
  assert.equal(realizedGains, 40); // (110 - 100) * 4
});

test("orderTriggered applies limit and stop rules", () => {
  assert.equal(orderTriggered({ type: "limit", side: "BUY", price: 95 }, 94), true);
  assert.equal(orderTriggered({ type: "limit", side: "BUY", price: 95 }, 96), false);
  assert.equal(orderTriggered({ type: "limit", side: "SELL", price: 110 }, 111), true);
  assert.equal(orderTriggered({ type: "limit", side: "SELL", price: 110 }, 109), false);
  assert.equal(orderTriggered({ type: "stop", side: "BUY", price: 120 }, 120), true);
  assert.equal(orderTriggered({ type: "stop", side: "BUY", price: 120 }, 119), false);
  assert.equal(orderTriggered({ type: "stop", side: "SELL", price: 80 }, 79), true);
  assert.equal(orderTriggered({ type: "stop", side: "SELL", price: 80 }, 81), false);
});

test("applyFill buys shares and reduces cash", async () => {
  const { client, portfolio } = makeFakeClient({ cash: 10000 });
  const result = await applyFill(client, {
    symbol: "FAKE",
    side: "BUY",
    quantity: 5,
    fillPrice: 100,
    nowSeconds: 1,
  });
  assert.equal(result.cash, 9500);
  assert.equal(result.quantity, 5);
  assert.equal(result.averagePrice, 100);
  assert.equal(portfolio.get("FAKE").quantity, 5);
  assert.equal(portfolio.get("CASH").quantity, 9500);
});

test("applyFill rejects a buy that exceeds available cash", async () => {
  const { client } = makeFakeClient({ cash: 100 });
  await assert.rejects(
    applyFill(client, {
      symbol: "FAKE",
      side: "BUY",
      quantity: 5,
      fillPrice: 100,
      nowSeconds: 1,
    }),
    (error) =>
      error instanceof ApiError &&
      error.statusCode === 400 &&
      /Insufficient cash/.test(error.message),
  );
});

test("applyFill sells shares and removes zero positions", async () => {
  const { client, portfolio } = makeFakeClient({
    cash: 10000,
    positionQty: 10,
    positionAvg: 100,
  });
  const result = await applyFill(client, {
    symbol: "FAKE",
    side: "SELL",
    quantity: 10,
    fillPrice: 110,
    nowSeconds: 1,
  });
  assert.equal(result.cash, 11100);
  assert.equal(result.quantity, 0);
  assert.equal(portfolio.has("FAKE"), false); // zero position deleted
});

test("applyFill rejects a sell that exceeds the position", async () => {
  const { client } = makeFakeClient({
    cash: 10000,
    positionQty: 3,
    positionAvg: 100,
  });
  await assert.rejects(
    applyFill(client, {
      symbol: "FAKE",
      side: "SELL",
      quantity: 4,
      fillPrice: 110,
      nowSeconds: 1,
    }),
    (error) =>
      error instanceof ApiError &&
      error.statusCode === 400 &&
      /Insufficient position/.test(error.message),
  );
});
