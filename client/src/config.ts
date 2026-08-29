/**
 * Build-time client configuration.
 *
 * Two connection modes, selected at build time via environment variables:
 *
 * - proxy (default, local dev): `VITE_API_BASE_URL` / `VITE_CDN_BASE_URL`
 *   unset. The client talks to the Node dev server at http://localhost:3001
 *   (REST + WebSocket), which proxies the cloud ledger and hosts the LLM/MCP
 *   assistant layer.
 *
 * - direct (GitHub Pages / client-only): two endpoints are baked in at build
 *   time — `VITE_CDN_BASE_URL` (CloudFront) for GET /api/v1/ticks/* (the 14s
 *   edge cache shields the 1-RCU DynamoDB table) and `VITE_API_BASE_URL`
 *   (HTTP API Gateway) for every dynamic route (portfolio, trades, orders,
 *   transfers, assistant). Bypassing CloudFront on dynamic routes fixes CORS
 *   and enables zero-buffered LLM text streaming. No Node server required.
 *   WebSocket is unavailable through the CloudFront HTTP distribution, so the
 *   market price stays deterministic/local and the ledger polls every 15s.
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

export const isDirectMode = Boolean(
  typeof import.meta.env.VITE_API_BASE_URL === "string" &&
    import.meta.env.VITE_API_BASE_URL.trim().length > 0,
);

export const apiBaseUrl = stripTrailingSlash(
  env("VITE_API_BASE_URL", "http://localhost:3001"),
);

// GET /api/v1/ticks/* is served through the CloudFront edge (14s cache) to
// protect the 1-RCU DynamoDB table. Falls back to apiBaseUrl when unset, so
// local proxy-mode development keeps working unchanged.
export const cdnBaseUrl = stripTrailingSlash(
  env("VITE_CDN_BASE_URL", apiBaseUrl),
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
