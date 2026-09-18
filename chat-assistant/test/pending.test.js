import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryPendingStore } from "../src/pending/memory.js";
import { createPendingStore } from "../src/pending/index.js";
import {
  createDynamoPendingStore,
  DEFAULT_TTL_SECONDS,
} from "../src/pending/dynamodb.js";

/**
 * In-memory fake DynamoDB client keyed on command class name so the store can
 * be tested without touching AWS.
 */
function fakeDynamo(handlers = {}) {
  return {
    async send(command) {
      const handler = handlers[command.constructor.name];
      if (handler) return handler(command.input);
      if (command.constructor.name === "GetItemCommand")
        return { Item: undefined };
      if (command.constructor.name === "ScanCommand") return { Items: [] };
      return {};
    },
  };
}

test("memory store mirrors the old Map semantics", async () => {
  const store = createMemoryPendingStore();
  assert.equal(await store.size(), 0);

  const created = await store.put({
    tool: "buy_stock",
    arguments: { quantity: 12 },
  });
  assert.ok(created.confirmationId);
  assert.equal(await store.size(), 1);

  const got = await store.get(created.confirmationId);
  assert.equal(got.tool, "buy_stock");
  assert.deepEqual(got.arguments, { quantity: 12 });
  await store.remove(created.confirmationId);
  assert.equal(await store.get(created.confirmationId), null);
  assert.equal(await store.size(), 0);
});

test("dynamo store put/get/remove round-trips", async () => {
  const rows = new Map();
  const client = fakeDynamo({
    PutItemCommand(input) {
      rows.set(input.Item.confirmationId.S, input.Item);
      return {};
    },
    GetItemCommand(input) {
      return { Item: rows.get(input.Key.confirmationId.S) };
    },
    DeleteItemCommand(input) {
      rows.delete(input.Key.confirmationId.S);
      return {};
    },
    ScanCommand() {
      return { Items: [...rows.values()] };
    },
  });
  const store = createDynamoPendingStore({
    tableName: "pending_confirmations",
    ttlSeconds: DEFAULT_TTL_SECONDS,
    client,
    now: () => 1787529600000,
  });

  const created = await store.put({
    tool: "buy_stock",
    arguments: { quantity: 12 },
  });
  assert.ok(created.confirmationId);
  assert.equal(created.ttl, 1787529600 + DEFAULT_TTL_SECONDS);

  const got = await store.get(created.confirmationId);
  assert.equal(got.tool, "buy_stock");
  assert.deepEqual(got.arguments, { quantity: 12 });

  assert.equal(await store.size(), 1);

  await store.remove(created.confirmationId);
  assert.equal(await store.get(created.confirmationId), null);
  assert.equal(await store.size(), 0);
});

test("dynamo store defensively treats expired items as missing", async () => {
  let nowMs = 1787529600000;
  const rows = new Map();
  const client = fakeDynamo({
    PutItemCommand(input) {
      rows.set(input.Item.confirmationId.S, input.Item);
      return {};
    },
    GetItemCommand(input) {
      return { Item: rows.get(input.Key.confirmationId.S) };
    },
    DeleteItemCommand(input) {
      rows.delete(input.Key.confirmationId.S);
      return {};
    },
    ScanCommand() {
      return { Items: [...rows.values()] };
    },
  });
  const store = createDynamoPendingStore({
    tableName: "pending_confirmations",
    ttlSeconds: 60,
    client,
    now: () => nowMs,
  });

  const { confirmationId } = await store.put({
    tool: "sell_stock",
    arguments: { quantity: 5 },
  });
  assert.ok(await store.get(confirmationId));

  // Advance past the TTL: the row still exists in the table (DynamoDB TTL GC
  // can lag for ~48h), but reads must treat it as consumed.
  nowMs += 61_000;
  assert.equal(await store.get(confirmationId), null);
  assert.equal(await store.size(), 0);
});

test("createPendingStore picks the memory store when no table is configured", async () => {
  const { store, kind } = createPendingStore({ tableName: "" });
  assert.equal(kind, "memory");
  // A usable store, so a gated MCP call still mints a confirmationId offline.
  const created = await store.put({
    tool: "buy_stock",
    arguments: { quantity: 10 },
  });
  assert.ok(await store.get(created.confirmationId));
});

test("createPendingStore picks the DynamoDB store when a table is configured", async () => {
  const rows = new Map();
  const client = fakeDynamo({
    PutItemCommand(input) {
      rows.set(input.Item.confirmationId.S, input.Item);
      return {};
    },
    GetItemCommand(input) {
      return { Item: rows.get(input.Key.confirmationId.S) };
    },
  });
  const { store, kind } = createPendingStore({
    tableName: "pending_confirmations",
    client,
    ttlSeconds: DEFAULT_TTL_SECONDS,
  });

  assert.equal(kind, "dynamodb");
  const created = await store.put({
    tool: "transfer_cash",
    arguments: { amount: 500 },
  });
  const got = await store.get(created.confirmationId);
  assert.equal(got.tool, "transfer_cash");
  assert.deepEqual(got.arguments, { amount: 500 });
});
