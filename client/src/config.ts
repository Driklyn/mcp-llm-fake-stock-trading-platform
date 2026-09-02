/**
 * Build-time client configuration.
 *
 * Two connection modes, selected at build time via environment variables:
 *
 * - proxy (default, local dev): `IS_DIRECT_MODE` unset. The client talks to
 *   the Node dev server at http://localhost:3001 (REST + WebSocket), which
 *   proxies the cloud ledger and hosts the LLM/MCP assistant layer. Leftover
 *   `VITE_API_BASE_URL` / `VITE_CDN_BASE_URL` values are ignored.
 *
 * - direct (GitHub Pages / client-only): opt in with `IS_DIRECT_MODE` set to a
 *   truthy value. Two endpoints are baked in at build time —
 *   `VITE_CDN_BASE_URL` (CloudFront) for GET /api/v1/ticks/* plus the cached
 *   fixed-window ledger feed `/api/v1/transactions/50` (the 14s edge cache
 *   shields the 1-RCU DynamoDB table and the DSQL ledger) and `VITE_API_BASE_URL`
 *   (HTTP API Gateway) for every dynamic route (portfolio, orders, transfers
 *   POST, assistant). Bypassing CloudFront on dynamic routes fixes CORS and
 *   enables zero-buffered LLM text streaming. No Node server required. WebSocket
 *   is unavailable through the CloudFront HTTP distribution, so the market price
 *   stays deterministic/local and the ledger
 *   polls every 15s.
 */

function env(key: string, fallback: string): string {
  const value = import.meta.env[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

// Direct mode is an explicit opt-in via IS_DIRECT_MODE (any truthy value), so
// leftover VITE_API_BASE_URL / VITE_CDN_BASE_URL in the shell or .env.local
// can't accidentally flip the client into direct mode during local dev.
const isDirectModeValue = env("IS_DIRECT_MODE", "");
export const isDirectMode = Boolean(
  isDirectModeValue.length > 0 &&
  !["0", "false", "no", "off"].includes(isDirectModeValue.toLowerCase()),
);

// Proxy mode always targets the Node dev server; direct mode requires the
// baked-in API Gateway URL.
export const apiBaseUrl = stripTrailingSlash(
  isDirectMode ? env("VITE_API_BASE_URL", "") : "http://localhost:3001",
);

// GET /api/v1/ticks/* plus the fixed-window ledger feed (/api/v1/transactions/50)
// are served through the CloudFront edge (14s cache) to protect the 1-RCU DynamoDB
// table and the DSQL ledger. Only used in direct mode; proxy mode hits the Node
// server at the same localhost base. Falls back to apiBaseUrl when unset.
export const cdnBaseUrl = stripTrailingSlash(
  isDirectMode ? env("VITE_CDN_BASE_URL", apiBaseUrl) : "http://localhost:3001",
);

export const wsUrl = stripTrailingSlash(
  env("VITE_WS_URL", isDirectMode ? "" : "ws://localhost:3001"),
);

export const assistantUrl = stripTrailingSlash(
  env(
    "VITE_ASSISTANT_URL",
    isDirectMode
      ? `${apiBaseUrl}/api/v1/assistant`
      : `${apiBaseUrl}/api/assistant`,
  ),
);
