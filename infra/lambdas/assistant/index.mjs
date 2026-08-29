/**
 * assistant — the production chat assistant (POST /api/v1/assistant).
 *
 * A thin API Gateway adapter over the shared `chat-assistant` workspace
 * package, which also powers the local dev server's POST /api/assistant route.
 * Production uses the DynamoDB pending-confirmation store (TTL-expiring), an
 * OpenAI-compatible LLM endpoint (OpenRouter) configured via env, and invokes
 * the trading-api and ticks-fetcher Lambdas DIRECTLY with @aws-sdk/client-lambda
 * instead of routing back out through CloudFront / API Gateway.
 *
 * Vite bundles this adapter plus the shared package (and @aws-sdk) into a
 * single self-contained dist/index.mjs before Terraform zips it — see
 * vite.config.js and the `npm run build` script.
 *
 * `createHandler` lets tests inject a stub account and pending store; the
 * exported `handler` is the production instance built from environment. Account
 * resolution is deferred until first invocation so this module can be imported
 * (and the adapter tested) without the Lambda env vars set.
 *
 * Environment:
 *   TRADING_API_FUNCTION_NAME         trading-api Lambda to invoke directly (required)
 *   TICKS_FETCHER_FUNCTION_NAME       ticks-fetcher Lambda to invoke directly (required)
 *   PENDING_CONFIRMATIONS_TABLE       DynamoDB table name (required)
 *   PENDING_CONFIRMATIONS_TTL_SECONDS confirmation TTL, default 7200 (2h)
 *   LLM_BASE_URL                      OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1
 *   LLM_CHAT_PATH                     default /chat/completions
 *   LLM_API_KEY                       Bearer key for the LLM provider
 *   LLM_MODEL                         model id, default llama3.1:8b
 */

import {
  createAccountService,
  createAssistant,
  createDynamoPendingStore,
  createLambdaTradingClient,
} from "chat-assistant";

export function apiResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body),
  };
}

export function parsePayload(event = {}) {
  try {
    return JSON.parse(event?.body ?? "{}");
  } catch {
    return {};
  }
}

// The assistant Lambda never touches CloudFront: it builds its account service
// on a direct Lambda-invocation client. Both function names must be present in
// the Lambda environment (wired by Terraform).
export function getProductionAccount() {
  const tradingApiFunctionName = process.env.TRADING_API_FUNCTION_NAME;
  const ticksFetcherFunctionName = process.env.TICKS_FETCHER_FUNCTION_NAME;
  if (!tradingApiFunctionName || !ticksFetcherFunctionName) {
    throw new Error(
      "TRADING_API_FUNCTION_NAME and TICKS_FETCHER_FUNCTION_NAME must be set " +
        "so the assistant Lambda can invoke trading-api and ticks-fetcher directly.",
    );
  }
  return createAccountService({
    client: createLambdaTradingClient({
      tradingApiFunctionName,
      ticksFetcherFunctionName,
    }),
  });
}

export function createHandler({ account, pendingStore, llm = {} } = {}) {
  let assistant;

  // Resolve lazily so tests that inject a stub account never construct the
  // production (Lambda-invoking) account service.
  function getAssistant() {
    if (!assistant) {
      assistant = createAssistant({
        account: account ?? getProductionAccount(),
        pendingStore: pendingStore ?? createDynamoPendingStore(),
        llm: {
          baseUrl: process.env.LLM_BASE_URL,
          chatPath: process.env.LLM_CHAT_PATH || "/chat/completions",
          apiKey: process.env.LLM_API_KEY,
          model: process.env.LLM_MODEL,
          ...llm,
        },
      });
    }
    return assistant;
  }

  return async function handler(event = {}) {
    try {
      const { status, body } = await getAssistant().handleRequest(
        parsePayload(event),
      );
      return apiResponse(status, body);
    } catch (error) {
      console.error("assistant: fatal", error);
      return apiResponse(500, { ok: false, error: "Internal server error." });
    }
  };
}

export const handler = createHandler();


