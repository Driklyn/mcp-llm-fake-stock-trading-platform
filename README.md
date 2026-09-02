# MCP+LLM Fake Stock Trading Platform

A full-stack fake stock trading platform. The account ledger and simulated market live in
a serverless AWS stack, exposed over REST with an MCP tool layer and an LLM-powered chat
assistant (optionally deterministic). A Vite + React client renders the portfolio, an
interactive canvas price chart, and a chat panel that can buy, sell, and manage orders in
plain English. The client is built to run as a static GitHub Pages site that polls the
REST API directly; you can optionally run the included Node server, which adds a WebSocket
live feed (in proxy mode) for local development.

**NOTE:** This project was created by Kevin Jurkowski as a portfolio piece. It was created
entirely using AI tooling (primarily Cline + DeepSeek, along with Google Gemini and the free
tier of Copilot). At the time of this writing, it took ~60 hours and ~$5.00 to create. [The
infrastructure](infra/README.md) was designed in such a way that it costs $0/month to run on AWS.

## Highlights

- Simulated `FAKE` ticker with a bounded random-walk price that ticks every 15 seconds
- Live market feed — by default the static client polls the ticks REST API every 15s;
  running the optional Node proxy adds a WebSocket stream (`account`, `transactions`, and `tick` messages)
- Portfolio tracking: cash, holdings, cost basis, realized/unrealized gains, total equity
- Market orders plus limit and stop orders that execute when the price crosses the trigger
- Large-trade confirmation flow (10+ shares or $1,000+ value) across chat, MCP, and
  the WebSocket proxy when running the local dev server
- MCP server (stdio + streamable HTTP) exposing 8 trading tools
- Deterministic natural-language intent parser, optionally backed by a local Ollama
  model or an OpenAI-compatible LLM (e.g. OpenRouter free tier)
- Account ledger held in Aurora DSQL by the serverless [`infra/`](infra/) stack (`trading-api`);
  the local server is a stateless proxy over it. The cloud `GET /api/v1/portfolio`
  endpoint is account-only — transactions come from the consolidated `GET /api/v1/transactions/50` ledger feed
- Canvas-based price chart
- A small Vanilla Extract design-system package ([`ui/`](ui/)) shared with the client

## Monorepo Layout

This project is an npm workspaces monorepo:

| Package          | Path                                 | Description                                                                                                                              |
| ---------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `server`         | [`server/`](server/)                 | Optional Express proxy over the deployed `trading-api` ledger (adds WebSocket live feed + MCP relay for local dev), chat assistant route |
| `client`         | [`client/`](client/)                 | Vite + React 18 + TypeScript front end (portfolio, chart, chat, manual trading)                                                          |
| `ui`             | [`ui/`](ui/)                         | Shared React component library and design tokens built with Vanilla Extract                                                              |
| `chat-assistant` | [`chat-assistant/`](chat-assistant/) | Host-agnostic chat assistant (LLM planner, tool execution, pending confirmations) shared by the dev server and the production Lambda     |

## Local Development

Prerequisites: Node.js with npm, plus a deployed instance of the serverless market
stack ([`infra/`](infra/)) — the local server is a **stateless proxy** over
[`infra/lambdas/trading-api`](infra/lambdas/trading-api/). There is no local account state anymore.

1. Install dependencies: `npm install`
2. Deploy the infra stack and read the two base URLs from the Terraform
   outputs `trading_api_base_url` (API Gateway) and `trading_cdn_base_url`
   (CloudFront) (see [`infra/README.md`](infra/README.md)).
3. Start the backend, pointing it at the deployed API:

   TRADING_API_BASE_URL=https://<api-gateway-domain> \
   TRADING_CDN_BASE_URL=https://<cloudfront-domain> npm run dev:server

4. Start the front-end: `npm run dev`
5. Open http://localhost:5173

When using this proxy, the server listens on port 3001 and serves the REST, MCP (HTTP),
and WebSocket endpoints. Every account read and mutation is delegated to trading-api by
this server. Account state is split into the independently-queryable `GET /api/portfolio`
(account summary) and `GET /api/transactions` (recent activity); the price feed comes
from `GET /api/v1/ticks/4h` (windowed history) and `GET /api/v1/ticks/latest`
(current price). Quotes and summaries are cached for 15s.

### Scripts

| Script                                 | Description                                                   |
| -------------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                          | Start the Vite client dev server                              |
| `npm run dev:server`                   | Start the market proxy server (REST + optional WebSocket/MCP) |
| `npm run build`                        | Build the client for production                               |
| `npm run build:assistant`              | Bundle the assistant Lambda into `assistant/dist`             |
| `npm test`                             | Run server + chat-assistant + assistant Lambda tests          |
| `npm run mcp --workspace server`       | Run the MCP server over stdio                                 |
| `npm run typecheck --workspace client` | Type-check the client                                         |

## Chat Assistant (Optional LLM)

The chat assistant turns natural-language trading requests into tool calls. A
deterministic intent parser always produces a plan first; if an LLM is
configured, the request is also sent as a JSON tool-plan prompt and the two
plans are reconciled. Safety: the deterministic plan wins when the LLM flips a
buy into a sell (or vice versa), turns a conditional order into a market order,
or fabricates intent.

One shared package ([`chat-assistant/`](chat-assistant/)) powers both hosts:

- **Local dev** — `POST /api/assistant` on the Node server (port 3001), with a
  local Ollama endpoint. Model: `llama3.1:8b` by default; `OLLAMA_BASE_URL`
  defaults to `http://localhost:11434/api`.
- **Production** — `POST /api/v1/assistant` on the deployed API Gateway, backed
  by the `assistant` Lambda. It targets an OpenAI-compatible endpoint (e.g.
  OpenRouter) configured through the Terraform `assistant_llm_*` variables,
  stores pending confirmations in a TTL-expiring DynamoDB table, and invokes
  `trading-api` / `ticks-fetcher` directly with `@aws-sdk/client-lambda`
  (no CloudFront round-trip inside the stack).

Supported intents: portfolio snapshots, price quotes, buying/selling shares (by
quantity or dollar amount), limit and stop orders, cash deposits/withdrawals,
and listing or canceling orders. Large trades ($1,000+) and cash transfers
($500+) return a confirmation prompt in the chat UI (stored in-memory in dev,
in DynamoDB in production).

## MCP Server

The MCP server exposes the trading API as tools for MCP-capable AI clients. Run it
standalone over stdio:

```
npm run mcp --workspace server
```

Or connect through the main server's streamable HTTP transport at `POST /mcp` (with
`GET` / `DELETE` for SSE and session termination).

### Tools

- `get_portfolio_summary` — cash, invested (cost basis), gains/losses, holdings, total equity
- `get_quote` — current `FAKE` price and recent history
- `buy_stock` — market buy of `FAKE` shares
- `sell_stock` — market sell of `FAKE` shares
- `transfer_cash` — deposit or withdraw fake cash
- `place_order` — place a limit or stop buy/sell order
- `list_orders` — list pending and completed orders
- `cancel_order` — cancel an open order

All MCP tools share the same Aurora DSQL ledger as the REST paths, so actions
taken through the chat panel, the manual trading panel, or MCP are reflected
everywhere immediately.

## Design System (`ui`)

The [`ui/`](ui/) package is a small React component library built with Vanilla Extract
(`@vanilla-extract/css` + `@vanilla-extract/sprinkles`). It provides layout primitives
(`AppShell`, `Layout`, `Panel`, `TopBar`), stats and tables, form inputs, chat
components, a transaction history view, and design tokens (`space`, `radii`,
`sprinkles`).

## Core Behaviors

- Single fake ticker: `FAKE`, seeded at $100 (Terraform `market_base_price`)
- Starting cash from the deployed `account_start_cash` (Terraform variable, default $10,000)
- Price updates every 15 seconds from the cloud ticks feed (`GET /api/v1/ticks/latest`)
- Cash transfers in and out (DSQL `transfers` ledger)
- Market buys and sells (by share count or dollar amount) executed by trading-api
- Limit and stop orders that trading-api fills reactively against the live price whenever a new tick arrives
- Large-trade confirmation (10+ shares or $1,000+ value) before execution
- Portfolio stats including invested vs. uninvested cash and gains/losses
- Transaction history with status-aware, sortable rows
- One shared ledger: every path (REST, MCP, and the optional WebSocket proxy) writes through to Aurora DSQL

## Deployment Notes

### GitHub Pages (client-only, dual endpoints)

The client can run as a fully static site with no Node backend: build it with
both base URLs baked in — the CloudFront domain for tick reads and the HTTP API
Gateway URL for everything else (CORS is already enabled on the API Gateway and
Lambdas).

    VITE_CDN_BASE_URL=https://<cloudfront-domain> \
    VITE_API_BASE_URL=https://<api-gateway-domain> npm run build

The static output lands in `client/dist`. Host it anywhere — or push to GitHub
and let [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) build with the `CLOUDFRONT_URL` and
`API_GATEWAY_URL` repository secrets and deploy automatically (enable Pages →
"GitHub Actions" in
the repo settings first).

What changes in direct mode:

- The ledger loads via `GET /api/v1/portfolio` and polls every 15s; no
  WebSocket (the CloudFront HTTP distribution has none).
- The 4h chart window loads from `GET /api/v1/ticks/4h` and refreshes append
  `GET /api/v1/ticks/latest`. If either endpoint is unreachable, the
  deterministic engine fills the gap with locally-generated ticks (identical
  seed/params), so the chart never freezes.
- The chart renders the merged API ticks (same retained-window logic as proxy
  mode); the deterministic engine only fills gaps when the ticks API is down.
- Manual trading calls the REST mutations directly with per-request
  `idempotencyKey`s; large trades (10+ shares or $1,000+) confirm in-browser.
- Chat posts to `<base>/api/v1/assistant` — served by the deployed `assistant`
  Lambda. The deterministic parser always works; the OpenRouter LLM is optional
  via the `assistant_llm_*` Terraform variables.

Keep developing LLM/MCP features locally as before: set `TRADING_API_BASE_URL` (API
Gateway) and `TRADING_CDN_BASE_URL` (CloudFront), run `npm run dev:server`, then
`npm run dev` (leave both `VITE_API_BASE_URL` and `VITE_CDN_BASE_URL` unset).

### AWS (free-tier-friendly)

- The full ledger, price feed, trading API, and chat assistant live in the
  serverless [`infra/`](infra/) stack (see [`infra/README.md`](infra/README.md)): Aurora DSQL + DynamoDB
  (price history + pending confirmations) + API Gateway + CloudFront + 5
  Lambdas + EventBridge schedules + DynamoDB Streams, all inside the free tier.
- Run the Node proxy server anywhere that can reach the API Gateway and
  CloudFront URLs (`TRADING_API_BASE_URL` / `TRADING_CDN_BASE_URL`), or serve the client
  directly from CloudFront as well.
- Use HTTPS and a public WebSocket endpoint for the live market feed when
  hosting the proxy server remotely.
