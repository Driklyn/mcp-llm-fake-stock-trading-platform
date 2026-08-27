/**
 * ticks-fetcher — GET /api/v1/ticks/4h and GET /api/v1/ticks/latest.
 *
 * Reads realized ticks from the DynamoDB market_price_history table and hides
 * anything the ticks-generator pre-populated for the future: the query enforces
 * a strict timestamp gate (timestamp <= current server time), so the 0s/15s/30s/45s
 * slots of the current minute only appear once their time has arrived.
 *
 * The window is resolved from the request path (event.rawPath); user-supplied
 * limit/from query strings are ignored entirely:
 *   /api/v1/ticks/latest → limit: 1
 *   /api/v1/ticks/4h     → limit: 960, from: now − 4h
 *   /api/v1/ticks        → same as /4h (backward-compatible default)
 *   anything else        → 404
 *
 * Environment:
 *   MARKET_TABLE  default "market_price_history"
 *   MARKET_SYMBOL default "FAKE"
 */

import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";

export const BLOCK_SECONDS = 15;
export const DEFAULT_TABLE = "market_price_history";
export const DEFAULT_SYMBOL = "FAKE";
export const DEFAULT_HISTORY_LIMIT = 960; // 4h of 15s ticks
export const DEFAULT_HISTORY_WINDOW_SECONDS =
  DEFAULT_HISTORY_LIMIT * BLOCK_SECONDS; // 14400

/**
 * Resolve the query window from the request path. Unknown routes return null
 * (the handler answers 404). Query-string params are deliberately ignored.
 */
export function resolveWindow(event, nowSeconds) {
  const rawPath = event?.rawPath ?? "";
  if (rawPath.endsWith("/latest")) {
    return { limit: 1, from: nowSeconds - DEFAULT_HISTORY_WINDOW_SECONDS };
  }
  // /4h, the bare /api/v1/ticks, or a missing path all resolve to the full 4h
  // window (960 points, oldest-first).
  if (rawPath === "" || rawPath.endsWith("/4h") || rawPath.endsWith("/ticks")) {
    return {
      limit: DEFAULT_HISTORY_LIMIT,
      from: nowSeconds - DEFAULT_HISTORY_WINDOW_SECONDS,
    };
  }
  return null;
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

export async function handler(event = {}) {
  const region = process.env.AWS_REGION ?? "us-east-1";
  const tableName = process.env.MARKET_TABLE ?? DEFAULT_TABLE;
  const symbol = process.env.MARKET_SYMBOL ?? DEFAULT_SYMBOL;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const window = resolveWindow(event, nowSeconds);
  if (!window) {
    return apiResponse(404, {
      ok: false,
      error: `Unknown ticks route: ${event?.rawPath ?? "(no path)"}`,
    });
  }
  const { limit, from } = window;

  const client = new DynamoDBClient({ region });
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "symbol = :symbol AND #ts BETWEEN :from AND :now",
      ExpressionAttributeNames: {
        "#ts": "timestamp", // Safeguard the reserved keyword
      },
      ExpressionAttributeValues: {
        ":symbol": { S: symbol },
        ":from": { N: String(from) },
        ":now": { N: String(nowSeconds) },
      },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  const points = (result.Items ?? [])
    .map((item) => ({
      timestamp: Number(item.timestamp?.N),
      price: Number(item.price?.N),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) && Number.isFinite(point.price),
    )
    .reverse(); // DynamoDB returned newest-first; serve oldest-first

  return apiResponse(200, {
    symbol,
    generatedAt: nowSeconds,
    from,
    to: nowSeconds,
    count: points.length,
    points,
  });
}
