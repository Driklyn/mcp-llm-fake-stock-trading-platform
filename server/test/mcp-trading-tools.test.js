import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  placeOrder,
  cancelOrder,
  listOrders,
  buyStock,
} from "../src/trading/engine.js";

test("limit buy orders are recorded and can be canceled", () => {
  const state = createInitialState();
  const order = placeOrder(state, {
    type: "limit",
    side: "buy",
    quantity: 2,
    price: 95,
  });

  assert.equal(order.type, "limit");
  assert.equal(order.status, "open");
  assert.equal(state.orders.length, 1);
  assert.equal(listOrders(state).orders.length, 1);

  const canceled = cancelOrder(state, order.id);
  assert.equal(canceled.status, "cancelled");
  assert.equal(state.orders[0].status, "cancelled");
});

test("stop sell orders are recorded with the correct payload", () => {
  const state = createInitialState();
  buyStock(state, 3);
  const order = placeOrder(state, {
    type: "stop",
    side: "sell",
    quantity: 1,
    price: 80,
  });

  assert.equal(order.type, "stop");
  assert.equal(order.kind, "sell");
  assert.equal(order.quantity, 1);
  assert.equal(order.price, 80);
});
