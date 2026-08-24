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
- Persistent state stored in `server/data/state.json`
- Canvas-based price chart with chart-data processing in a Web Worker
- A small Vanilla Extract design-system package (`ui`) shared with the client

## Monorepo Layout

This project is an npm workspaces monorepo:

| Package  | Path      | Description                                                                 |
| -------- | --------- | --------------------------------------------------------------------------- |
| `server` | `server/` | Express + WebSocket market server, trading engine, MCP layer, LLM assistant, JSON persistence |
| `client` | `client/` | Vite + React 18 + TypeScript front end (portfolio, chart, chat, manual trading) |
| `ui`     | `ui/`     | Shared React component library and design tokens built with Vanilla Extract  |

## Local Development

Prerequisites: Node.js with npm.

1. Install dependencies: `npm install`
2. Start the backend: `npm run dev:server`
3. Start the front-end: `npm run dev`
4. Open http://localhost:5173

The server listens on port 3001 and serves the REST, WebSocket, and MCP HTTP endpoints.

### Scripts

| Script | Description |
| ------ | ----------- |
| `npm run dev` | Start the Vite client dev server |
| `npm run dev:server` | Start the market / WebSocket / API server |
| `npm run build` | Build the client for production |
| `npm test` | Run the server test suite (`node --test`) |
| `npm run mcp --workspace server` | Run the MCP server over stdio |
| `npm run typecheck --workspace client` | Type-check the client |

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

The MCP server exposes the trading engine as tools for MCP-capable AI clients. Run it
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

All tools share state with the WebSocket server, so actions taken through the chat
panel, the manual trading panel, or MCP are reflected everywhere immediately.

## Design System (`ui`)

The `ui` package is a small React component library built with Vanilla Extract
(`@vanilla-extract/css` + `@vanilla-extract/sprinkles`). It provides layout primitives
(`AppShell`, `Layout`, `Panel`, `TopBar`), stats and tables, form inputs, chat
components, a transaction history view, and design tokens (`space`, `radii`,
`sprinkles`).

## Core Behaviors

- Single fake ticker: `FAKE`, seeded at $100 with $10,000 cash
- Price updates every 15 seconds via a bounded random walk ($20–$500)
- Cash transfers in and out
- Market buys and sells (by share count or dollar amount)
- Limit and stop orders that execute automatically when the market crosses the trigger
- Large-trade confirmation (10+ shares or $1,000+ value) before execution
- Portfolio snapshot including invested vs. uninvested cash and gains/losses
- Transaction history with status-aware, sortable rows
- Shared state across the market engine, WebSocket server, REST API, and MCP tools
- State persisted to `server/data/state.json` on every mutation and market tick

## Deployment Notes

### GitHub Pages

- Host the Vite static client on GitHub Pages.
- Run the Node server (REST + WebSocket + MCP) on a separate public backend.
- The client currently hardcodes `http://localhost:3001`; extract it into an
  environment variable and point it at the deployed backend before shipping.

### AWS (free-tier-friendly)

- Host the frontend in S3 + CloudFront.
- Host the Node server in a free-tier EC2 / Lightsail instance.
- Use HTTPS and a public WebSocket endpoint for the live market feed.
- Persist app state to a file or lightweight database if desired.
