# Fake MCP Stock Trading Platform

A full-stack fake stock trading demo. A Node.js server simulates a market and exposes
it through a WebSocket live feed, an MCP tool layer, and an optional LLM-powered chat
assistant. A Vite + React client renders the portfolio, an interactive canvas price
chart, and a chat panel that can buy, sell, and manage orders in plain English.

## Highlights

- Simulated `FAKE` ticker with a bounded random-walk price that ticks every 15 seconds
- Real-time market feed over WebSocket (`snapshot` and `market-tick` messages)
- Portfolio tracking: cash, holdings, cost basis, realized/unrealized gains, total equity
- Market orders plus limit and stop orders that execute when the price crosses the trigger
- Large-trade confirmation flow (10+ shares or $1,000+ value) across chat, WebSocket, and MCP
- MCP server (stdio + streamable HTTP) exposing 8 trading tools
- Deterministic natural-language intent parser, optionally backed by a local Ollama model
- Account ledger held in Aurora DSQL by the serverless `infra/` stack (`trading-api`);
  the local server is a stateless proxy over it
- Canvas-based price chart with chart-data processing in a Web Worker
- A small Vanilla Extract design-system package (`ui`) shared with the client

## Monorepo Layout

This project is an npm workspaces monorepo:

| Package  | Path      | Description                                                                                |
| -------- | --------- | ------------------------------------------------------------------------------------------ |
| `server` | `server/` | Express + WebSocket proxy over the deployed `trading-api` ledger, MCP layer, LLM assistant |
| `client` | `client/` | Vite + React 18 + TypeScript front end (portfolio, chart, chat, manual trading)            |
| `ui`     | `ui/`     | Shared React component library and design tokens built with Vanilla Extract                |

## Local Development

Prerequisites: Node.js with npm, plus a deployed instance of the serverless market
stack (`infra/`) — the local server is a **stateless proxy** over
`infra/lambdas/trading-api`. There is no local account state anymore.

1. Install dependencies: `npm install`
2. Deploy the infra stack and read the base URL from the Terraform output
   `trading_api_base_url` (see `infra/README.md`).
3. Start the backend, pointing it at the deployed API:

   TRADING_API_URL=https://<cloudfront-domain> npm run dev:server

4. Start the front-end: `npm run dev`
5. Open http://localhost:5173

The server listens on port 3001 and serves the REST, WebSocket, and MCP HTTP
endpoints. Every account read and mutation is delegated to trading-api; the price
feed comes from `GET /api/v1/ticks/4h` (windowed history) and `GET /api/v1/ticks/latest`
(current price), and the quote/snapshot are cached for 15s.

### Scripts

| Script                                 | Description                               |
| -------------------------------------- | ----------------------------------------- |
| `npm run dev`                          | Start the Vite client dev server          |
| `npm run dev:server`                   | Start the market / WebSocket / API server |
| `npm run build`                        | Build the client for production           |
| `npm test`                             | Run the server test suite (`node --test`) |
| `npm run mcp --workspace server`       | Run the MCP server over stdio             |
| `npm run typecheck --workspace client` | Type-check the client                     |

## Chat Assistant (Optional LLM)

The `POST /api/assistant` endpoint turns natural-language trading requests into tool
calls. A deterministic intent parser always produces a plan first; if a local Ollama
instance is available, the request is also sent to the LLM as a JSON tool-plan prompt,
and the two plans are reconciled.

- Model: `llama3.1:8b` by default
- Endpoint: `OLLAMA_BASE_URL` (defaults to `http://localhost:11434/api`)
- Safety: the deterministic plan wins when the LLM flips a buy into a sell (or vice
  versa), turns a conditional order into a market order, or fabricates intent

Supported intents: portfolio snapshots, price quotes, buying/selling shares (by
quantity or dollar amount), limit and stop orders, cash deposits/withdrawals, and
listing or canceling orders. Large trades return a confirmation prompt in the chat UI.

## MCP Server

The MCP server exposes the trading API as tools for MCP-capable AI clients. Run it
standalone over stdio:

```
npm run mcp --workspace server
```

Or connect through the main server's streamable HTTP transport at `POST /mcp` (with
`GET` / `DELETE` for SSE and session termination).

### Tools

- `get_account_snapshot` — cash, holdings, cost basis, gains/losses, total equity
- `get_quote` — current `FAKE` price and recent history
- `buy_stock` — market buy of `FAKE` shares
- `sell_stock` — market sell of `FAKE` shares
- `transfer_cash` — deposit or withdraw fake cash
- `place_order` — place a limit or stop buy/sell order
- `list_orders` — list pending and completed orders
- `cancel_order` — cancel an open order

All tools share the same Aurora DSQL ledger as the WebSocket server, so actions
taken through the chat panel, the manual trading panel, or MCP are reflected
everywhere immediately.

## Design System (`ui`)

The `ui` package is a small React component library built with Vanilla Extract
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
- Portfolio snapshot including invested vs. uninvested cash and gains/losses
- Transaction history with status-aware, sortable rows
- One shared ledger: every path (WebSocket, REST, MCP) writes through to Aurora DSQL

## Deployment Notes

### GitHub Pages (client-only, direct to CloudFront)

The client can run as a fully static site with no Node backend: build it with
the CloudFront base URL baked in, and the browser calls the `/api/v1/*` REST API
directly (CORS is already enabled on the API Gateway and Lambdas).

    VITE_API_BASE_URL=https://<cloudfront-domain> npm run build

The static output lands in `client/dist`. Host it anywhere — or push to GitHub
and let `.github/workflows/deploy-pages.yml` build with the `CLOUDFRONT_URL`
repository secret and deploy automatically (enable Pages → "GitHub Actions" in
the repo settings first).

What changes in direct mode:

- The ledger loads via `GET /api/v1/portfolio` and polls every 15s; no
  WebSocket (the CloudFront HTTP distribution has none).
- The 4h chart window loads from `GET /api/v1/ticks/4h` and refreshes append
  `GET /api/v1/ticks/latest`. If either endpoint is unreachable, the
  deterministic engine fills the gap with locally-generated ticks (identical
  seed/params), so the chart never freezes.
- The price chart stays deterministic/local — same engine as proxy mode.
- Manual trading calls the REST mutations directly with per-request
  `idempotencyKey`s; large trades (10+ shares or $1,000+) confirm in-browser.
- Chat posts to `<base>/api/v1/assistant` — forward-compatible with the planned
  Lambda-hosted MCP + OpenRouter assistant. Until that Lambda exists, chat
  surfaces the API's 404.

Keep developing LLM/MCP features locally as before: set `TRADING_API_URL`, run
`npm run dev:server`, then `npm run dev` (leave `VITE_API_BASE_URL` unset).

### AWS (free-tier-friendly)

- The full ledger, price feed, and trading API live in the serverless `infra/`
  stack (see `infra/README.md`): Aurora DSQL + DynamoDB + API Gateway +
  CloudFront + 4 Lambdas + EventBridge schedules + DynamoDB Streams, all inside the free tier.
- Run the Node proxy server anywhere that can reach the CloudFront URL
  (`TRADING_API_URL`), or serve the client directly from CloudFront as well.
- Use HTTPS and a public WebSocket endpoint for the live market feed when
  hosting the proxy server remotely.
