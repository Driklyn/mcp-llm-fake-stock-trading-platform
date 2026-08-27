/**
 * Typed REST client for the serverless market API (infra/) served through
 * CloudFront. Used by the client in "direct" mode (GitHub Pages build) to hit
 * the `/api/v1/*` endpoints directly — no Node proxy server required.
 *
 * CORS is already configured end-to-end: API Gateway allows `*` origins and
 * both Lambdas return `Access-Control-Allow-Origin: *`.
 *
 * Every mutation carries a fresh `idempotencyKey` (browser crypto.randomUUID)
 * so an ambiguous timeout can be retried safely — the ledger dedupes replays.
 */

import { apiBaseUrl } from "../config";

export type CloudHolding = {
  symbol: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  value: number;
};

export type CloudOrder = {
  id: number;
  symbol: string;
  side: string;
  type: string;
  quantity: number;
  price: number;
  status: string;
  created_at: number;
  executed_at: number | null;
  fill_price: number | null;
};

export type CloudTrade = {
  id: number;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  created_at: number;
};

export type CloudTransfer = {
  id: number;
  amount: number;
  created_at: number;
};

export type CloudPortfolio = {
  ok?: boolean;
  cash: number;
  holdings: CloudHolding[];
  totalValue: number;
  costBasis: number;
  realizedGains: number;
  investedValue: number;
  totalEquity: number;
  cashTransferred: number;
  openOrders: CloudOrder[];
  recentTrades: CloudTrade[];
  recentTransfers: CloudTransfer[];
  generatedAt: number;
};

export type CloudTicks = {
  symbol: string;
  generatedAt: number;
  from: number;
  to: number;
  count: number;
  points: Array<{ timestamp: number; price: number }>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, init);
  } catch (error) {
    throw new Error(
      `Could not reach ${apiBaseUrl}: ${(error as Error)?.message ?? error}`,
    );
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string } | null;
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function newIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts / very old browsers.
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function fetchPortfolio(): Promise<CloudPortfolio> {
  return request<CloudPortfolio>("/api/v1/portfolio");
}

export async function fetchTicks(limit = 1): Promise<CloudTicks> {
  const clamped = Math.min(960, Math.max(1, Math.floor(limit)));
  return request<CloudTicks>(`/api/v1/ticks?limit=${clamped}`);
}

export type CloudTradeResult = {
  ok: boolean;
  replay?: boolean;
  trade?: CloudTrade;
  fillPrice?: number;
  portfolio?: {
    cash: number;
    symbol: string;
    quantity: number;
    averagePrice: number;
  };
};

export async function postTrade(
  side: "BUY" | "SELL",
  quantity: number,
): Promise<CloudTradeResult> {
  return request<CloudTradeResult>(
    "/api/v1/trades",
    jsonInit("POST", {
      symbol: "FAKE",
      side,
      quantity,
      idempotencyKey: newIdempotencyKey(),
    }),
  );
}

export type CloudTransferResult = {
  ok: boolean;
  replay?: boolean;
  transfer?: CloudTransfer;
  amount: number;
  cash: number;
};

export async function postTransfer(
  amount: number,
): Promise<CloudTransferResult> {
  return request<CloudTransferResult>(
    "/api/v1/transfers",
    jsonInit("POST", { amount, idempotencyKey: newIdempotencyKey() }),
  );
}

export type CloudOrderResult = {
  ok: boolean;
  order: CloudOrder;
};

export async function placeOrder(
  side: "BUY" | "SELL",
  type: "limit" | "stop",
  quantity: number,
  price: number,
): Promise<CloudOrderResult> {
  return request<CloudOrderResult>(
    "/api/v1/orders",
    jsonInit("POST", {
      symbol: "FAKE",
      side,
      type,
      quantity,
      price,
      idempotencyKey: newIdempotencyKey(),
    }),
  );
}

export async function cancelOrder(
  orderId: number | string,
): Promise<CloudOrderResult> {
  return request<CloudOrderResult>(
    `/api/v1/orders/${encodeURIComponent(String(orderId))}/cancel`,
    jsonInit("POST", {}),
  );
}
