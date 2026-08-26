/**
 * ticks-fetcher — GET /api/v1/ticks.
 *
 * Reads realized ticks from the DynamoDB market_price_history table and hides
 * anything the ticks-generator pre-populated for the future: the query enforces
 * a strict timestamp gate (timestamp <= current server time), so the 0s/15s/30s/45s
 * slots of the current minute only appear once their time has arrived.
 *
 * Optional query string params (included in the CloudFront cache key):
 *   limit  max number of points to return, 1..960 (default 960 = 4h of 15s ticks)
 *   from   lower bound epoch-seconds (default: now - 4h)
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
export const MAX_HISTORY_LIMIT = 960;
export const DEFAULT_HISTORY_WINDOW_SECONDS =
  DEFAULT_HISTORY_LIMIT * BLOCK_SECONDS; // 14400

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function parseQuery(event) {
  const out = { ...(event?.queryStringParameters ?? {}) };
  const raw = event?.rawQueryString ?? "";
  for (const pair of raw.split("&")) {
    if (!pair) continue;
    const [key, value] = pair.split("=");
    if (!key) continue;
    out[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
  }
  return out;
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
  const query = parseQuery(event);
  const limit = clampInt(
    query.limit,
    1,
    MAX_HISTORY_LIMIT,
    DEFAULT_HISTORY_LIMIT,
  );
  const requestedFrom = Number(query.from);
  const from = Number.isFinite(requestedFrom)
    ? Math.max(0, Math.floor(requestedFrom))
    : nowSeconds - DEFAULT_HISTORY_WINDOW_SECONDS;

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
