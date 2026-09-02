/**
 * Typed REST client for the serverless market API (infra/). Used by the client
 * in "direct" mode (GitHub Pages build) to hit the `/api/v1/*` endpoints
 * directly — no Node proxy server required.
 *
 * Dual-endpoint routing: GET /api/v1/ticks/* plus the fixed-window ledger
 * feed GET /api/v1/transactions/50 go through the CloudFront edge
 * (cdnBaseUrl — the 14s cache shields the 1-RCU DynamoDB table and the DSQL
 * ledger), while every dynamic route (portfolio, orders, POST trades/transfers)
 * hits the HTTP API Gateway directly (apiBaseUrl) to fix CORS and enable
 * zero-buffered LLM streaming. The tick paths are mode-dependent: direct mode
 * keeps the deployed /api/v1/ticks/* routes, proxy mode uses the Node server's
 * non-versioned /api/ticks/* passthrough.
 *
 * Both modes return the same raw Cloud payload shapes. The account summary
 * (`CloudPortfolioResponse.account`) is precomputed by the trading-api in
 * direct mode and relayed by the Node server in proxy mode; the ledger feed
 * (`CloudTransactionsResponse.transactions`) ships raw rows that the client
 * maps to `Transaction` once, in `account.ts`.
 *
 * CORS is already configured end-to-end: API Gateway allows `*` origins and
 * both Lambdas return `Access-Control-Allow-Origin: *`.
 *
 * Every mutation carries a fresh `idempotencyKey` (browser crypto.randomUUID)
 * so an ambiguous timeout can be retried safely — the ledger dedupes replays.
 */

import { apiBaseUrl, cdnBaseUrl, isDirectMode } from "../config";
import type { Account } from "../types";

export type CloudTradeSide = "BUY" | "SELL";
export type CloudOrderType = "limit" | "stop";
export type CloudOrderStatus = "open" | "cancelled" | "filled";

export type CloudOrder = {
  id: number;
  symbol: string;
  side: CloudTradeSide;
  type: CloudOrderType;
  quantity: number;
  price: number;
  status: CloudOrderStatus;
  created_at: number;
  executed_at: number | null;
  fill_price: number | null;
};

export type CloudPortfolioResponse = {
  ok?: boolean;
  account: Account;
  generatedAt?: number;
};

// Raw ledger rows from the fixed-window feed (GET /api/v1/transactions/50 and
// the proxy-mode /api/transactions relay). Each row carries only its own
// table's columns (no null-padded placeholders), discriminated on `table`.
// The client maps every row to the UI `Transaction` shape in account.ts.
export type CloudTransaction =
  | {
      table: "trade";
      id: number;
      symbol: string;
      side: CloudTradeSide;
      // "limit" | "stop" when a limit/stop order filled, else null (market).
      type: CloudOrderType | null;
      quantity: number;
      price: number;
      created_at: number;
    }
  | {
      table: "transfer";
      id: number;
      amount: number;
      created_at: number;
    }
  | {
      table: "order";
      id: number;
      symbol: string;
      side: CloudTradeSide;
      type: CloudOrderType;
      quantity: number;
      price: number;
      created_at: number;
    };

export type CloudTransactionsResponse = {
  ok?: boolean;
  transactions: CloudTransaction[];
};

export type CloudTicks = {
  symbol: string;
  generatedAt: number;
  from: number;
  to: number;
  count: number;
  points: Array<{ timestamp: number; price: number }>;
};

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new Error(
      `Could not reach ${baseUrl}: ${(error as Error)?.message ?? error}`,
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

export async function fetchPortfolio(
  signal?: AbortSignal,
): Promise<CloudPortfolioResponse> {
  return request<CloudPortfolioResponse>(
    apiBaseUrl,
    isDirectMode ? "/api/v1/portfolio" : "/api/portfolio",
    { signal },
  );
}

export type CloudOrdersResponse = {
  ok: boolean;
  orders: CloudOrder[];
};

export async function fetchOrders(
  signal?: AbortSignal,
): Promise<CloudOrdersResponse> {
  // The orders list is a dynamic route on the API Gateway base (like the rest
  // of the orders API) — only the /50 ledger feeds are CloudFront-cached.
  return request<CloudOrdersResponse>(apiBaseUrl, "/api/v1/orders", { signal });
}

export async function fetchTicks4h(signal?: AbortSignal): Promise<CloudTicks> {
  return request<CloudTicks>(
    cdnBaseUrl,
    isDirectMode ? "/api/v1/ticks/4h" : "/api/ticks/4h",
    { signal },
  );
}

export async function fetchLatestTick(
  signal?: AbortSignal,
): Promise<CloudTicks> {
  return request<CloudTicks>(
    cdnBaseUrl,
    isDirectMode ? "/api/v1/ticks/latest" : "/api/ticks/latest",
    { signal },
  );
}

export async function fetchTransactions(
  signal?: AbortSignal,
): Promise<CloudTransactionsResponse> {
  // The ledger feed is served through the CloudFront edge (14s cache) in
  // direct mode; proxy mode relays the raw rows through the Node server's
  // /api/transactions passthrough. Both return the same Cloud payload shape.
  return request<CloudTransactionsResponse>(
    cdnBaseUrl,
    isDirectMode ? "/api/v1/transactions/50" : "/api/transactions",
    { signal },
  );
}

export type CloudTradeResult = {
  ok: boolean;
  replay?: boolean;
  trade?: Omit<Extract<CloudTransaction, { table: "trade" }>, "table">;
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
    apiBaseUrl,
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
  transfer?: Omit<Extract<CloudTransaction, { table: "transfer" }>, "table">;
  amount: number;
  cash: number;
};

export async function postTransfer(
  amount: number,
): Promise<CloudTransferResult> {
  return request<CloudTransferResult>(
    apiBaseUrl,
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
    apiBaseUrl,
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
    apiBaseUrl,
    `/api/v1/orders/${encodeURIComponent(String(orderId))}/cancel`,
    jsonInit("POST", {}),
  );
}
