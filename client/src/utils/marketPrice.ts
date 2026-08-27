/**
 * Deterministic market math engine (client mirror).
 *
 * Bit-for-bit parity contract with `server/src/trading/market.js`:
 * - Mulberry32 PRNG built on Math.imul + 32-bit masking, so results are
 *   identical on V8 (Node/Chrome) and JavaScriptCore (Safari).
 * - Timestamps snap to 15-second block boundaries; every block's price change
 *   is seeded by `(seed + blockIndex)`, so any block can be recomputed
 *   deterministically from `startEpoch` without shared mutable state.
 * - The series is multiplicative/associative:
 *     price_i = startPrice * product(1 + change_k), k = 1..i
 *   so bulk windows are built with a single O(n) forward walk.
 */

export const BLOCK_SECONDS = 15;

export type MarketParams = {
  basePrice?: number;
  volatility?: number;
  startEpoch?: number;
  seed?: number;
};

export type ResolvedMarketParams = Required<MarketParams>;

export type MarketPoint = {
  block: number;
  timestamp: number;
  price: number;
};

export const DEFAULT_PARAMS: Readonly<ResolvedMarketParams> = Object.freeze({
  basePrice: 100,
  volatility: 0.002, // max ±0.2% swing per step
  startEpoch: 1787529600, // August 24, 2026 00:00 UTC
  seed: 20260824,
});

function finiteOr(value: number | undefined, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function resolveParams(
  params: MarketParams = {},
): ResolvedMarketParams {
  const input: MarketParams = params ?? {};
  return {
    basePrice: finiteOr(input.basePrice, DEFAULT_PARAMS.basePrice),
    volatility: finiteOr(input.volatility, DEFAULT_PARAMS.volatility),
    startEpoch: finiteOr(input.startEpoch, DEFAULT_PARAMS.startEpoch),
    seed: finiteOr(input.seed, DEFAULT_PARAMS.seed),
  };
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function random(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function snapToBlock(timeSeconds: number): number {
  const time = Number(timeSeconds);
  if (!Number.isFinite(time)) {
    throw new TypeError("snapToBlock expects a finite timestamp in seconds.");
  }
  return Math.round(time / BLOCK_SECONDS) * BLOCK_SECONDS;
}

export function blockForTime(timeSeconds: number): number {
  return Math.round(Number(timeSeconds) / BLOCK_SECONDS);
}

export function changeForBlock(
  blockIndex: number,
  params: ResolvedMarketParams,
): number {
  const random = seededRandom((params.seed >>> 0) + (blockIndex >>> 0));
  return (random() - 0.5) * 2 * params.volatility;
}

export function getPriceAtTime(
  targetTimeSeconds: number,
  params: MarketParams = {},
): number {
  const time = Number(targetTimeSeconds);
  if (!Number.isFinite(time)) {
    throw new TypeError("getPriceAtTime expects a finite timestamp in seconds.");
  }
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

export function walkMarketSeries(
  startBlock: number,
  endBlock: number,
  params: MarketParams = {},
  startPrice?: number,
): MarketPoint[] {
  const resolved = resolveParams(params);
  const from = Math.round(Number(startBlock));
  const to = Math.round(Number(endBlock));
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new TypeError("walkMarketSeries expects finite block numbers.");
  }
  if (to < from) return [];

  const initial = Number.isFinite(Number(startPrice))
    ? Number(startPrice)
    : resolved.basePrice;

  const points: MarketPoint[] = [];
  let price = initial;
  for (let block = from; block <= to; block += 1) {
    if (block > from) {
      price *= 1 + changeForBlock(block, resolved);
    }
    points.push({
      block,
      timestamp: block * BLOCK_SECONDS,
      price,
    });
  }
  return points;
}

export type PriceSeriesPoint = {
  price: number;
  timestamp: number; // epoch ms, snapped to a block boundary
};

/**
 * Build a block-aligned historical price series for charting. The window is
 * clamped to the deterministic series start, and the leading block price is
 * seeded with getPriceAtTime so the walk is bit-identical to any other query
 * of the same series.
 */
export function buildPriceSeries(
  startTimeSeconds: number,
  endTimeSeconds: number,
  params: MarketParams = {},
): PriceSeriesPoint[] {
  const resolved = resolveParams(params);
  const startBlock = blockForTime(resolved.startEpoch);
  const toBlock = blockForTime(endTimeSeconds);
  const fromBlock = Math.max(blockForTime(startTimeSeconds), startBlock);
  if (toBlock < fromBlock) return [];

  const startPrice = getPriceAtTime(fromBlock * BLOCK_SECONDS, resolved);
  return walkMarketSeries(fromBlock, toBlock, resolved, startPrice).map(
    (point) => ({
      price: point.price,
      timestamp: point.timestamp * 1000,
    }),
  );
}

export type RealizedTick = {
  timestamp: number; // epoch seconds, snapped down to the current 15s block
  price: number;
};

/**
 * The last _realized_ tick at or before `nowSeconds`: the current 15-second
 * block timestamp snapped DOWN (floor), priced deterministically — matching the
 * ticks-fetcher's `timestamp <= now` gate exactly, so a locally-generated tick
 * is bit-for-bit identical to what `GET /api/v1/ticks/latest` returns.
 */
export function latestRealizedTick(
  nowSeconds: number,
  params: MarketParams = {},
): RealizedTick {
  const now = Number(nowSeconds);
  if (!Number.isFinite(now)) {
    throw new TypeError(
      "latestRealizedTick expects a finite timestamp in seconds.",
    );
  }
  const timestamp = Math.floor(now / BLOCK_SECONDS) * BLOCK_SECONDS;
  return { timestamp, price: getPriceAtTime(timestamp, params) };
}
