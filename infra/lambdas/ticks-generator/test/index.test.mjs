import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_SECONDS,
  DEFAULT_PARAMS,
  TICK_SLOTS_PER_MINUTE,
  blockForTime,
  buildWriteItems,
  changeForBlock,
  getPriceAtTime,
  minuteSlotsForTime,
  resolveParams,
  seededRandom,
} from "../index.mjs";

// ---------------------------------------------------------------------------
// resolveParams — env coercion with finite fallbacks
// ---------------------------------------------------------------------------

test("resolveParams returns the documented defaults for an empty env", () => {
  assert.deepEqual(resolveParams({}), {
    basePrice: 100,
    volatility: 0.002,
    startEpoch: 1787529600,
    seed: 20260824,
  });
  // DEFAULT_PARAMS 1:1 mirrors those.
  assert.equal(DEFAULT_PARAMS.basePrice, 100);
  assert.equal(DEFAULT_PARAMS.volatility, 0.002);
  assert.equal(DEFAULT_PARAMS.seed, 20260824);
});

test("resolveParams applies numeric overrides", () => {
  assert.deepEqual(
    resolveParams({
      MARKET_BASE_PRICE: "250",
      MARKET_VOLATILITY: "0.5",
      MARKET_START_EPOCH: "1700000000",
      MARKET_SEED: "99",
    }),
    { basePrice: 250, volatility: 0.5, startEpoch: 1700000000, seed: 99 },
  );
});

test("resolveParams falls back for empty string and non-finite inputs", () => {
  const emptyEnv = resolveParams({
    MARKET_BASE_PRICE: "",
    MARKET_VOLATILITY: "",
    MARKET_START_EPOCH: "",
    MARKET_SEED: "",
  });
  assert.deepEqual(emptyEnv, {
    basePrice: 100,
    volatility: 0.002,
    startEpoch: 1787529600,
    seed: 20260824,
  });

  const badEnv = resolveParams({
    MARKET_BASE_PRICE: "abc",
    MARKET_VOLATILITY: "Infinity",
    MARKET_START_EPOCH: null,
    MARKET_SEED: "not-a-number",
  });
  assert.deepEqual(badEnv, {
    basePrice: 100,
    volatility: 0.002,
    startEpoch: 1787529600,
    seed: 20260824,
  });
});

// ---------------------------------------------------------------------------
// seededRandom / changeForBlock — determinism and bounds
// ---------------------------------------------------------------------------

test("seededRandom is deterministic for the same seed and reproduces it", () => {
  const a = seededRandom(20260824);
  const b = seededRandom(20260824);
  for (let i = 0; i < 1000; i += 1) {
    const va = a();
    const vb = b();
    assert.equal(va, vb);
    // Every draw is in [0, 1).
    assert.ok(va >= 0 && va < 1, `draw ${i} out of [0,1): ${va}`);
  }
});

test("differing seeds yield differing streams", () => {
  const a = seededRandom(20260824);
  const b = seededRandom(20260825);
  let differed = false;
  for (let i = 0; i < 100; i += 1) {
    if (a() !== b()) {
      differed = true;
      break;
    }
  }
  assert.equal(differed, true, "independent seeds should diverge");
});

test("changeForBlock stays within the ±volatility bounds", () => {
  const params = { seed: 20260824, volatility: 0.05 };
  for (let block = 0; block < 100_000; block += 1) {
    const change = changeForBlock(block, params);
    assert.ok(
      change >= -params.volatility && change <= params.volatility,
      `block ${block} change ${change} out of bound`,
    );
  }
  // Deterministic: identical block → identical change.
  assert.equal(changeForBlock(5000, params), changeForBlock(5000, params));
});

test("changeForBlock variance grows with volatility", () => {
  const low = Math.abs(changeForBlock(123, { seed: 5, volatility: 0.001 }));
  const high = Math.abs(changeForBlock(123, { seed: 5, volatility: 0.5 }));
  assert.ok(high >= low);
});


// ---------------------------------------------------------------------------
// blockForTime — 15-second rounding boundaries
// ---------------------------------------------------------------------------

test("blockForTime buckets whole seconds into adjacent 15s blocks", () => {
  // blockForTime is round(seconds / BLOCK_SECONDS), so each multiple of 15
  // (and whole seconds around the 7.5s/22.5s mid-block boundaries) steps to
  // one distinct integer block.
  assert.equal(blockForTime(0), 0);
  assert.equal(blockForTime(15), 1);
  assert.equal(blockForTime(30), 2);
  assert.equal(blockForTime(45), 3);

  assert.equal(blockForTime(7), 0); // round(7/15) = 0
  assert.equal(blockForTime(8), 1); // round(8/15) = 1
  assert.equal(blockForTime(22), 1); // round(22/15) = 1
  assert.equal(blockForTime(23), 2); // round(23/15) = 2
  assert.equal(blockForTime(37), 2);
  assert.equal(blockForTime(38), 3);
  assert.equal(blockForTime(52), 3);
  assert.equal(blockForTime(53), 4);
});

test("blockForTime is a monotonic index over seconds", () => {
  let prev = blockForTime(0);
  for (let t = 1; t <= 10_000; t += 1) {
    const cur = blockForTime(t);
    assert.ok(
      cur >= prev && Math.abs(cur - prev) <= 1,
      `block jumped non-adjacently at t=${t}`,
    );
    prev = cur;
  }
});

// ---------------------------------------------------------------------------
// getPriceAtTime — deterministic repeatable walk
// ---------------------------------------------------------------------------

test("getPriceAtTime returns basePrice at or before the start block", () => {
  const params = resolveParams({});
  const start = params.startEpoch;
  // startEpoch is divisible by 15, so it falls exactly on the start block and
  // the first ~half of that block (rounding still lands on the start block)
  // has zero elapsed walk-steps → price is basePrice. (+8s rounds up to the
  // next block, which walks one volatility step.)
  assert.equal(getPriceAtTime(start, params), params.basePrice);
  for (let off = 1; off <= 7; off += 1) {
    assert.equal(getPriceAtTime(start - off, params), params.basePrice);
    assert.equal(getPriceAtTime(start + off, params), params.basePrice);
  }
});

test("getPriceAtTime is repeatable and finite deep in the walk", () => {
  const params = resolveParams({});
  const t = params.startEpoch + 60 * 60 * 24 * 90; // ~90 days after start
  const price = getPriceAtTime(t, params);
  assert.ok(Number.isFinite(price));
  assert.equal(price, getPriceAtTime(t, params));
  assert.ok(price > 0, `price not positive: ${price}`);
});

test("getPriceAtTime is identical under repeated identical params", () => {
  const p1 = resolveParams({ MARKET_SEED: "7" });
  const p2 = resolveParams({ MARKET_SEED: "7" });
  assert.equal(
    getPriceAtTime(1_800_000_000, p1),
    getPriceAtTime(1_800_000_000, p2),
  );
});

// ---------------------------------------------------------------------------
// minuteSlotsForTime — 4 ticks aligned to the containing UTC minute
// ---------------------------------------------------------------------------

test("TICK_SLOTS_PER_MINUTE advances by BLOCK_SECONDS within a minute", () => {
  assert.deepEqual(TICK_SLOTS_PER_MINUTE, [0, 15, 30, 45]);
  for (let i = 1; i < TICK_SLOTS_PER_MINUTE.length; i += 1) {
    assert.equal(
      TICK_SLOTS_PER_MINUTE[i] - TICK_SLOTS_PER_MINUTE[i - 1],
      BLOCK_SECONDS,
    );
  }
});

test("minuteSlotsForTime aligns any instant to its containing minute", () => {
  const minuteStart = 1_787_529_600; // divisible by 60
  const midMinute = minuteStart + 30;
  const lastSecond = minuteStart + 59; // the :59s of that UTC minute
  for (const t of [minuteStart, midMinute, lastSecond]) {
    assert.deepEqual(minuteSlotsForTime(t), [
      minuteStart,
      minuteStart + 15,
      minuteStart + 30,
      minuteStart + 45,
    ]);
  }
});

test("minuteSlotsForTime crosses into the next minute at +60s", () => {
  const t = 1_787_529_660; // minuteStart + 60 → the next minute's :00
  assert.deepEqual(minuteSlotsForTime(t), [
    1_787_529_660,
    1_787_529_675,
    1_787_529_690,
    1_787_529_705,
  ]);
});

// ---------------------------------------------------------------------------
// buildWriteItems — exactly 4 PutRequests, TTL guarded
// ---------------------------------------------------------------------------

test("buildWriteItems writes four correctly typed PutRequests", () => {
  const params = resolveParams({});
  const symbol = "TEST";
  const ttlSeconds = 24 * 60 * 60; // 86400
  const slots = [100, 115, 130, 145]; // 4 distinct 15s slots

  const items = buildWriteItems({ slots, params, symbol, ttlSeconds });
  assert.equal(items.length, 4);

  items.forEach((entry, index) => {
    const timestamp = slots[index];
    const item = entry.PutRequest.Item;
    assert.deepEqual(item.symbol, { S: symbol });
    assert.deepEqual(item.timestamp, { N: String(timestamp) });
    assert.deepEqual(
      item.price,
      { N: String(getPriceAtTime(timestamp, params)) },
      `slot ${timestamp} price mismatch`,
    );
    assert.ok(Number.isFinite(Number(item.price.N)));

    // ---- TTL guard: expiry = timestamp + ttlSeconds, NOT the raw timestamp.
    assert.deepEqual(item.ttl, { N: String(timestamp + ttlSeconds) });
    assert.equal(Number(item.ttl.N), timestamp + ttlSeconds);
    assert.notEqual(
      Number(item.ttl.N),
      timestamp,
      "ttl must not equal the raw timestamp (instant-expiry bug)",
    );
  });

  // Distinct slots keep distinct timestamps, so ticks are never overwritten.
  const stamps = items.map((i) => i.PutRequest.Item.timestamp.N);
  assert.equal(new Set(stamps).size, 4);
});
