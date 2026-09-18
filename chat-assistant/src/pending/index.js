/**
 * Pending-confirmation store factory.
 *
 * Every host picks its store the same way: DynamoDB when
 * PENDING_CONFIRMATIONS_TABLE is configured (the production Lambda) and an
 * in-memory Map otherwise (local dev, the stdio MCP bootstrap, tests). The MCP
 * layer therefore never hardcodes DynamoDB — running `npm run mcp` over stdio
 * offline cannot fail trying to reach AWS.
 *
 * Returns `{ store, kind }` so a host can log which one was selected.
 */

import { createMemoryPendingStore } from "./memory.js";
import { createDynamoPendingStore } from "./dynamodb.js";

export function createPendingStore({
  tableName = process.env.PENDING_CONFIRMATIONS_TABLE,
  ...options
} = {}) {
  const normalized = typeof tableName === "string" ? tableName.trim() : "";

  if (!normalized) {
    return { store: createMemoryPendingStore(), kind: "memory" };
  }

  return {
    store: createDynamoPendingStore({ tableName: normalized, ...options }),
    kind: "dynamodb",
  };
}
