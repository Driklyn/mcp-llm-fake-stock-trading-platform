/**
 * The account service — a stateless proxy over trading-api, shared by the dev
 * server and the chat assistant Lambda.
 *
 * trading-api precomputes the 9-field account summary, so `getPortfolioSummary`
 * relays `result.account` from the cloud response unchanged (no local mapping).
 * The consolidated ledger feed is exposed two ways: `getLedgerTransactions()`
 * passes the raw cloud rows through for the proxy/server relay, and the mapped
 * `getTransactions()` stays for assistant/MCP consumers. Quote/price data lives
 * in `getQuote` only — summaries never ship price, history, or orders. A 15s
 * in-memory cache keeps the broadcast cadence cheap.
 *
 * The service is a factory so tests can inject a fake client; the exported
 * `account` singleton uses the real cloudClient and is what server.js and the
 * MCP layer run against.
 */

import * as cloud from "./cloudClient.js";
import { isCloudMode } from "./cloudClient.js";

export const DEFAULT_SYMBOL = "FAKE";
export const DEFAULT_PRICE = 100;

// Mirrors the deterministic market configuration deployed via
// infra/terraform/variables.tf (originally server/src/trading/market.js).
export const MARKET_PARAMS = Object.freeze({
  basePrice: 100,
  volatility: 0.002,
  startEpoch: 1787529600, // August 24, 2026 00:00 UTC
  seed: 20260824,
});

const CACHE_TTL_MS = 15_000;

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function toClientOrder(order) {
  return {
    id: String(order.id),
    symbol: order.symbol,
    type: String(order.type ?? "").toLowerCase(),
    kind: String(order.side ?? "").toLowerCase(),
    quantity: Number(order.quantity),
    price: Number(order.price),
    status: order.status,
    createdAt: Number(order.created_at ?? 0) * 1000,
    ...(order.fill_price != null
      ? { fillPrice: Number(order.fill_price) }
      : {}),
  };
}

// Map a cloud trade/transfer row into the Transaction shape the UI renders
// (see the `Transaction` type in ui/src/TransactionsHistory.tsx).
function toTransaction(entry) {
  if (entry.side) {
    const side = String(entry.side).toLowerCase();
    const quantity = Number(entry.quantity);
    const price = Number(entry.price);
    return {
      id: `trade-${entry.id}`,
      // Preserve originating order type ("limit"|"stop") when present;
      // otherwise fall back to the execution side ("buy"|"sell").
      kind: entry.type ? String(entry.type).toLowerCase() : side,
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

// Map a cloud order row into the Transaction shape the UI renders. Open
// limit/stop orders surface in the history table as pending rows so the
// "limit"/"stop" type chips and the "open" state chip have data to show.
function orderToTransaction(order) {
  const quantity = Number(order.quantity);
  const price = Number(order.price);
  return {
    id: `order-${order.id}`,
    orderId: String(order.id),
    kind: String(order.type ?? "").toLowerCase(), // "limit" | "stop"
    side: String(order.side ?? "").toLowerCase(), // "buy" | "sell"
    quantity,
    price,
    amount: round2(quantity * price),
    status: "open",
    timestamp: Number(order.created_at ?? 0) * 1000,
  };
}

export function createAccountService({
  client = cloud,
  now = () => Date.now(),
} = {}) {
  let quoteCache = null;
  let quoteAt = 0;
  let summaryCache = null;
  let summaryAt = 0;
  let transactionsCache = null;
  let transactionsAt = 0;

  function invalidate() {
    summaryCache = null;
    summaryAt = 0;
    transactionsCache = null;
    transactionsAt = 0;
  }

  async function getQuote({ force = false } = {}) {
    if (!force && quoteCache && now() - quoteAt < CACHE_TTL_MS) {
      return quoteCache;
    }
    const ticks = await client.fetchLatestTick();
    const points = Array.isArray(ticks?.points) ? ticks.points : [];
    const history = points.map((point) => ({
      price: Number(point.price),
      timestamp: Number(point.timestamp) * 1000,
    }));
    const price =
      Number(history.at(-1)?.price) ||
      Number(process.env.MARKET_BASE_PRICE ?? MARKET_PARAMS.basePrice);
    quoteCache = { symbol: ticks?.symbol ?? DEFAULT_SYMBOL, price, history };
    quoteAt = now();
    return quoteCache;
  }

  function getCachedQuote() {
    return quoteCache;
  }

  async function getPortfolioSummary({ force = false } = {}) {
    if (!force && summaryCache && now() - summaryAt < CACHE_TTL_MS) {
      return summaryCache;
    }
    const portfolio = await client.fetchPortfolio();
    summaryCache = { account: portfolio.account };
    summaryAt = now();
    return summaryCache;
  }

  // Fetch the raw consolidated ledger rows (GET /api/v1/transactions/50 — the
  // trading-api UNION of trades + transfers + open orders) once per cache
  // window, then serve them unmodified to the proxy relay and mapped to the
  // assistant/MCP feed from the same cached fetch.
  async function fetchLedgerRows({ force = false } = {}) {
    if (!force && transactionsCache && now() - transactionsAt < CACHE_TTL_MS) {
      return transactionsCache;
    }
    const result = await client.fetchTransactions();
    const rows = Array.isArray(result?.transactions) ? result.transactions : [];
    transactionsCache = rows;
    transactionsAt = now();
    return transactionsCache;
  }

  // Raw passthrough for the Node server relay: returns the unmodified cloud
  // rows so proxy mode ships exactly what direct mode reads from CloudFront —
  // the client maps every row to the UI `Transaction` shape in account.ts.
  async function getLedgerTransactions({ force = false } = {}) {
    return fetchLedgerRows({ force });
  }

  // Mapped transaction feed for assistant/MCP consumers. Open orders surface as
  // the "open" limit/stop rows in the history table; trades keep their
  // originating order type ("limit" | "stop") when a limit/stop order filled.
  async function getTransactions({ force = false } = {}) {
    const rows = await fetchLedgerRows({ force });
    return rows
      .map((r) => {
        if (r.table === "order") return orderToTransaction(r);
        return toTransaction(r);
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // Merge a mutation response with a freshly refreshed account summary so the
  // returned object includes the latest traded quantity, post-trade position,
  // and current account figures.
  async function finalize(result, extra = {}) {
    const portfolio = result?.portfolio ?? {};
    const traded = Number(result?.trade?.quantity ?? 0);
    const price = Number(result?.fillPrice ?? 0);
    const positionQty = Number(portfolio.quantity ?? 0);
    invalidate();
    const summary = await getPortfolioSummary({ force: true });
    const account = summary.account;
    return {
      ...extra,
      symbol: portfolio.symbol ?? DEFAULT_SYMBOL,
      quantity: traded,
      price,
      holdings: positionQty,
      cashAvailable: account.cashAvailable,
      investedValue: account.investedValue,
      costBasis: account.costBasis,
      realizedGains: account.realizedGains,
      totalEquity: account.totalEquity,
    };
  }

  async function buy(quantity) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("Quantity must be positive.");
    }
    const result = await client.postTrade({
      symbol: DEFAULT_SYMBOL,
      side: "BUY",
      quantity: qty,
    });
    return finalize(result, { kind: "buy" });
  }

  async function sell(quantity) {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("Quantity must be positive.");
    }
    const result = await client.postTrade({
      symbol: DEFAULT_SYMBOL,
      side: "SELL",
      quantity: qty,
    });
    return finalize(result, { kind: "sell" });
  }

  async function transfer(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      throw new Error("Transfer amount must be a non-zero number.");
    }
    const result = await client.postTransfer({ amount: value });
    invalidate();
    const summary = await getPortfolioSummary({ force: true });
    return {
      symbol: DEFAULT_SYMBOL,
      transferType: value >= 0 ? "deposit" : "withdrawal",
      amount: Math.abs(value),
      cashAvailable: summary.account.cashAvailable,
      totalEquity: summary.account.totalEquity,
      cashTransferred: summary.account.cashTransferred,
    };
  }

  async function placeOrder({ type, side, quantity, price } = {}) {
    const typeKey = String(type ?? "").toLowerCase();
    const sideKey = String(side ?? "").toLowerCase();
    const result = await client.postOrder({
      symbol: DEFAULT_SYMBOL,
      side: sideKey.toUpperCase(),
      type: typeKey,
      quantity: Number(quantity),
      price: Number(price),
    });
    invalidate();
    return toClientOrder(result.order);
  }

  async function cancelOrder(orderId) {
    const result = await client.cancelOrder(String(orderId));
    invalidate();
    return toClientOrder(result.order);
  }

  async function listOrders() {
    const result = await client.fetchOrders();
    return {
      orders: (Array.isArray(result?.orders) ? result.orders : []).map(
        toClientOrder,
      ),
    };
  }

  async function init() {
    if (!isCloudMode()) {
      throw new Error(
        "Both TRADING_API_BASE_URL and TRADING_CDN_BASE_URL must be set: " +
          "TRADING_API_BASE_URL -> API Gateway base (terraform output `trading_api_base_url`); " +
          "TRADING_CDN_BASE_URL -> CloudFront base (terraform output `trading_cdn_base_url`).",
      );
    }
    const [portfolio, quote] = await Promise.all([
      client.fetchPortfolio(),
      getQuote({ force: true }),
    ]);
    quoteCache = quote;
    quoteAt = now();
    summaryCache = { account: portfolio.account };
    summaryAt = now();
    return summaryCache;
  }

  return {
    init,
    getQuote,
    getCachedQuote,
    getPortfolioSummary,
    getTransactions,
    getLedgerTransactions,
    buy,
    sell,
    transfer,
    placeOrder,
    cancelOrder,
    listOrders,
  };
}

export const account = createAccountService();
export default account;
