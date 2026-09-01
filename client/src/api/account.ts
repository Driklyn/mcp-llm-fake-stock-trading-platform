/**
 * Maps the serverless cloud responses (`GET /api/v1/portfolio` + ticks, plus
 * the dedicated `/api/v1/trades/50` + `/api/v1/transfers/50` feeds for
 * transactions) into the exact shapes the React UI consumes. This is the client
 * mirror of `server/src/trading/account.js` (`toSummary` / `toTransaction`), so
 * direct-mode and proxy-mode rendering stay identical.
 */

import type { Transaction } from "ui";
import type { Account, ChartInputPoint } from "../types";
import type {
  CloudOrder,
  CloudPortfolio,
  CloudTicks,
  CloudTrade,
  CloudTransfer,
} from "./cloud";

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

function toTransaction(entry: CloudTrade | CloudTransfer): Transaction {
  if ("side" in entry) {
    const side = String(entry.side).toLowerCase() as "buy" | "sell";
    const quantity = Number(entry.quantity);
    const price = Number(entry.price);
    return {
      id: `trade-${entry.id}`,
      kind: side,
      side,
      quantity,
      price,
      amount: round2(quantity * price),
      status: "completed",
      timestamp: Number(entry.created_at) * 1000,
    };
  }
  const amount = Number(entry.amount);
  return {
    id: `transfer-${entry.id}`,
    kind: amount >= 0 ? "deposit" : "withdrawal",
    amount: Math.abs(amount),
    status: "completed",
    timestamp: Number(entry.created_at) * 1000,
  };
}

function orderToTransaction(order: CloudOrder): Transaction {
  const quantity = Number(order.quantity);
  const price = Number(order.price);
  return {
    id: `order-${order.id}`,
    orderId: String(order.id),
    kind: String(order.type ?? "").toLowerCase() as "limit" | "stop",
    side: String(order.side ?? "").toLowerCase() as "buy" | "sell",
    quantity,
    price,
    amount: round2(quantity * price),
    status: "open",
    timestamp: Number(order.created_at ?? 0) * 1000,
  };
}

/**
 * Map a CloudPortfolio + the dedicated trades/transfers feeds plus the open
 * order book into the account summary + transaction list the UI renders
 * (holdings/cash/transaction math only — no price, history, or orders). Open
 * orders become the "open" limit/stop rows in the history table.
 */
export function portfolioToSummary(
  portfolio: CloudPortfolio,
  trades: CloudTrade[],
  transfers: CloudTransfer[],
  orders: CloudOrder[],
): {
  account: Account;
  transactions: Transaction[];
} {
  const holdingsRows = Array.isArray(portfolio?.holdings)
    ? portfolio.holdings
    : [];
  const holdings = holdingsRows.reduce(
    (sum, holding) => sum + Number(holding.quantity ?? 0),
    0,
  );

  const cashAvailable = Number(portfolio?.cash ?? 0);
  const costBasis = Number(portfolio?.costBasis ?? 0);
  const investedValue = Number(portfolio?.investedValue ?? 0);
  const totalEquity = Number(
    portfolio?.totalEquity ?? cashAvailable + investedValue,
  );
  const realizedGains = Number(portfolio?.realizedGains ?? 0);
  const unrealizedGains = investedValue - costBasis;
  const totalGainsLosses = realizedGains + unrealizedGains;

  const account: Account = {
    cashAvailable,
    investedValue,
    costBasis,
    realizedGains,
    unrealizedGains,
    totalGainsLosses,
    holdings,
    totalEquity,
    cashTransferred: Number(portfolio?.cashTransferred ?? 0),
  };

  const transactions = [
    ...trades.map((trade) => toTransaction(trade)),
    ...transfers.map((transfer) => toTransaction(transfer)),
    ...orders.map((order) => orderToTransaction(order)),
  ]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);

  return { account, transactions };
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
