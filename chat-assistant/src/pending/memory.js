/**
 * In-memory pending-confirmation store (local dev / tests).
 *
 * Mirrors the ephemeral `Map` the chat handler used to keep in server.js: every
 * pending trade is keyed by a random confirmationId and lost on restart.
 */

import { randomUUID } from "node:crypto";

export function createMemoryPendingStore() {
  const items = new Map();

  return {
    async put(entry) {
      const confirmationId = randomUUID();
      const createdAt = Date.now();
      items.set(confirmationId, { ...entry, createdAt });
      return { ...entry, confirmationId, createdAt };
    },
    async get(confirmationId) {
      const item = items.get(confirmationId);
      return item ? { ...item, confirmationId } : null;
    },
    async remove(confirmationId) {
      items.delete(confirmationId);
    },
    async mostRecent() {
      const entries = [...items.entries()];
      if (entries.length === 0) return null;
      const [confirmationId, item] = entries[entries.length - 1];
      return { ...item, confirmationId };
    },
    async size() {
      return items.size;
    },
    async clear() {
      items.clear();
    },
  };
}
