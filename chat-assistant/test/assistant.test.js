import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTradePlan,
  getAssistantResponse,
  normalizeTradeQuantity,
  parseToolPlan,
  requiresConfirmationForTrade,
} from "../src/llm.js";

test("buy intent falls back to buy_stock with a quantity", () => {
  const plan = buildTradePlan("buy 3 shares", { allowNetwork: false });

  assert.equal(plan.tool, "buy_stock");
  assert.deepEqual(plan.arguments, { quantity: 3 });
});

test("limit buy phrase maps to place_order with type and price", () => {
  const plan = buildTradePlan("limit buy 3 shares at $95", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, "place_order");
  assert.deepEqual(plan.arguments, {
    type: "limit",
    side: "buy",
    quantity: 3,
    price: 95,
  });
});

test("stop sell phrase maps to place_order with type and price", () => {
  const plan = buildTradePlan("stop sell 2 shares below $80", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, "place_order");
  assert.equal(plan.arguments.type, "stop");
  assert.equal(plan.arguments.side, "sell");
  assert.equal(plan.arguments.quantity, 2);
  assert.equal(plan.arguments.price, 80);
});

test("deposit request maps to transfer_cash", () => {
  const plan = buildTradePlan("deposit $500", { allowNetwork: false });

  assert.equal(plan.tool, "transfer_cash");
  assert.deepEqual(plan.arguments, { amount: 500 });
});

test("real model JSON tool plans are parsed and used", () => {
  const plan = parseToolPlan(
    '{"tool":"buy_stock","arguments":{"quantity":4}}',
    "buy 4 shares",
  );

  assert.equal(plan.tool, "buy_stock");
  assert.deepEqual(plan.arguments, { quantity: 4 });
});

test("large trades require an explicit confirmation flag", () => {
  const plan = buildTradePlan("buy 12 shares", { allowNetwork: false });

  assert.equal(plan.tool, "buy_stock");
  assert.equal(plan.arguments.quantity, 12);
  assert.equal(plan.arguments.confirm, false);
  assert.equal(requiresConfirmationForTrade(12, 100), true);
});

test("explicit confirmation turns off the human-in-the-loop gate", () => {
  const plan = buildTradePlan("confirm buy 12 shares", { allowNetwork: false });

  assert.equal(plan.tool, "buy_stock");
  assert.equal(plan.arguments.quantity, 12);
  assert.equal(plan.arguments.confirm, true);
});

test("pending confirmation accepts approval phrases like 'I accept'", () => {
  const plan = buildTradePlan("i accept", {
    allowNetwork: false,
    pendingTool: { tool: "buy_stock", arguments: { quantity: 10 } },
  });

  assert.equal(plan.tool, "buy_stock");
  assert.equal(plan.arguments.quantity, 10);
  assert.equal(plan.arguments.confirm, true);
});

test("small trades do not require confirmation", () => {
  const plan = buildTradePlan("buy 3 shares", { allowNetwork: false });

  assert.equal(plan.tool, "buy_stock");
  assert.equal(plan.arguments.quantity, 3);
  assert.equal(plan.arguments.confirm, undefined);
  assert.equal(requiresConfirmationForTrade(3, 100), false);
});

test("non trading prompts do not trigger a trading tool", () => {
  const plan = buildTradePlan("why is the sky blue?", { allowNetwork: false });

  assert.equal(plan.tool, null);
  assert.equal(typeof plan.fallback, "string");
});

test("check limit orders maps to list_orders filtered by limit", () => {
  const plan = buildTradePlan("check limit orders", { allowNetwork: false });

  assert.equal(plan.tool, "list_orders");
  assert.deepEqual(plan.arguments, { type: "limit" });
});

test("check stop orders maps to list_orders filtered by stop", () => {
  const plan = buildTradePlan("check stop orders", { allowNetwork: false });

  assert.equal(plan.tool, "list_orders");
  assert.deepEqual(plan.arguments, { type: "stop" });
});

test("check limit buy orders maps to list_orders with type and side", () => {
  const plan = buildTradePlan("check limit buy orders", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, "list_orders");
  assert.deepEqual(plan.arguments, { type: "limit", side: "buy" });
});

test("check sell stop orders maps to list_orders with type and side", () => {
  const plan = buildTradePlan("check stop sell orders", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, "list_orders");
  assert.deepEqual(plan.arguments, { type: "stop", side: "sell" });
});

test("generic order listing phrases map to unfiltered list_orders", () => {
  const plan = buildTradePlan("show my open orders", { allowNetwork: false });

  assert.equal(plan.tool, "list_orders");
  assert.deepEqual(plan.arguments, {});
});

test("LLM cannot override a listing request into place_order", async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content:
          '{"tool":"place_order","arguments":{"type":"limit","side":"buy","quantity":176,"price":100}}',
      },
    }),
  });

  const response = await getAssistantResponse("check limit orders", {
    fetchFn,
    pricePerShare: 100,
    baseUrl: "http://localhost:11434/api",
  });

  assert.equal(response.plan.tool, "list_orders");
  assert.deepEqual(response.plan.arguments, { type: "limit" });
  assert.notEqual(response.plan.tool, "place_order");
});

test("buy with 'above price' maps to a stop buy, not a market buy", () => {
  const plan = buildTradePlan("buy 2 shares when price is above $200", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, "place_order");
  assert.deepEqual(plan.arguments, {
    type: "stop",
    side: "buy",
    quantity: 2,
    price: 200,
  });
});

test("buy with 'below price' maps to a limit buy", () => {
  const plan = buildTradePlan("buy 3 shares when the price drops below $95", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, "place_order");
  assert.deepEqual(plan.arguments, {
    type: "limit",
    side: "buy",
    quantity: 3,
    price: 95,
  });
});

test("sell with 'above price' maps to a limit sell", () => {
  const plan = buildTradePlan("sell 2 shares when the price rises above $120", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, "place_order");
  assert.deepEqual(plan.arguments, {
    type: "limit",
    side: "sell",
    quantity: 2,
    price: 120,
  });
});

test("sell with 'below price' maps to a stop sell", () => {
  const plan = buildTradePlan("sell 2 shares if the price falls below $80", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, "place_order");
  assert.deepEqual(plan.arguments, {
    type: "stop",
    side: "sell",
    quantity: 2,
    price: 80,
  });
});

test("'buy when price is above $150' never misreads the price as quantity", () => {
  const plan = buildTradePlan("buy when price is above $150", {
    allowNetwork: false,
  });

  assert.equal(plan.tool, null);
  assert.equal(typeof plan.fallback, "string");
  assert.match(plan.fallback, /How many shares/);
});

test("LLM sell plan for a buy request is overridden to the deterministic buy", async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content:
          '{"tool":"place_order","arguments":{"type":"limit","side":"sell","quantity":2,"price":200}}',
      },
    }),
  });

  const response = await getAssistantResponse(
    "buy 2 shares when price is above $200",
    {
      fetchFn,
      pricePerShare: 100,
      baseUrl: "http://localhost:11434/api",
    },
  );

  assert.equal(response.plan.tool, "place_order");
  assert.equal(response.plan.arguments.side, "buy");
  assert.equal(response.plan.arguments.type, "stop");
  assert.equal(response.plan.arguments.quantity, 2);
  assert.equal(response.plan.arguments.price, 200);
});

test("LLM conditional order is not degraded into a market buy", async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content: '{"tool":"buy_stock","arguments":{"quantity":2}}',
      },
    }),
  });

  const response = await getAssistantResponse(
    "buy 2 shares when price is above $200",
    {
      fetchFn,
      pricePerShare: 100,
      baseUrl: "http://localhost:11434/api",
    },
  );

  assert.equal(response.plan.tool, "place_order");
  assert.equal(response.plan.arguments.type, "stop");
  assert.equal(response.plan.arguments.side, "buy");
  assert.equal(response.plan.arguments.quantity, 2);
  assert.equal(response.plan.arguments.price, 200);
});

test("LLM market buy is not turned into a place_order", async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content:
          '{"tool":"place_order","arguments":{"type":"limit","side":"buy","quantity":1,"price":95}}',
      },
    }),
  });

  const response = await getAssistantResponse("buy 1 share", {
    fetchFn,
    pricePerShare: 100,
    baseUrl: "http://localhost:11434/api",
  });

  assert.equal(response.plan.tool, "buy_stock");
  assert.deepEqual(response.plan.arguments, { quantity: 1 });
});

test("LLM 'none' for 'buy share' still defaults to buy 1 share", async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      message: {
        content: '{"tool":"none","arguments":{}}',
      },
    }),
  });

  const response = await getAssistantResponse("buy share", {
    fetchFn,
    pricePerShare: 100,
    baseUrl: "http://localhost:11434/api",
  });

  assert.equal(response.plan.tool, "buy_stock");
  assert.deepEqual(response.plan.arguments, { quantity: 1 });
});

test("normalizeTradeQuantity rejects missing or fractional quantities", () => {
  assert.equal(normalizeTradeQuantity(undefined), null);
  assert.equal(normalizeTradeQuantity(null), null);
  assert.equal(normalizeTradeQuantity("2.5"), null);
  assert.equal(normalizeTradeQuantity(0), null);
  assert.equal(normalizeTradeQuantity(-3), null);
  assert.equal(normalizeTradeQuantity(2), 2);
  assert.equal(normalizeTradeQuantity("4"), 4);
});
