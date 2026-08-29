/**
 * chat-assistant — the shared chat assistant package.
 *
 * Used by the local dev server (server/) for the in-process POST /api/assistant
 * route and by the production Lambda (infra/lambdas/assistant) for
 * POST /api/v1/assistant. The account/cloud client live here too so the trading
 * proxy is never duplicated between hosts.
 */

export { createAssistant, requiresConfirmationForTradeValue } from "./chat.js";
export {
  buildTradePlan,
  getAssistantResponse,
  normalizeTradeQuantity,
  parseToolPlan,
  requiresConfirmationForTrade,
} from "./llm.js";
export {
  account,
  createAccountService,
  DEFAULT_SYMBOL,
  DEFAULT_PRICE,
  MARKET_PARAMS,
} from "./trading/account.js";
export * from "./trading/cloudClient.js";
export { createLambdaTradingClient } from "./trading/lambdaClient.js";
export { createMemoryPendingStore } from "./pending/memory.js";
export { createDynamoPendingStore } from "./pending/dynamodb.js";
