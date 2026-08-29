/**
 * Direct Lambda client for trading-api and ticks-fetcher.
 *
 * The chat assistant Lambda (infra/lambdas/assistant) runs inside the same AWS
 * account as the rest of the stack, so instead of bouncing account reads and
 * mutations back out through CloudFront / API Gateway it invokes the owning
 * Lambdas directly with @aws-sdk/client-lambda. This module mirrors the
 * `cloudClient.js` interface exactly, so `createAccountService({ client })`
 * works unchanged with either transport.
 *
 * Every call builds an HTTP API (payload format 2.0) style event and sends a
 * synchronous `RequestResponse` InvokeCommand. The invoked Lambda answers with
 * `{ statusCode, headers, body }`; this client unwraps that envelope and
 * returns the parsed body (or throws TradingApiError for non-2xx responses).
 *
 * Route ownership:
 *   trading-api      portfolio / trades / transfers / orders — event.routeKey
 *   ticks-fetcher    ticks/4h + ticks/latest — event.rawPath drives its window
 *
 * Mutations carry a fresh UUID `idempotencyKey` in the body so an ambiguous
 * timeout can be retried safely — trading-api replays the stored result for a
 * duplicate key instead of double-executing.
 */

import { randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { TradingApiError } from "./cloudClient.js";

export const DEFAULT_REGION = "us-east-1";

export function createLambdaTradingClient({
  tradingApiFunctionName,
  ticksFetcherFunctionName,
  region = process.env.AWS_REGION ?? DEFAULT_REGION,
  lambdaClient = new LambdaClient({ region }),
} = {}) {
  if (!tradingApiFunctionName) {
    throw new Error(
      "createLambdaTradingClient requires tradingApiFunctionName.",
    );
  }
  if (!ticksFetcherFunctionName) {
    throw new Error(
      "createLambdaTradingClient requires ticksFetcherFunctionName.",
    );
  }

  async function invoke(
    functionName,
    routeKey,
    {
      rawPath,
      queryStringParameters,
      pathParameters,
      body,
      idempotencyKey,
    } = {},
  ) {
    const event = { routeKey, isBase64Encoded: false };
    if (rawPath) event.rawPath = rawPath;
    if (queryStringParameters) {
      event.queryStringParameters = queryStringParameters;
    }
    if (pathParameters) event.pathParameters = pathParameters;
    if (body) {
      const payload = { ...body };
      if (idempotencyKey) payload.idempotencyKey = idempotencyKey;
      event.body = JSON.stringify(payload);
    }

    let result;
    try {
      result = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: "RequestResponse",
          Payload: JSON.stringify(event),
        }),
      );
    } catch (error) {
      throw new Error(
        `Trading API Lambda ${functionName} invocation failed for ${routeKey}: ${error?.message ?? String(error)}`,
        { cause: error },
      );
    }

    const raw = result.Payload
      ? Buffer.from(result.Payload).toString("utf8")
      : "";

    if (result.FunctionError) {
      let details;
      try {
        details = JSON.parse(raw);
      } catch {
        details = undefined;
      }
      throw new Error(
        `${functionName} invocation failed (${result.FunctionError}): ${details?.errorMessage ?? raw}`,
      );
    }

    let api;
    try {
      api = JSON.parse(raw);
    } catch {
      throw new Error(
        `${functionName} returned a non-JSON payload for ${routeKey}: ${raw || "(empty)"}`,
      );
    }

    if (!api || api.statusCode < 200 || api.statusCode >= 300) {
      let message;
      try {
        message = JSON.parse(api?.body ?? "{}")?.error;
      } catch {
        message = undefined;
      }
      throw new TradingApiError(
        api?.statusCode ?? 500,
        message ??
          `Trading API Lambda ${functionName} failed (HTTP ${api?.statusCode ?? "?"}): ${routeKey}`,
      );
    }

    try {
      return JSON.parse(api.body ?? "{}");
    } catch {
      return {};
    }
  }

  return {
    fetchPortfolio: () =>
      invoke(tradingApiFunctionName, "GET /api/v1/portfolio"),
    fetchTrades: (limit = 50) =>
      invoke(tradingApiFunctionName, "GET /api/v1/trades", {
        queryStringParameters: { limit: String(limit) },
      }),
    fetchLatestTick: () =>
      invoke(ticksFetcherFunctionName, "GET /api/v1/ticks/latest", {
        rawPath: "/api/v1/ticks/latest",
      }),
    fetchOrders: (status) =>
      invoke(tradingApiFunctionName, "GET /api/v1/orders", {
        ...(status ? { queryStringParameters: { status } } : {}),
      }),
    postTrade: ({ symbol, side, quantity }) =>
      invoke(tradingApiFunctionName, "POST /api/v1/trades", {
        body: { symbol, side, quantity },
        idempotencyKey: randomUUID(),
      }),
    postTransfer: ({ amount }) =>
      invoke(tradingApiFunctionName, "POST /api/v1/transfers", {
        body: { amount },
        idempotencyKey: randomUUID(),
      }),
    postOrder: ({ symbol, side, type, quantity, price }) =>
      invoke(tradingApiFunctionName, "POST /api/v1/orders", {
        body: { symbol, side, type, quantity, price },
        idempotencyKey: randomUUID(),
      }),
    cancelOrder: (orderId) =>
      invoke(tradingApiFunctionName, "POST /api/v1/orders/{orderId}/cancel", {
        pathParameters: { orderId: String(orderId) },
      }),
  };
}
