/**
 * Build-time client configuration.
 *
 * Two connection modes, selected at build time via environment variables:
 *
 * - proxy (default, local dev): `VITE_API_BASE_URL` unset. The client talks to
 *   the Node dev server at http://localhost:3001 (REST + WebSocket), which
 *   proxies the CloudFront ledger and hosts the LLM/MCP assistant layer.
 *
 * - direct (GitHub Pages / client-only): `VITE_API_BASE_URL` set to the AWS
 *   CloudFront base URL (e.g. https://dxxxxxxxxxxxx.cloudfront.net). The client
 *   calls the `/api/v1/*` REST API directly — no Node server required.
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
