/**
 * HTTP client for the deployed trading-api (infra/lambdas/trading-api).
 *
 * The chat assistant (and the dev server that hosts it) is a stateless proxy
 * over the cloud ledger. Like the client's direct mode, traffic is split over
 * two base URLs:
 *
 * - TRADING_API_BASE_URL → HTTP API Gateway base for every dynamic route
 *   (portfolio, orders, POST trades/transfers/orders). Bypassing CloudFront on
 *   dynamic routes keeps mutations away from the edge layer entirely.
 * - TRADING_CDN_BASE_URL → CloudFront base for the cached read feeds
 *   (GET /api/v1/ticks/*, /api/v1/trades/50, /api/v1/transfers/50). The
 *   ticks-fetcher Lambda only serves HTTP traffic that arrived via CloudFront
 *   (X-From-CloudFront guard), and the 14s edge cache shields the 1-RCU
 *   DynamoDB table and the DSQL ledger.
 *
 * Mutations carry a fresh UUID `idempotencyKey` so an ambiguous timeout can be
 * retried safely — trading-api replays the stored result for a duplicate key
 * instead of double-executing.
 */

import { randomUUID } from "node:crypto";

export const DEFAULT_TIMEOUT_MS = 10_000;

export function getTradingApiBaseUrl() {
  return String(process.env.TRADING_API_BASE_URL ?? "").replace(/\/+$/, "");
}

export function getTradingCdnBaseUrl() {
  return String(process.env.TRADING_CDN_BASE_URL ?? "").replace(/\/+$/, "");
}

export function isCloudMode() {
  return getTradingApiBaseUrl().length > 0 && getTradingCdnBaseUrl().length > 0;
}

export function missingBaseUrlMessage(envVar) {
  return envVar === "TRADING_API_BASE_URL"
    ? "TRADING_API_BASE_URL is not set. Point it at the deployed API Gateway base URL " +
        "(terraform output `trading_api_base_url`, e.g. https://<api-id>.execute-api.<region>.amazonaws.com)."
    : "TRADING_CDN_BASE_URL is not set. Point it at the deployed CloudFront base URL " +
        "(terraform output `trading_cdn_base_url`, e.g. https://<cloudfront-domain>).";
}

export class TradingApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function baseUrlOrThrow(value, envVar) {
  if (value) return value;
  throw new Error(missingBaseUrlMessage(envVar));
}

async function request(
  baseUrl,
  path,
  { method = "GET", body, idempotencyKey } = {},
) {
  const payload = body ? { ...body } : undefined;
  if (payload && idempotencyKey) {
    payload.idempotencyKey = idempotencyKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      // Non-JSON error body; surface the status code instead.
    }
    if (!response.ok) {
      throw new TradingApiError(
        response.status,
        data?.error ??
          `Trading API request failed (HTTP ${response.status}): ${baseUrl}${path}`,
      );
    }
    return data;
  } catch (error) {
    if (error instanceof TradingApiError) throw error;
    const aborted = error?.name === "AbortError";
    throw new Error(
      aborted
        ? `Trading API request timed out after ${DEFAULT_TIMEOUT_MS}ms: ${method} ${path}`
        : `Trading API request failed: ${error?.message ?? String(error)}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

// Dynamic routes (trading-api through the HTTP API Gateway directly).
export const fetchPortfolio = async () =>
  request(
    baseUrlOrThrow(getTradingApiBaseUrl(), "TRADING_API_BASE_URL"),
    "/api/v1/portfolio",
  );

export const fetchOrders = async (status) =>
  request(
    baseUrlOrThrow(getTradingApiBaseUrl(), "TRADING_API_BASE_URL"),
    `/api/v1/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`,
  );

export const postTrade = async ({ symbol, side, quantity }) =>
  request(
    baseUrlOrThrow(getTradingApiBaseUrl(), "TRADING_API_BASE_URL"),
    "/api/v1/trades",
    {
      method: "POST",
      body: { symbol, side, quantity },
      idempotencyKey: randomUUID(),
    },
  );

export const postTransfer = async ({ amount }) =>
  request(
    baseUrlOrThrow(getTradingApiBaseUrl(), "TRADING_API_BASE_URL"),
    "/api/v1/transfers",
    {
      method: "POST",
      body: { amount },
      idempotencyKey: randomUUID(),
    },
  );

export const postOrder = async ({ symbol, side, type, quantity, price }) =>
  request(
    baseUrlOrThrow(getTradingApiBaseUrl(), "TRADING_API_BASE_URL"),
    "/api/v1/orders",
    {
      method: "POST",
      body: { symbol, side, type, quantity, price },
      idempotencyKey: randomUUID(),
    },
  );

export const cancelOrder = async (orderId) =>
  request(
    baseUrlOrThrow(getTradingApiBaseUrl(), "TRADING_API_BASE_URL"),
    `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`,
    { method: "POST" },
  );

// Cached read feeds (CloudFront edge — the only HTTP path the ticks-fetcher
// guard accepts, plus the 14s ticks/ledger edge cache).
export const fetchTicks4h = async () =>
  request(
    baseUrlOrThrow(getTradingCdnBaseUrl(), "TRADING_CDN_BASE_URL"),
    "/api/v1/ticks/4h",
  );

export const fetchLatestTick = async () =>
  request(
    baseUrlOrThrow(getTradingCdnBaseUrl(), "TRADING_CDN_BASE_URL"),
    "/api/v1/ticks/latest",
  );

export const fetchTrades = async () =>
  request(
    baseUrlOrThrow(getTradingCdnBaseUrl(), "TRADING_CDN_BASE_URL"),
    "/api/v1/trades/50",
  );

export const fetchTransfers = async () =>
  request(
    baseUrlOrThrow(getTradingCdnBaseUrl(), "TRADING_CDN_BASE_URL"),
    "/api/v1/transfers/50",
  );
