/**
 * ticks-generator — deterministic tick writer for the DynamoDB store layer.
 *
 * Two triggers:
 *   1. EventBridge schedule cron(* * * * ? *) — fires once per minute.
 *   2. POST /api/v1/ticks through the HTTP API Gateway (manual on-demand).
 *
 * Every invocation writes exactly four items — the four 15-second block
 * timestamps (0s, 15s, 30s, 45s) of the current UTC minute — in ONE
 * BatchWriteItem call. Prices come from the deterministic seededRandom walk
 * (Mulberry32), so any tick can be recomputed from (seed + blockIndex) without
 * any shared mutable state. Total runtime is ~50 ms.
 *
 * TTL: each item carries a "ttl" attribute equal to tick timestamp + 24h, so
 * DynamoDB natively evicts data older than 24 hours at zero cost. The TTL is
 * deliberately NOT the raw timestamp field: using the tick time itself as the
 * expiry would mark every item expired the instant its price goes live, and
 * DynamoDB would garbage-collect the history the fetcher and hourly sync
 * depend on.
 *
 * Environment (all optional):
 *   MARKET_TABLE       default "market_price_history"
 *   MARKET_SYMBOL      default "FAKE"
 *   MARKET_BASE_PRICE  default 100
 *   MARKET_VOLATILITY  default 0.002
 *   MARKET_START_EPOCH default 1787529600 (August 24, 2026 00:00 UTC)
 *   MARKET_SEED        default 20260824
 *   TICK_TTL_SECONDS   default 86400 (24h)
 */

import {
  DynamoDBClient,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";

export const BLOCK_SECONDS = 15;
export const TICK_SLOTS_PER_MINUTE = [0, 15, 30, 45];

export const DEFAULT_TABLE = "market_price_history";
export const DEFAULT_SYMBOL = "FAKE";

export const DEFAULT_PARAMS = Object.freeze({
  basePrice: 100,
  volatility: 0.002, // max ±0.2% swing per step
  startEpoch: 1787529600, // August 24, 2026 00:00 UTC
  seed: 20260824,
});

// ---------------------------------------------------------------------------
// Deterministic market math — bit-for-bit mirror of server/src/trading/market.js
// ---------------------------------------------------------------------------

function finiteOr(value, fallback) {
  if (value === "" || value == null) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function resolveParams(env = {}) {
  return {
    basePrice: finiteOr(env.MARKET_BASE_PRICE, DEFAULT_PARAMS.basePrice),
    volatility: finiteOr(env.MARKET_VOLATILITY, DEFAULT_PARAMS.volatility),
    startEpoch: finiteOr(env.MARKET_START_EPOCH, DEFAULT_PARAMS.startEpoch),
    seed: finiteOr(env.MARKET_SEED, DEFAULT_PARAMS.seed),
  };
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function blockForTime(timeSeconds) {
  return Math.round(Number(timeSeconds) / BLOCK_SECONDS);
}

export function changeForBlock(blockIndex, params) {
  const random = seededRandom((params.seed >>> 0) + (blockIndex >>> 0));
  return (random() - 0.5) * 2 * params.volatility;
}

export function getPriceAtTime(targetTimeSeconds, params) {
  const time = Number(targetTimeSeconds);
  const resolved = resolveParams(params);
  const startBlock = blockForTime(resolved.startEpoch);
  const targetBlock = blockForTime(time);
  if (targetBlock <= startBlock) return resolved.basePrice;

  let price = resolved.basePrice;
  for (let block = startBlock + 1; block <= targetBlock; block += 1) {
    price *= 1 + changeForBlock(block, resolved);
  }
  return price;
}

// ---------------------------------------------------------------------------
// DynamoDB + API response logic
// ---------------------------------------------------------------------------

export function minuteSlotsForTime(timeSeconds) {
  const minuteStart = Math.floor(Number(timeSeconds) / 60) * 60;
  return TICK_SLOTS_PER_MINUTE.map((offset) => minuteStart + offset);
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
  const params = resolveParams(process.env);
  const ttlSeconds = finiteOr(process.env.TICK_TTL_SECONDS, 24 * 60 * 60);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const slots = minuteSlotsForTime(nowSeconds);

  const items = slots.map((timestamp) => {
    const price = getPriceAtTime(timestamp, params);
    return {
      PutRequest: {
        Item: {
          symbol: { S: symbol },
          timestamp: { N: String(timestamp) },
          price: { N: String(price) },
          ttl: { N: String(timestamp + ttlSeconds) },
        },
      },
    };
  });

  const client = new DynamoDBClient({ region });
  const result = await client.send(
    new BatchWriteItemCommand({
      RequestItems: { [tableName]: items },
    }),
  );

  const unprocessed = result.UnprocessedItems?.[tableName]?.length ?? 0;
  const summary = {
    ok: true,
    symbol,
    table: tableName,
    minuteStart: slots[0],
    slots: slots.map((timestamp, index) => ({
      timestamp,
      price: Number(items[index].PutRequest.Item.price.N),
    })),
    unprocessed,
  };

  if (unprocessed > 0) {
    console.warn("ticks-generator: unprocessed items:", unprocessed);
  }
  console.log("ticks-generator:", JSON.stringify(summary));

  // API Gateway (payload format 2.0) requests get a real HTTP response.
  if (event?.requestContext?.http) {
    return apiResponse(200, summary);
  }
  return summary;
}
