import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBulkInsert,
  buildQueryInput,
  clampInt,
  parsePoints,
} from "../index.mjs";

test("clampInt clamps to the min/max range", () => {
  assert.equal(clampInt("0", 1, 960, 240), 1); // below min -> min
  assert.equal(clampInt("5000", 1, 960, 240), 960); // above max -> max
  assert.equal(clampInt("123.9", 1, 960, 240), 123); // floors fractional
  assert.equal(clampInt("240", 1, 960, 240), 240); // in range passthrough
});

test("clampInt falls back when value is not finite", () => {
  // Number(null) === 0 which is finite, so it clamps low; only non-finite
  // values (undefined, NaN, non-numeric strings) should hit the fallback.
  assert.equal(clampInt(undefined, 1, 960, 240), 240);
  assert.equal(clampInt("abc", 1, 960, 240), 240);
  assert.equal(clampInt(Number.NaN, 1, 960, 240), 240);
});

test("buildQueryInput aliases the reserved `timestamp` keyword", () => {
  const input = buildQueryInput({
    tableName: "market_price_history",
    symbol: "FAKE",
    nowSeconds: 1_752_000_000,
    pointCount: 240,
  });

  assert.equal(input.TableName, "market_price_history");
  // The 400 ValidationException root cause: `timestamp` used bare. The key
  // condition MUST reference the column through the #ts alias instead.
  assert.equal(
    input.KeyConditionExpression,
    "symbol = :symbol AND #ts <= :now",
  );
  assert.equal(input.ExpressionAttributeNames["#ts"], "timestamp");
  assert.equal(
    input.KeyConditionExpression.includes("timestamp"),
    false,
    "key condition must not contain the bare reserved keyword",
  );
  assert.deepEqual(input.ExpressionAttributeValues[":symbol"], { S: "FAKE" });
  assert.deepEqual(input.ExpressionAttributeValues[":now"], {
    N: String(1_752_000_000),
  });
  assert.equal(input.ScanIndexForward, false); // newest-first read
  assert.equal(input.Limit, 240);
});

test("parsePoints drops malformed items and returns oldest-first", () => {
  // DynamoDB returned these newest-first (ScanIndexForward: false).
  const items = [
    { timestamp: { N: "300" }, price: { N: "103" } }, // newest
    { timestamp: { N: "285" }, price: { N: "102" } },
    { timestamp: { N: "270" }, price: { N: "101" } }, // oldest
    // malformed rows must be filtered out
    { timestamp: { N: "255" }, price: { N: "not-a-number" } },
    { price: { N: "99" } }, // missing timestamp
    {},
  ];

  const points = parsePoints(items);
  assert.deepEqual(points, [
    { timestamp: 270, price: 101 },
    { timestamp: 285, price: 102 },
    { timestamp: 300, price: 103 },
  ]);
  assert.deepEqual(parsePoints(null), []);
});

test("buildBulkInsert emits one VALUES group per point with ordinal params", () => {
  const points = [
    { timestamp: 270, price: 101.5 },
    { timestamp: 285, price: 102.25 },
    { timestamp: 300, price: 103 },
  ];
  const { text, values } = buildBulkInsert({ symbol: "FAKE", points });

  assert.ok(text.startsWith("INSERT INTO price_history (symbol, ts, price)"));
  assert.ok(text.includes("($1, $2, $3), ($4, $5, $6), ($7, $8, $9)"));
  assert.ok(text.includes("ON CONFLICT (symbol, ts) DO NOTHING"));

  // symbol is repeated per row as a bind param; three bind params per point.
  assert.deepEqual(values, [
    "FAKE", 270, 101.5,
    "FAKE", 285, 102.25,
    "FAKE", 300, 103,
  ]);
});

test("buildBulkInsert yields a parseable statement for a single point", () => {
  const { text, values } = buildBulkInsert({
    symbol: "FAKE",
    points: [{ timestamp: 270, price: 101.5 }],
  });
  assert.ok(text.includes("($1, $2, $3)"));
  assert.deepEqual(values, ["FAKE", 270, 101.5]);
});
