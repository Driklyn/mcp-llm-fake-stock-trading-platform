import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_HISTORY_WINDOW_SECONDS,
  buildQueryInput,
  parsePoints,
  resolveWindow,
} from "../index.mjs";

test("resolveWindow returns a 1-point recent window for /latest", () => {
  const win = resolveWindow({ rawPath: "/api/v1/ticks/latest" }, 1_752_000_000);
  assert.deepEqual(win, {
    limit: 1,
    from: 1_752_000_000 - DEFAULT_HISTORY_WINDOW_SECONDS,
  });
});

test("resolveWindow returns the full 4h window for /4h", () => {
  const win = resolveWindow({ rawPath: "/api/v1/ticks/4h" }, 1_752_000_000);
  assert.deepEqual(win, {
    limit: DEFAULT_HISTORY_LIMIT,
    from: 1_752_000_000 - DEFAULT_HISTORY_WINDOW_SECONDS,
  });
});

test("resolveWindow treats the bare /ticks route and empty path as /4h", () => {
  const now = 1_752_000_000;
  const expected = {
    limit: DEFAULT_HISTORY_LIMIT,
    from: now - DEFAULT_HISTORY_WINDOW_SECONDS,
  };
  assert.deepEqual(resolveWindow({ rawPath: "/api/v1/ticks" }, now), expected);
  assert.deepEqual(resolveWindow({ rawPath: "" }, now), expected);
  assert.deepEqual(resolveWindow({}, now), expected);
  assert.deepEqual(resolveWindow(undefined, now), expected);
});

test("resolveWindow ignores user query params", () => {
  // User-supplied limit/from query strings are deliberately ignored.
  assert.deepEqual(
    resolveWindow(
      { rawPath: "/api/v1/ticks/latest", queryStringParameters: { limit: "5" } },
      1_752_000_000,
    ),
    { limit: 1, from: 1_752_000_000 - DEFAULT_HISTORY_WINDOW_SECONDS },
  );
});

test("resolveWindow returns null for unknown routes", () => {
  assert.equal(resolveWindow({ rawPath: "/api/v1/ticks/1d" }, 0), null);
  assert.equal(resolveWindow({ rawPath: "/elsewhere" }, 0), null);
});

test("history constants default to 960 points over 14400 seconds", () => {
  assert.equal(DEFAULT_HISTORY_LIMIT, 960);
  assert.equal(DEFAULT_HISTORY_WINDOW_SECONDS, 14400);
  assert.equal(
    DEFAULT_HISTORY_WINDOW_SECONDS,
    DEFAULT_HISTORY_LIMIT * 15, // BLOCK_SECONDS
  );
});

test("buildQueryInput builds a newest-first BETWEEN query within [from, now]", () => {
  const input = buildQueryInput({
    tableName: "market_price_history",
    symbol: "FAKE",
    from: 1_751_985_600,
    to: 1_752_000_000,
    limit: 960,
  });

  assert.equal(input.TableName, "market_price_history");
  // `to` is the "now" gate: every returned point satisfies timestamp <= now,
  // hiding ticks the generator pre-populated for the future.
  assert.equal(
    input.KeyConditionExpression,
    "symbol = :symbol AND #ts BETWEEN :from AND :now",
  );
  assert.deepEqual(input.ExpressionAttributeNames, { "#ts": "timestamp" });
  assert.deepEqual(input.ExpressionAttributeValues[":symbol"], { S: "FAKE" });
  assert.deepEqual(input.ExpressionAttributeValues[":from"], {
    N: String(1_751_985_600),
  });
  assert.deepEqual(input.ExpressionAttributeValues[":now"], {
    N: String(1_752_000_000),
  });
  assert.equal(input.ScanIndexForward, false); // newest-first read
  assert.equal(input.Limit, 960);
});

test("buildQueryInput never uses the bare reserved keyword `timestamp`", () => {
  const input = buildQueryInput({
    tableName: "t",
    symbol: "S",
    from: 1,
    to: 2,
    limit: 10,
  });
  // Using `timestamp` bare is a DynamoDB reserved-keyword bug; it MUST go through
  // the #ts alias.
  assert.equal(
    input.KeyConditionExpression.includes("timestamp"),
    false,
    "key condition must not contain the bare reserved keyword",
  );
  assert.equal(input.ExpressionAttributeNames["#ts"], "timestamp");
});

test("parsePoints drops malformed items and returns oldest-first", () => {
  // DynamoDB returned these newest-first (ScanIndexForward: false).
  const items = [
    { timestamp: { N: "300" }, price: { N: "103" } }, // newest
    { timestamp: { N: "285" }, price: { N: "102" } },
    { timestamp: { N: "270" }, price: { N: "101" } }, // oldest
    // malformed rows must be filtered out
    { timestamp: { N: "255" }, price: { N: "not-a-number" } },
    { timestamp: { N: "Infinity" }, price: { N: "99" } },
    { timestamp: { N: "240" }, price: { N: "Infinity" } },
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
  assert.deepEqual(parsePoints(undefined), []);
});
