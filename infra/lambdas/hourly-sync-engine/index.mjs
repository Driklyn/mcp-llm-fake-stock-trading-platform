/**
 * hourly-sync-engine — DynamoDB -> Aurora DSQL replication worker.
 *
 * EventBridge cron(0 * * * ? *) fires this once per hour. It:
 *   1. Batch-reads the last SYNC_POINT_COUNT (240 = 1 hour) realized tick
 *      points from DynamoDB (timestamp <= now), oldest-first.
 *   2. Opens a single IAM-authenticated pg connection to Aurora DSQL (public
 *      endpoint, port 5432, SSL).
 *   3. Ensures price_history exists (idempotent CREATE TABLE IF NOT EXISTS).
 *   4. Writes every point in exactly ONE multi-row bulk
 *      INSERT ... VALUES (...),(...) ... ON CONFLICT (symbol, ts) DO NOTHING.
 *
 * Hot reads and 15-second price ticks live in DynamoDB; the append-only
 * analytical copy lives in Aurora DSQL. Re-runs and overlapping windows never
 * duplicate rows (idempotent by design).
 *
 * Environment:
 *   DSQL_ENDPOINT    cluster endpoint hostname (required)
 *   DSQL_DATABASE    default "postgres"
 *   DSQL_USER        default "admin"
 *   DSQL_PORT        default 5432
 *   MARKET_TABLE     default "market_price_history"
 *   MARKET_SYMBOL    default "FAKE"
 *   SYNC_POINT_COUNT default 240
 */

import pg from "pg";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { DsqlSigner } from "@aws-sdk/dsql-signer";

const { Pool } = pg;

export const DEFAULT_TABLE = "market_price_history";
export const DEFAULT_SYMBOL = "FAKE";
export const DEFAULT_SYNC_POINT_COUNT = 240; // 1h of 15s ticks
export const MAX_SYNC_POINT_COUNT = 960;

const CREATE_PRICE_HISTORY = `
  CREATE TABLE IF NOT EXISTS price_history (
    symbol TEXT NOT NULL,
    ts BIGINT NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (symbol, ts)
  )
`;

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
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

export async function handler(event = {}) {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const tableName = process.env.MARKET_TABLE ?? DEFAULT_TABLE;
  const symbol = process.env.MARKET_SYMBOL ?? DEFAULT_SYMBOL;
  const pointCount = clampInt(
    process.env.SYNC_POINT_COUNT,
    1,
    MAX_SYNC_POINT_COUNT,
    DEFAULT_SYNC_POINT_COUNT,
  );
  const endpoint = process.env.DSQL_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      "DSQL_ENDPOINT environment variable is required (Aurora DSQL cluster endpoint hostname).",
    );
  }

  // 1. Read the last N realized points from DynamoDB (newest-first).
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ddb = new DynamoDBClient({ region });
  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "symbol = :symbol AND timestamp <= :now",
      ExpressionAttributeValues: {
        ":symbol": { S: symbol },
        ":now": { N: String(nowSeconds) },
      },
      ScanIndexForward: false,
      Limit: pointCount,
    }),
  );

  const points = (queryResult.Items ?? [])
    .map((item) => ({
      timestamp: Number(item.timestamp?.N),
      price: Number(item.price?.N),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) && Number.isFinite(point.price),
    )
    .reverse(); // oldest-first for the INSERT

  if (points.length === 0) {
    return { status: "no-data", symbol, synced: 0 };
  }

  // 2-4. Open DSQL, ensure schema, single multi-row bulk INSERT.
  const pool = await connectToDsql(region, endpoint);
  try {
    await pool.query(CREATE_PRICE_HISTORY);

    const bindParams = [];
    const valueGroups = [];
    points.forEach((point, index) => {
      const offset = index * 3;
      valueGroups.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
      bindParams.push(symbol, point.timestamp, point.price);
    });

    const insertResult = await pool.query(
      `INSERT INTO price_history (symbol, ts, price)
       VALUES ${valueGroups.join(", ")}
       ON CONFLICT (symbol, ts) DO NOTHING`,
      bindParams,
    );

    const summary = {
      status: "ok",
      symbol,
      read: points.length,
      inserted: insertResult.rowCount ?? 0,
      firstTimestamp: points[0].timestamp,
      lastTimestamp: points[points.length - 1].timestamp,
      synced: points.length,
    };
    console.log("hourly-sync-engine:", JSON.stringify(summary));
    return summary;
  } finally {
    await pool.end();
  }
}
