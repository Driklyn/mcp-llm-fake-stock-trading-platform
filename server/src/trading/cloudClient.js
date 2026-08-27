/**
 * HTTP client for the deployed trading-api (infra/lambdas/trading-api).
 *
 * The local server is a stateless proxy over the cloud ledger: every account
 * read and mutation is delegated here, to the base URL in TRADING_API_URL (the
 * CloudFront / API Gateway base, e.g. https://dxxxxxxx.cloudfront.net).
 *
 * Mutations carry a fresh UUID `idempotencyKey` so an ambiguous timeout can be
 * retried safely — trading-api replays the stored result for a duplicate key
 * instead of double-executing.
 */

import { randomUUID } from "node:crypto";

export const DEFAULT_TIMEOUT_MS = 10_000;

export function getTradingApiBaseUrl() {
  return String(process.env.TRADING_API_URL ?? "").replace(/\/+$/, "");
}

export function isCloudMode() {
  return getTradingApiBaseUrl().length > 0;
}

export class TradingApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body, idempotencyKey } = {}) {
  const baseUrl = getTradingApiBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "TRADING_API_URL is not set. Point it at the deployed trading-api base URL " +
        "(terraform output `trading_api_base_url`, e.g. https://dxxxx.cloudfront.net).",
    );
  }

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

export const fetchPortfolio = () => request("/api/v1/portfolio");
export const fetchTrades = (limit = 50) =>
  request(`/api/v1/trades?limit=${limit}`);
export const fetchTicks4h = () => request("/api/v1/ticks/4h");
export const fetchLatestTick = () => request("/api/v1/ticks/latest");
export const fetchOrders = (status) =>
  request(
    `/api/v1/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`,
  );

export const postTrade = ({ symbol, side, quantity }) =>
  request("/api/v1/trades", {
    method: "POST",
    body: { symbol, side, quantity },
    idempotencyKey: randomUUID(),
  });

export const postTransfer = ({ amount }) =>
  request("/api/v1/transfers", {
    method: "POST",
    body: { amount },
    idempotencyKey: randomUUID(),
  });

export const postOrder = ({ symbol, side, type, quantity, price }) =>
  request("/api/v1/orders", {
    method: "POST",
    body: { symbol, side, type, quantity, price },
    idempotencyKey: randomUUID(),
  });

export const cancelOrder = (orderId) =>
  request(`/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
  });
