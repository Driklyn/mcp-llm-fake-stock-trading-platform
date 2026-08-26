import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createTradingMcpServer } from "../src/mcp/index.js";

function stubService() {
  return {
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
    getQuote: async () => ({ symbol: "FAKE", price: 100, history: [] }),
    buy: async (quantity) => ({
      kind: "buy",
      quantity,
      price: 100,
      holdings: quantity,
      cashAvailable: 10000 - 100 * quantity,
    }),
    sell: async (quantity) => ({ kind: "sell", quantity, cashAvailable: 11000 }),
    transfer: async (amount) => ({
      transferType: "deposit",
      amount,
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
  };
}

async function withMcpClient(service, fn) {
  const serverInstance = createTradingMcpServer({ service });
  const [client, server] = InMemoryTransport.createLinkedPair();
  await serverInstance.connect(server);
  const mcpClient = new Client({ name: "test-client", version: "1.0.0" });
  await mcpClient.connect(client);
  try {
    await fn(mcpClient);
  } finally {
    await mcpClient.close();
  }
}

test("get_account_snapshot returns the account summary as structured content", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "get_account_snapshot",
      arguments: {},
    });
    assert.ok(result.content[0].text.includes("totalEquity"));
    assert.equal(
      result.structuredContent.account.cashAvailable,
      10000,
    );
  });
});

test("buy_stock executes a small trade without confirmation", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "buy_stock",
      arguments: { quantity: 2 },
    });
    assert.equal(result.structuredContent.kind, "buy");
    assert.equal(result.structuredContent.quantity, 2);
    assert.equal(result.structuredContent.cashAvailable, 9800);
  });
});

test("buy_stock requires confirmation for trades worth $1000 or more", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "buy_stock",
      arguments: { quantity: 10 }, // 10 * $100 = $1000
    });
    assert.equal(result.structuredContent.requiresConfirmation, true);
  });
});

test("sell_stock routes to the service", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "sell_stock",
      arguments: { quantity: 3 },
    });
    assert.equal(result.structuredContent.kind, "sell");
    assert.equal(result.structuredContent.quantity, 3);
  });
});

test("transfer_cash routes to the service", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "transfer_cash",
      arguments: { amount: 2500 },
    });
    assert.equal(result.structuredContent.transferType, "deposit");
    assert.equal(result.structuredContent.amount, 2500);
    assert.equal(result.structuredContent.cashAvailable, 12500);
  });
});

test("place_order, list_orders, and cancel_order route to the service", async () => {
  await withMcpClient(stubService(), async (client) => {
    const placed = await client.callTool({
      name: "place_order",
      arguments: { type: "limit", side: "buy", quantity: 2, price: 95 },
    });
    assert.equal(placed.structuredContent.status, "open");

    const listed = await client.callTool({ name: "list_orders", arguments: {} });
    assert.deepEqual(listed.structuredContent, { orders: [] });

    const cancelled = await client.callTool({
      name: "cancel_order",
      arguments: { orderId: "1" },
    });
    assert.equal(cancelled.structuredContent.status, "cancelled");
  });
});
