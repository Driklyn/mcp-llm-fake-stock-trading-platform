/**
 * The local server's account service — a stateless proxy over trading-api.
 *
 * Reproduces the exact response shapes the UI / MCP / chat layers already
 * consume (previously produced by the deleted trading/engine.js), and keeps a
 * 15s in-memory quote + portfolio cache so the broadcast cadence stays cheap.
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
    ...(order.fill_price != null ? { fillPrice: Number(order.fill_price) } : {}),
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
      kind: side, // "buy" | "sell"
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

export function createAccountService({
  client = cloud,
  now = () => Date.now(),
} = {}) {
  let quoteCache = null;
  let quoteAt = 0;
  let summaryCache = null;
  let summaryAt = 0;

  function invalidate() {
    summaryCache = null;
    summaryAt = 0;
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

  function toSummary(portfolio, quote) {
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

    const account = {
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

    const trades = Array.isArray(portfolio?.recentTrades)
      ? portfolio.recentTrades
      : [];
    const transfers = Array.isArray(portfolio?.recentTransfers)
      ? portfolio.recentTransfers
      : [];
    const transactions = [
      ...trades.map(toTransaction),
      ...transfers.map(toTransaction),
    ]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50);

    return {
      symbol: quote?.symbol ?? DEFAULT_SYMBOL,
      price: Number(quote?.price ?? 0),
      account,
      holdings,
      cashAvailable,
      investedValue,
      costBasis,
      totalGainsLosses,
      totalEquity,
      history: Array.isArray(quote?.history) ? quote.history : [],
      orders: (Array.isArray(portfolio?.openOrders)
        ? portfolio.openOrders
        : []
      ).map(toClientOrder),
      transactions,
    };
  }

  async function getPortfolioSummary({ force = false } = {}) {
    if (!force && summaryCache && now() - summaryAt < CACHE_TTL_MS) {
      return summaryCache;
    }
    const portfolio = await client.fetchPortfolio();
    let quote;
    try {
      quote = await getQuote({ force });
    } catch (error) {
      quote = quoteCache ?? { symbol: DEFAULT_SYMBOL, price: 0, history: [] };
    }
    summaryCache = toSummary(portfolio, quote);
    summaryAt = now();
    return summaryCache;
  }

  function getMarketParams() {
    return { ...MARKET_PARAMS };
  }

  // Merge a mutation response with a freshly refreshed account summary so the
  // returned object keeps the legacy engine result shape (traded quantity,
  // post-trade position, and current account figures).
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

  async function listOrders({ status } = {}) {
    const result = await client.fetchOrders(status);
    return {
      orders: (Array.isArray(result?.orders) ? result.orders : []).map(
        toClientOrder,
      ),
    };
  }

  async function init() {
    if (!isCloudMode()) {
      throw new Error(
        "TRADING_API_URL is not set. Point it at the deployed trading-api base URL " +
          "(terraform output `trading_api_base_url`, e.g. https://dxxxx.cloudfront.net).",
      );
    }
    const [portfolio, quote] = await Promise.all([
      client.fetchPortfolio(),
      getQuote({ force: true }),
    ]);
    quoteCache = quote;
    quoteAt = now();
    summaryCache = toSummary(portfolio, quote);
    summaryAt = now();
    return summaryCache;
  }

  return {
    init,
    getQuote,
    getCachedQuote,
    getPortfolioSummary,
    getMarketParams,
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
