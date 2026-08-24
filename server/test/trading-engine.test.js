import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  buyStock,
  sellStock,
  transferCash,
  tickMarket,
  placeOrder,
  cancelOrder,
  processOpenOrders,
} from "../src/trading/engine.js";

test("initial state has cash available and zero investment", () => {
  const state = createInitialState();

  assert.equal(state.price, 100);
  assert.equal(state.account.cashAvailable, 10000);
  assert.equal(state.account.holdings, 0);
  assert.equal(state.account.investedValue, 0);
  assert.equal(state.account.costBasis, 0);
  assert.equal(state.account.realizedGains, 0);
});

test("buying stock reduces cash and increases holdings", () => {
  const state = createInitialState();
  const snapshot = buyStock(state, 5);

  assert.equal(snapshot.holdings, 5);
  assert.equal(snapshot.cashAvailable, 9500);
  assert.equal(snapshot.investedValue, 500);
  assert.equal(snapshot.costBasis, 500);
});

test("selling stock returns cash and reduces holdings", () => {
  const state = createInitialState();
  buyStock(state, 10);
  const snapshot = sellStock(state, 4);

  assert.equal(snapshot.holdings, 6);
  assert.equal(snapshot.cashAvailable, 9400);
  assert.equal(snapshot.investedValue, 600);
  assert.equal(snapshot.costBasis, 600);
  assert.equal(snapshot.realizedGains, 0);
});

test("cost basis stays static while gains/losses move with price", () => {
  const state = createInitialState();
  buyStock(state, 5); // cost basis = $500 at $100/share

  tickMarket(state); // price drifts randomly

  assert.equal(state.account.costBasis, 500);
  assert.equal(state.account.realizedGains, 0);
  assert.equal(
    state.account.investedValue,
    state.account.holdings * state.price,
  );
  assert.equal(
    state.account.investedValue - state.account.costBasis,
    state.account.holdings * state.price - 500,
  );
});

test("transferring cash updates available balance", () => {
  const state = createInitialState();
  const snapshot = transferCash(state, 2500);

  assert.equal(snapshot.cashAvailable, 12500);
});

test("market tick moves the price with a bounded range", () => {
  const state = createInitialState();
  const next = tickMarket(state);

  assert.ok(next >= 20 && next <= 500);
  assert.equal(state.history.length, 2);
});

test("limit buy executes when the price falls to or below the limit price", () => {
  const state = createInitialState();
  const order = placeOrder(state, {
    type: "limit",
    side: "buy",
    quantity: 2,
    price: 95,
  });

  assert.equal(order.status, "open");
  assert.equal(order.type, "limit");
  assert.equal(order.kind, "buy");

  state.price = 96;
  processOpenOrders(state);
  assert.equal(state.orders[0].status, "open");

  state.price = 95;
  processOpenOrders(state);
  assert.equal(state.orders[0].status, "executed");
  assert.equal(state.account.holdings, 2);
});

test("limit sell executes when the price rises to or above the limit price", () => {
  const state = createInitialState();
  buyStock(state, 3);
  placeOrder(state, { type: "limit", side: "sell", quantity: 1, price: 110 });

  state.price = 109;
  processOpenOrders(state);
  assert.equal(state.orders[0].status, "open");

  state.price = 110;
  processOpenOrders(state);
  assert.equal(state.orders[0].status, "executed");
  assert.equal(state.account.holdings, 2);
});

test("stop buy executes when the price rises to or above the stop price", () => {
  const state = createInitialState();
  placeOrder(state, { type: "stop", side: "buy", quantity: 2, price: 120 });

  state.price = 119;
  processOpenOrders(state);
  assert.equal(state.orders[0].status, "open");

  state.price = 120;
  processOpenOrders(state);
  assert.equal(state.orders[0].status, "executed");
  assert.equal(state.account.holdings, 2);
});

test("stop sell executes when the price falls to or below the stop price", () => {
  const state = createInitialState();
  buyStock(state, 3);
  placeOrder(state, { type: "stop", side: "sell", quantity: 2, price: 80 });

  state.price = 81;
  processOpenOrders(state);
  assert.equal(state.orders[0].status, "open");

  state.price = 80;
  processOpenOrders(state);
  assert.equal(state.orders[0].status, "executed");
  assert.equal(state.account.holdings, 1);
});

test("open orders can be canceled", () => {
  const state = createInitialState();
  const order = placeOrder(state, {
    type: "limit",
    side: "buy",
    quantity: 2,
    price: 95,
  });

  const canceled = cancelOrder(state, order.id);
  assert.equal(canceled.status, "cancelled");
  assert.equal(state.orders[0].status, "cancelled");
});
