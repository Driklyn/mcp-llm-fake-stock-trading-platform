/**
 * Maps the serverless cloud responses into the exact shapes the React UI
 * consumes. The account summary now arrives precomputed from the server in
 * both modes (`CloudPortfolioResponse.account`), so the only client-side
 * mapping left is the raw ledger feed — every `CloudTransaction` row is mapped
 * to a `Transaction` here, once, for direct mode and proxy mode alike. This is
 * the client mirror of the shared `chat-assistant` service mapper
 * (`chat-assistant/src/trading/account.js`).
 */

import type { Transaction } from "ui";
import type { ChartInputPoint } from "../types";
import type { CloudTicks, CloudTransaction } from "./cloud";

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Merge two CloudTicks payloads into one retained window: dedupes points by
 * timestamp (a duplicate timestamp keeps the newer payload's price), sorts
 * oldest-first, and keeps only the most recent 960 points so direct-mode
 * refreshes append to the 4h window instead of replacing it.
 */
export function mergeCloudTicks(
  previous: CloudTicks | null,
  incoming: CloudTicks,
): CloudTicks {
  const MAX_POINTS = 960; // 4h of 15s ticks
  const byTimestamp = new Map<number, { timestamp: number; price: number }>();
  for (const point of [
    ...(Array.isArray(previous?.points) ? previous.points : []),
    ...(Array.isArray(incoming?.points) ? incoming.points : []),
  ]) {
    if (point == null) continue;
    const timestamp = Number(point.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    byTimestamp.set(timestamp, {
      timestamp,
      price: Number(point.price),
    });
  }
  const points = [...byTimestamp.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_POINTS);

  const oldest = points[0];
  const newest = points[points.length - 1];
  return {
    symbol: incoming?.symbol ?? previous?.symbol ?? "FAKE",
    generatedAt: incoming?.generatedAt ?? previous?.generatedAt ?? 0,
    from: oldest?.timestamp ?? incoming?.from ?? 0,
    to: newest?.timestamp ?? incoming?.to ?? 0,
    count: points.length,
    points,
  };
}

function toTransaction(entry: CloudTransaction): Transaction {
  switch (entry.table) {
    // A filled market/limit/stop order. Trades carry the originating order
    // type when a limit/stop order executed ("limit" | "stop"); market fills
    // have a null type, so fall back to the execution side.
    case "trade": {
      const side = String(entry.side).toLowerCase() as "buy" | "sell";
      const quantity = Number(entry.quantity);
      const price = Number(entry.price);
      return {
        id: `trade-${entry.id}`,
        kind: entry.type
          ? (String(entry.type).toLowerCase() as "limit" | "stop")
          : side,
        side,
        quantity,
        price,
        amount: round2(quantity * price),
        status: "completed",
        timestamp: Number(entry.created_at) * 1000,
      };
    }
    // Deposit (positive) or withdrawal (negative). Transfer rows only carry
    // id/amount/created_at — no side/quantity/price keys, so the history table
    // never renders null/0 columns.
    case "transfer": {
      const amount = Number(entry.amount);
      return {
        id: `transfer-${entry.id}`,
        kind: amount >= 0 ? "deposit" : "withdrawal",
        amount: Math.abs(amount),
        status: "completed",
        timestamp: Number(entry.created_at) * 1000,
      };
    }
    // Open limit/stop order, surfaced as a pending row so the "limit"/"stop"
    // type chips and the "open" state chip have data to show.
    case "order": {
      const quantity = Number(entry.quantity);
      const price = Number(entry.price);
      return {
        id: `order-${entry.id}`,
        orderId: String(entry.id),
        kind: String(entry.type ?? "").toLowerCase() as "limit" | "stop",
        side: String(entry.side ?? "").toLowerCase() as "buy" | "sell",
        quantity,
        price,
        amount: round2(quantity * price),
        status: "open",
        timestamp: Number(entry.created_at ?? 0) * 1000,
      };
    }
  }
}

/**
 * Map the raw ledger feed (trades + transfers + open orders in a single
 * `CloudTransaction[]`, newest-first as returned by the API) into the sorted,
 * capped transaction list the UI renders. The account summary itself is not
 * computed here — it arrives precomputed in `CloudPortfolioResponse.account`.
 */
export function mapCloudTransactions(
  transactions: CloudTransaction[],
): Transaction[] {
  return (Array.isArray(transactions) ? transactions : [])
    .map((entry) => toTransaction(entry))
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Map a CloudTicks payload into chart points (`{ price, timestamp }` in
 * epoch ms) for MarketChart.
 */
export function ticksToChartPoints(ticks: CloudTicks): ChartInputPoint[] {
  const points = Array.isArray(ticks?.points) ? ticks.points : [];
  return points.map((point) => ({
    price: Number(point.price),
    timestamp: Number(point.timestamp) * 1000,
  }));
}
