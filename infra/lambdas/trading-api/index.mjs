/**
 * trading-api — the market's financial API (Aurora DSQL ledger).
 *
 * Routes:
 *   GET  /api/v1/portfolio                   account summary (cash, holdings, cost
 *                                            basis, realized gains, equity, invested
 *                                            value, cash transferred)
 *   POST /api/v1/trades                      execute a market BUY/SELL against the ledger
 *   GET  /api/v1/trades/50                  recent trade history (fixed 50-row window, query strings ignored)
 *   POST /api/v1/transfers                   deposit (+) or withdraw (-) cash
 *   GET  /api/v1/transfers/50               recent transfer history (fixed 50-row window, query strings ignored)
 *   POST /api/v1/orders                      place a LIMIT/STOP order
 *   GET  /api/v1/orders                      list orders (?status=open)
 *   POST /api/v1/orders/{orderId}/cancel     cancel an open order
 *   POST /api/v1/orders/process              evaluate open orders against the live price
 *                                            (manual fallback; fills are DynamoDB stream-driven)
 *
 * Aurora DSQL holds the entire account ledger:
 *   - portfolio:      position rows (symbol, quantity, average_price) + the CASH row
 *   - trades:         append-only market execution log (side BUY|SELL)
 *   - orders:         limit/stop order book (status open|executed|cancelled|failed)
 *   - transfers:      append-only cash in/out log (signed amounts)
 *   - price_history:  synced copy of realized prices, used as a price fallback
 *
 * The execution/valuation price is read live from DynamoDB with a graceful fallback
 * chain: DynamoDB latest realized tick -> DSQL latest synced row -> deterministic
 * base price. Orders are filled reactively: the DynamoDB stream (INSERT-only
 * filter) wakes this handler on every fresh tick and processOrders() runs against
 * the new price. The POST /api/v1/orders/process route is kept as a manual fallback.
 *
 * Connection contract (no HTTP Data API):
 *   - Aurora DSQL PostgreSQL-wire protocol on port 5432 (public endpoint).
 *   - IAM db-connect token from @aws-sdk/client-dsql
 *     (generateDbConnectAdminAuthToken) used as the pg password.
 *   - SSL enabled with rejectUnauthorized: false (DSQL cert chain).
 *
 * Idempotency: every mutation accepts an optional `idempotencyKey`. When the same
 * key is seen again the stored result is returned instead of re-executing (the local
 * server proxy generates a fresh UUID per logical operation, so retries are safe).
 *
 * Environment:
 *   DSQL_ENDPOINT      cluster endpoint hostname (required)
 *   DSQL_DATABASE      default "postgres"
 *   DSQL_USER          default "admin"
 *   DSQL_PORT          default 5432
 *   MARKET_TABLE       default "market_price_history"
 *   MARKET_SYMBOL      default "FAKE"
 *   MARKET_BASE_PRICE  default 100 (last-resort price fallback)
 *   ACCOUNT_START_CASH default 100000
 */

import pg from "pg";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { DsqlSigner } from "@aws-sdk/dsql-signer";

const { Pool } = pg;

export const DEFAULT_TABLE = "market_price_history";
export const DEFAULT_SYMBOL = "FAKE";
export const DEFAULT_BASE_PRICE = 100;
export const DEFAULT_START_CASH = 100000;
export const CASH_SYMBOL = "CASH";

// Idempotent schema guard. Multi-statement simple query (no bind params), so
// node-postgres sends it over the simple protocol. The ALTER is a no-op on
// fresh clusters and adds the idempotency column to pre-existing trades tables.
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS price_history (
    symbol TEXT NOT NULL,
    ts BIGINT NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (symbol, ts)
  );
  CREATE TABLE IF NOT EXISTS portfolio (
    symbol TEXT PRIMARY KEY,
    quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    average_price DOUBLE PRECISION NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trades (
    id BIGINT GENERATED ALWAYS AS IDENTITY (CACHE 65536) PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    created_at BIGINT NOT NULL,
    idempotency_key TEXT
  );
  CREATE TABLE IF NOT EXISTS orders (
    id BIGINT GENERATED ALWAYS AS IDENTITY (CACHE 65536) PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at BIGINT NOT NULL,
    executed_at BIGINT,
    fill_price DOUBLE PRECISION,
    idempotency_key TEXT
  );
  CREATE TABLE IF NOT EXISTS transfers (
    id BIGINT GENERATED ALWAYS AS IDENTITY (CACHE 65536) PRIMARY KEY,
    amount DOUBLE PRECISION NOT NULL,
    created_at BIGINT NOT NULL,
    idempotency_key TEXT
  );
  ALTER TABLE trades ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
`;

export class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}

function apiResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  let raw = event?.body ?? "";
  if (event?.isBase64Encoded) {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

async function connectToDsql(region, endpoint) {
  const signer = new DsqlSigner({
    hostname: endpoint,
    region: region,
  });
  const authToken = await signer.getDbConnectAdminAuthToken();

  return new Pool({
    host: endpoint,
    port: Number(process.env.DSQL_PORT ?? 5432),
    database: process.env.DSQL_DATABASE ?? "postgres",
    user: process.env.DSQL_USER ?? "admin",
    password: authToken,
    ssl: { rejectUnauthorized: false }, // SSL is mandatory for DSQL
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Latest realized price: DynamoDB tick (timestamp <= now), then the DSQL
 * price_history copy, then the configured base price.
 */
async function latestPrice(region, symbol, pool) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tableName = process.env.MARKET_TABLE ?? DEFAULT_TABLE;
  const ddb = new DynamoDBClient({ region });
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "symbol = :symbol AND #ts <= :now",
      ExpressionAttributeNames: {
        "#ts": "timestamp", // Safeguard the reserved keyword
      },
      ExpressionAttributeValues: {
        ":symbol": { S: symbol },
        ":now": { N: String(nowSeconds) },
      },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  const item = result.Items?.[0];
  if (item?.price?.N != null) {
    return Number(item.price.N);
  }

  const fallback = await pool.query(
    `SELECT price FROM price_history WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol],
  );
  if (fallback.rows[0]) {
    return Number(fallback.rows[0].price);
  }

  const basePrice = Number(process.env.MARKET_BASE_PRICE ?? DEFAULT_BASE_PRICE);
  return Number.isFinite(basePrice) ? basePrice : DEFAULT_BASE_PRICE;
}

/**
 * Fold the append-only trades ledger into account metrics using average-cost
 * accounting (the same model the local engine used before the cloud migration).
 * Pure — exported for unit tests.
 */
export function foldTradeLedger(trades, startCash = 0) {
  let cash = Number(startCash);
  let holdings = 0;
  let costBasis = 0;
  let realizedGains = 0;

  for (const trade of trades) {
    const qty = Number(trade.quantity);
    const price = Number(trade.price);
    if (trade.side === "BUY") {
      cash -= price * qty;
      holdings += qty;
      costBasis += price * qty;
    } else if (trade.side === "SELL") {
      const avg = holdings > 0 ? costBasis / holdings : price;
      const proceeds = price * qty;
      const costOfSold = avg * qty;
      cash += proceeds;
      realizedGains += proceeds - costOfSold;
      costBasis = Math.max(0, costBasis - costOfSold);
      holdings = Math.max(0, holdings - qty);
    }
  }

  return {
    cash: round2(cash),
    holdings,
    costBasis: round2(costBasis),
    realizedGains: round2(realizedGains),
  };
}

/**
 * Order trigger rules (mirror the previous local engine):
 *   limit buy  fills when price <= trigger; limit sell fills when price >= trigger
 *   stop  buy  fills when price >= trigger; stop  sell fills when price <= trigger
 * Pure — exported for unit tests.
 */
export function orderTriggered(order, currentPrice) {
  const type = String(order?.type ?? "").toLowerCase();
  const side = String(order?.side ?? "").toUpperCase();
  const trigger = Number(order?.price);
  const price = Number(currentPrice);
  if (type === "limit") {
    return side === "BUY" ? price <= trigger : price >= trigger;
  }
  if (type === "stop") {
    return side === "BUY" ? price >= trigger : price <= trigger;
  }
  return false;
}

async function readCashAndPosition(client, symbol) {
  const cashRows = await client.query(
    "SELECT quantity FROM portfolio WHERE symbol = $1",
    [CASH_SYMBOL],
  );
  const positionRows = await client.query(
    "SELECT quantity, average_price FROM portfolio WHERE symbol = $1",
    [symbol],
  );
  return {
    cash: Number(
      cashRows.rows[0]?.quantity ??
        process.env.ACCOUNT_START_CASH ??
        DEFAULT_START_CASH,
    ),
    positionQty: Number(positionRows.rows[0]?.quantity ?? 0),
    positionAvg: Number(positionRows.rows[0]?.average_price ?? 0),
  };
}

/**
 * The single ledger write path for both market trades and order fills: validates
 * cash/position, upserts the position + CASH rows, and returns the post-trade
 * portfolio snapshot. Callers own the surrounding transaction. Exported for tests.
 */
export async function applyFill(
  client,
  { symbol, side, quantity, fillPrice, nowSeconds },
) {
  const { cash, positionQty, positionAvg } = await readCashAndPosition(
    client,
    symbol,
  );
  const qty = Number(quantity);
  let newCash;
  let newQty;
  let newAvg;

  if (side === "BUY") {
    const cost = round2(fillPrice * qty);
    if (cost > cash) {
      throw new ApiError(
        400,
        `Insufficient cash: need ${round2(cost)}, have ${round2(cash)}.`,
      );
    }
    newCash = round2(cash - cost);
    newQty = positionQty + qty;
    newAvg =
      newQty > 0 ? (positionQty * positionAvg + qty * fillPrice) / newQty : 0;
  } else {
    if (qty > positionQty + 1e-9) {
      throw new ApiError(
        400,
        `Insufficient position: have ${positionQty} ${symbol}, asked to sell ${qty}.`,
      );
    }
    newCash = round2(cash + fillPrice * qty);
    newQty = positionQty - qty;
    newAvg = newQty > 0 ? positionAvg : 0;
  }

  if (newQty <= 1e-9) {
    await client.query("DELETE FROM portfolio WHERE symbol = $1", [symbol]);
  } else {
    await client.query(
      `INSERT INTO portfolio (symbol, quantity, average_price, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (symbol) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         average_price = EXCLUDED.average_price,
         updated_at = EXCLUDED.updated_at`,
      [symbol, newQty, newAvg, nowSeconds],
    );
  }

  await client.query(
    `INSERT INTO portfolio (symbol, quantity, average_price, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (symbol) DO UPDATE SET
       quantity = EXCLUDED.quantity,
       average_price = EXCLUDED.average_price,
       updated_at = EXCLUDED.updated_at`,
    [CASH_SYMBOL, newCash, 1, nowSeconds],
  );

  return { cash: newCash, quantity: newQty, averagePrice: round4(newAvg) };
}

async function executeTrade(pool, region, body) {
  const symbol = String(body?.symbol ?? "")
    .trim()
    .toUpperCase();
  const side = String(body?.side ?? "")
    .trim()
    .toUpperCase();
  const quantity = Number(body?.quantity);
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();

  if (!symbol) throw new ApiError(400, "symbol is required.");
  if (symbol === CASH_SYMBOL) {
    throw new ApiError(400, "CASH is a reserved symbol.");
  }
  if (side !== "BUY" && side !== "SELL") {
    throw new ApiError(400, "side must be 'BUY' or 'SELL'.");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ApiError(400, "quantity must be a positive number.");
  }

  // Idempotent replay: same key -> return the stored execution.
  if (idempotencyKey) {
    const existing = await pool.query(
      "SELECT id, symbol, side, quantity, price, created_at FROM trades WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      const position = await readCashAndPosition(pool, row.symbol);
      return {
        ok: true,
        replay: true,
        trade: row,
        fillPrice: Number(row.price),
        portfolio: {
          cash: position.cash,
          symbol: row.symbol,
          quantity: position.positionQty,
          averagePrice: round4(position.positionAvg),
        },
      };
    }
  }

  const fillPrice = await latestPrice(region, symbol, pool);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const portfolio = await applyFill(client, {
      symbol,
      side,
      quantity,
      fillPrice,
      nowSeconds,
    });
    const tradeResult = await client.query(
      `INSERT INTO trades (symbol, side, quantity, price, created_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, symbol, side, quantity, price, created_at`,
      [symbol, side, quantity, fillPrice, nowSeconds, idempotencyKey || null],
    );
    await client.query("COMMIT");

    return {
      ok: true,
      trade: tradeResult.rows[0],
      fillPrice,
      portfolio: {
        cash: portfolio.cash,
        symbol,
        quantity: portfolio.quantity,
        averagePrice: portfolio.averagePrice,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Resolve the ledger read-feed window from the request path. Unknown routes
 * return null (the handler answers 404). Query-string params are deliberately
 * ignored — the window is fixed at 50 rows.
 */
export function resolveFeedWindow(event) {
  const rawPath = event?.rawPath ?? "";
  if (rawPath === "/api/v1/trades/50") {
    return { feed: "trades", limit: 50 };
  }
  if (rawPath === "/api/v1/transfers/50") {
    return { feed: "transfers", limit: 50 };
  }
  return null;
}

async function getTrades(pool, limit) {
  const { rows } = await pool.query(
    `SELECT id, symbol, side, quantity, price, created_at
     FROM trades ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return { ok: true, trades: rows };
}

async function getTransfers(pool, limit) {
  const { rows } = await pool.query(
    `SELECT id, amount, created_at
     FROM transfers ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return { ok: true, transfers: rows };
}

async function postTransfer(pool, body) {
  const amount = Number(body?.amount);
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();

  if (!Number.isFinite(amount) || amount === 0) {
    throw new ApiError(
      400,
      "amount must be a non-zero number (positive deposits, negative withdrawals).",
    );
  }

  // Idempotent replay.
  if (idempotencyKey) {
    const existing = await pool.query(
      "SELECT id, amount FROM transfers WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      const cashResult = await pool.query(
        "SELECT quantity FROM portfolio WHERE symbol = $1",
        [CASH_SYMBOL],
      );
      return {
        ok: true,
        replay: true,
        transfer: existing.rows[0],
        amount: Number(existing.rows[0].amount),
        cash: round2(
          Number(
            cashResult.rows[0]?.quantity ??
              process.env.ACCOUNT_START_CASH ??
              DEFAULT_START_CASH,
          ),
        ),
      };
    }
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cashResult = await client.query(
      "SELECT quantity FROM portfolio WHERE symbol = $1",
      [CASH_SYMBOL],
    );
    const cash = Number(
      cashResult.rows[0]?.quantity ??
        process.env.ACCOUNT_START_CASH ??
        DEFAULT_START_CASH,
    );
    const newCash = round2(cash + amount);
    if (newCash < 0) {
      throw new ApiError(
        400,
        `Withdrawal exceeds available cash: have ${round2(cash)}, asked to withdraw ${round2(-amount)}.`,
      );
    }
    await client.query(
      `INSERT INTO portfolio (symbol, quantity, average_price, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (symbol) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         average_price = EXCLUDED.average_price,
         updated_at = EXCLUDED.updated_at`,
      [CASH_SYMBOL, newCash, 1, nowSeconds],
    );
    const transferResult = await client.query(
      `INSERT INTO transfers (amount, created_at, idempotency_key)
       VALUES ($1, $2, $3)
       RETURNING id, amount, created_at`,
      [amount, nowSeconds, idempotencyKey || null],
    );
    await client.query("COMMIT");

    return {
      ok: true,
      transfer: transferResult.rows[0],
      amount,
      cash: newCash,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function placeOrder(pool, body) {
  const symbol = String(body?.symbol ?? DEFAULT_SYMBOL)
    .trim()
    .toUpperCase();
  const side = String(body?.side ?? "")
    .trim()
    .toUpperCase();
  const type = String(body?.type ?? "")
    .trim()
    .toLowerCase();
  const quantity = Number(body?.quantity);
  const price = Number(body?.price);
  const idempotencyKey = String(body?.idempotencyKey ?? "").trim();

  if (symbol === CASH_SYMBOL) {
    throw new ApiError(400, "CASH is a reserved symbol.");
  }
  if (!["BUY", "SELL"].includes(side)) {
    throw new ApiError(400, "side must be 'BUY' or 'SELL'.");
  }
  if (!["limit", "stop"].includes(type)) {
    throw new ApiError(400, "type must be 'limit' or 'stop'.");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ApiError(400, "quantity must be a positive number.");
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new ApiError(400, "price must be greater than $0.");
  }

  // Idempotent replay.
  if (idempotencyKey) {
    const existing = await pool.query(
      `SELECT id, symbol, side, type, quantity, price, status, created_at, executed_at, fill_price
       FROM orders WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing.rows[0])
      return { ok: true, replay: true, order: existing.rows[0] };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const result = await pool.query(
    `INSERT INTO orders (symbol, side, type, quantity, price, status, created_at, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)
     RETURNING id, symbol, side, type, quantity, price, status, created_at, executed_at, fill_price`,
    [symbol, side, type, quantity, price, nowSeconds, idempotencyKey || null],
  );
  return { ok: true, order: result.rows[0] };
}

async function getOrders(pool, status) {
  const { rows } = status
    ? await pool.query(
        `SELECT id, symbol, side, type, quantity, price, status, created_at, executed_at, fill_price
         FROM orders WHERE status = $1 ORDER BY id DESC LIMIT 100`,
        [status],
      )
    : await pool.query(
        `SELECT id, symbol, side, type, quantity, price, status, created_at, executed_at, fill_price
         FROM orders ORDER BY id DESC LIMIT 100`,
      );
  return { ok: true, orders: rows };
}

async function cancelOrder(pool, orderId) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError(400, "orderId must be a positive integer.");
  }

  const result = await pool.query(
    `UPDATE orders SET status = 'cancelled'
     WHERE id = $1 AND status = 'open'
     RETURNING id, symbol, side, type, quantity, price, status, created_at, executed_at, fill_price`,
    [id],
  );
  if (result.rows[0]) return { ok: true, order: result.rows[0] };

  const existing = await pool.query(
    "SELECT id, status FROM orders WHERE id = $1",
    [id],
  );
  if (!existing.rows[0]) throw new ApiError(404, `Order ${id} not found.`);
  if (existing.rows[0].status === "cancelled") {
    // Idempotent replay: already cancelled.
    const row = await pool.query(
      `SELECT id, symbol, side, type, quantity, price, status, created_at, executed_at, fill_price
       FROM orders WHERE id = $1`,
      [id],
    );
    return { ok: true, replay: true, order: row.rows[0] };
  }
  throw new ApiError(
    409,
    `Order ${id} cannot be cancelled because it is already ${existing.rows[0].status}.`,
  );
}

/**
 * Evaluate every open order against the live price and fill the ones that have
 * triggered. Prices are resolved BEFORE the transaction is opened (the pool has
 * max 1 client, so we cannot issue pool queries while holding the only client
 * inside a transaction). A fill that fails validation (e.g. insufficient cash)
 * marks the order 'failed' without rolling back the rest of the batch.
 *
 * @param {string} [targetSymbol=null] - Optional stock symbol from reactive stream event.
 * @param {number} [streamPrice=null] - Optional explicit price passed directly from DynamoDB stream records to bypass lookups.
 */
async function processOrders(
  pool,
  region,
  targetSymbol = null,
  streamPrice = null,
) {
  const open = await pool.query(
    "SELECT id, symbol, side, type, quantity, price FROM orders WHERE status = 'open' ORDER BY id",
  );
  const pricedOrders = [];
  for (const order of open.rows) {
    const fillPrice =
      streamPrice !== null && order.symbol === targetSymbol
        ? streamPrice
        : await latestPrice(region, order.symbol, pool);

    if (orderTriggered(order, fillPrice)) {
      pricedOrders.push({ ...order, fillPrice });
    }
  }
  if (pricedOrders.length === 0) return { ok: true, processed: 0 };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query("BEGIN");
    for (const order of pricedOrders) {
      try {
        await applyFill(client, {
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          fillPrice: order.fillPrice,
          nowSeconds,
        });
        await client.query(
          `INSERT INTO trades (symbol, side, quantity, price, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            order.symbol,
            order.side,
            order.quantity,
            order.fillPrice,
            nowSeconds,
          ],
        );
        await client.query(
          `UPDATE orders SET status = 'executed', executed_at = $1, fill_price = $2 WHERE id = $3`,
          [nowSeconds, order.fillPrice, order.id],
        );
        processed += 1;
      } catch (error) {
        await client.query(
          "UPDATE orders SET status = 'failed' WHERE id = $1",
          [order.id],
        );
        console.error(
          `trading-api: order ${order.id} fill failed:`,
          error.message,
        );
      }
    }
    await client.query("COMMIT");
    return { ok: true, processed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getPortfolio(pool, region) {
  const { rows } = await pool.query(
    "SELECT symbol, quantity, average_price FROM portfolio",
  );
  const cashRow = rows.find((row) => row.symbol === CASH_SYMBOL);
  const holdingRows = rows.filter((row) => row.symbol !== CASH_SYMBOL);

  const cash = round2(
    Number(
      cashRow?.quantity ?? process.env.ACCOUNT_START_CASH ?? DEFAULT_START_CASH,
    ),
  );

  const holdings = [];
  for (const row of holdingRows) {
    const quantity = Number(row.quantity);
    if (quantity <= 0) continue;
    const averagePrice = Number(row.average_price);
    const currentPrice = await latestPrice(region, row.symbol, pool);
    holdings.push({
      symbol: row.symbol,
      quantity,
      averagePrice: round4(averagePrice),
      currentPrice,
      value: round2(quantity * currentPrice),
    });
  }

  const investedValue = round2(holdings.reduce((sum, h) => sum + h.value, 0));
  const totalValue = round2(cash + investedValue);
  const costBasis = round2(
    holdings.reduce((sum, h) => sum + h.quantity * h.averagePrice, 0),
  );

  const tradesResult = await pool.query(
    "SELECT side, quantity, price FROM trades ORDER BY id",
  );
  const { realizedGains } = foldTradeLedger(tradesResult.rows);

  const transfersResult = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM transfers",
  );
  const cashTransferred = round2(Number(transfersResult.rows[0]?.total ?? 0));

  return {
    ok: true,
    cash,
    holdings,
    totalValue,
    costBasis,
    realizedGains: round2(realizedGains),
    investedValue,
    totalEquity: totalValue,
    cashTransferred,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

export async function handler(event = {}) {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const endpoint = process.env.DSQL_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      "DSQL_ENDPOINT environment variable is required (Aurora DSQL cluster endpoint hostname).",
    );
  }

  const pool = await connectToDsql(region, endpoint);
  try {
    // Idempotent schema guard — cheap DDL, removes any boot-order dependency.
    // Split the bundled multi-statement query string by semicolons and trim whitespace.
    const ddlStatements = SCHEMA_SQL.split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    // Execute each individual DDL statement completely sequentially, on its own network lifecycle.
    for (const statement of ddlStatements) {
      try {
        await pool.query(statement);
      } catch (ddlError) {
        console.error(
          `trading-api: Failed to execute individual DDL step: [${statement}]`,
          ddlError,
        );
        throw ddlError; // Halt execution if a critical structural creation fails
      }
    }

    // =========================================================================
    // 💡 NEW REACTIVE ENGINE ROUTE: DETECT & INTERCEPT DYNAMODB STREAM EVENTS
    // =========================================================================
    if (event?.Records && event.Records[0]?.eventSource === "aws:dynamodb") {
      console.log(
        `trading-api: Processing event stream batch containing ${event.Records.length} mutations.`,
      );

      let totalProcessedFromBatch = 0;

      // Loop over your records sequentially to process the 4 future ticks
      for (const record of event.Records) {
        if (record.eventName === "INSERT") {
          const symbol = record.dynamodb.NewImage.symbol.S;
          const price = parseFloat(record.dynamodb.NewImage.price.N);

          const result = await processOrders(pool, region, symbol, price);
          totalProcessedFromBatch += result.processed;
        }
      }

      console.log(
        `trading-api: Stream processing finished. Total orders filled:`,
        totalProcessedFromBatch,
      );
      return {
        ok: true,
        streamBatchProcessed: event.Records.length,
        totalOrdersFilled: totalProcessedFromBatch,
      };
    }

    // =========================================================================
    // STANDARD REST ROUTER (Maintains seamless compatibility for standard API calls)
    // =========================================================================
    const routeKey = event?.routeKey ?? "";
    if (routeKey === "GET /api/v1/portfolio") {
      return apiResponse(200, await getPortfolio(pool, region));
    }
    if (routeKey === "POST /api/v1/trades") {
      return apiResponse(
        200,
        await executeTrade(pool, region, parseBody(event)),
      );
    }
    if (routeKey === "GET /api/v1/trades/50") {
      const window = resolveFeedWindow(event);
      if (!window) {
        return apiResponse(404, {
          ok: false,
          error: `Unknown trades route: ${event?.rawPath ?? "(no path)"}`,
        });
      }
      return apiResponse(200, await getTrades(pool, window.limit));
    }
    if (routeKey === "GET /api/v1/transfers/50") {
      const window = resolveFeedWindow(event);
      if (!window) {
        return apiResponse(404, {
          ok: false,
          error: `Unknown transfers route: ${event?.rawPath ?? "(no path)"}`,
        });
      }
      return apiResponse(200, await getTransfers(pool, window.limit));
    }
    if (routeKey === "POST /api/v1/transfers") {
      return apiResponse(200, await postTransfer(pool, parseBody(event)));
    }
    if (routeKey === "POST /api/v1/orders") {
      return apiResponse(200, await placeOrder(pool, parseBody(event)));
    }
    if (routeKey === "GET /api/v1/orders") {
      return apiResponse(
        200,
        await getOrders(pool, event?.queryStringParameters?.status),
      );
    }
    if (routeKey === "POST /api/v1/orders/{orderId}/cancel") {
      return apiResponse(
        200,
        await cancelOrder(pool, event?.pathParameters?.orderId),
      );
    }
    if (routeKey === "POST /api/v1/orders/process") {
      return apiResponse(200, await processOrders(pool, region));
    }
    return apiResponse(404, { ok: false, error: `Unknown route: ${routeKey}` });
  } catch (error) {
    if (error instanceof ApiError) {
      return apiResponse(error.statusCode, { ok: false, error: error.message });
    }
    console.error("trading-api: fatal", error);
    return apiResponse(500, { ok: false, error: "Internal server error." });
  } finally {
    await pool.end();
  }
}
