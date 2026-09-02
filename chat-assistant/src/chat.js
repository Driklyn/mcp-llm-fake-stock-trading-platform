/**
 * The chat assistant — host-agnostic request handler shared by the local dev
 * server (server/) and the production Lambda (infra/lambdas/assistant).
 *
 * createAssistant({ account, pendingStore, llm }) returns a `handleRequest`
 * that turns a chat payload into `{ status, body }`, so any HTTP host can wrap
 * it: Express in dev, API Gateway in production. Large trades ($1,000+) and
 * cash transfers ($500+) are gated behind a human confirmation stored in the
 * injected pendingStore.
 */

import { getAssistantResponse, normalizeTradeQuantity } from "./llm.js";
import { TOOL_NAMES, TOOLS } from "./tools.js";

export function requiresConfirmationForTradeValue(quantity, price) {
  const qty = Number(quantity);
  const tradeValue = Number(qty) * Number(price ?? 0);
  return (
    Number.isFinite(qty) &&
    qty > 0 &&
    (qty >= 10 || (Number.isFinite(tradeValue) && tradeValue >= 1000))
  );
}

export function createAssistant({ account, pendingStore, llm = {} } = {}) {
  if (!account) throw new Error("createAssistant requires an account service.");
  if (!pendingStore)
    throw new Error("createAssistant requires a pendingStore.");

  async function currentPrice() {
    const quote = await account.getQuote();
    return Number(quote?.price ?? 0);
  }

  async function buildChatResponse(plan, fallbackText = "") {
    const tool = plan?.tool;
    const pricePerShare = await currentPrice();

    if (!tool) {
      return {
        plan,
        payload: null,
        text:
          plan?.fallback ??
          fallbackText ??
          "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.",
      };
    }

    if (tool === TOOL_NAMES.getPortfolioSummary) {
      const summary = await account.getPortfolioSummary();
      return {
        plan,
        payload: { account: summary.account },
        text: `Portfolio summary: cash $${Number(summary.account.cashAvailable ?? 0).toFixed(2)}, invested $${Number(summary.account.costBasis ?? 0).toFixed(2)}, gains/losses $${Number(summary.account.totalGainsLosses ?? 0).toFixed(2)}, holdings ${summary.account.holdings}, total equity $${Number(summary.account.totalEquity ?? 0).toFixed(2)}.`,
      };
    }

    if (tool === TOOL_NAMES.getQuote) {
      const quote = await account.getQuote();
      return {
        plan,
        payload: {
          symbol: quote.symbol,
          price: quote.price,
          history: quote.history.slice(-30),
        },
        text: `Current FAKE price: $${Number(quote.price ?? 0).toFixed(2)}.`,
      };
    }

    if (tool === TOOL_NAMES.buyStock) {
      let quantity = normalizeTradeQuantity(plan.arguments?.quantity);
      const amount = Number(plan.arguments?.amount ?? 0);
      const confirmed = plan.arguments?.confirm === true;

      if (!quantity) {
        return {
          plan,
          payload: {
            error: "A quantity of at least 1 share is required to buy.",
          },
          text: "A quantity of at least 1 share is required to buy. For example, say 'buy 2 shares'.",
        };
      }

      // If the assistant supplied a dollar `amount`, compute whole-share quantity using the live price
      if (amount > 0) {
        const computed = Math.floor(amount / Number(pricePerShare ?? 0));
        if (computed <= 0) {
          return {
            plan,
            payload: {
              error: `At the current price of $${Number(pricePerShare ?? 0).toFixed(2)}, $${amount.toFixed(2)} would buy 0 whole shares. Increase the amount or say 'buy 1 share' to proceed.`,
            },
            text: `At the current price of $${Number(pricePerShare ?? 0).toFixed(2)}, $${amount.toFixed(2)} would buy 0 whole shares. Increase the amount or say 'buy 1 share' to proceed.`,
          };
        }
        quantity = computed;
      }

      const tradeValue = quantity * pricePerShare;

      if (!confirmed && tradeValue >= 1000) {
        const { confirmationId: id } = await pendingStore.put({
          tool,
          arguments: { ...(plan.arguments ?? {}) },
        });
        const requestedAmount = Number(plan.arguments?.amount ?? 0);
        let pendingMessage = `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`;
        if (requestedAmount > 0) {
          const executedAmount = quantity * pricePerShare;
          const remainder = requestedAmount - executedAmount;
          pendingMessage = `Requested $${requestedAmount.toFixed(2)}; at $${pricePerShare.toFixed(2)} per share you can buy ${quantity} shares for $${executedAmount.toFixed(2)}${remainder > 0 ? ` (remainder $${remainder.toFixed(2)} not spent)` : ""}. Please confirm before executing.`;
        }

        return {
          plan,
          payload: {
            requiresConfirmation: true,
            confirmationId: id,
            message: pendingMessage,
            quantity,
            value: tradeValue,
            pricePerShare,
          },
          text: pendingMessage,
        };
      }

      // confirmed or not requiring confirmation -> proceed
      try {
        const result = await account.buy(quantity);
        const executionPrice = Number(result?.price ?? pricePerShare ?? 0);
        const executedAmount = Number(result.quantity) * executionPrice;
        const requestedAmount = Number(plan.arguments?.amount ?? 0);
        const remainder =
          requestedAmount > 0
            ? Math.max(0, requestedAmount - executedAmount)
            : null;
        const execText =
          requestedAmount > 0
            ? `Bought ${result.quantity} shares at $${executionPrice.toFixed(2)} for $${executedAmount.toFixed(2)}${remainder > 0 ? `; $${remainder.toFixed(2)} could not buy another whole share and remains in cash.` : " (exact)."}`
            : `Buy order completed for ${result.quantity} shares at $${executionPrice.toFixed(2)}. Cash remaining: $${Number(result.cashAvailable ?? 0).toFixed(2)}.`;

        return {
          plan,
          payload: {
            ...result,
            executedAmount,
            pricePerShare: executionPrice,
            remainder,
          },
          text: execText,
        };
      } catch (error) {
        return {
          plan,
          payload: { error: error?.message ?? String(error) },
          text: error?.message ?? String(error),
        };
      }
    }

    if (tool === TOOL_NAMES.sellStock) {
      let quantity = normalizeTradeQuantity(plan.arguments?.quantity);
      const amount = Number(plan.arguments?.amount ?? 0);
      const confirmed = plan.arguments?.confirm === true;

      if (!quantity) {
        return {
          plan,
          payload: {
            error: "A quantity of at least 1 share is required to sell.",
          },
          text: "A quantity of at least 1 share is required to sell. For example, say 'sell 2 shares'.",
        };
      }

      if (amount > 0) {
        const computed = Math.floor(amount / Number(pricePerShare ?? 0));
        if (computed <= 0) {
          return {
            plan,
            payload: {
              error: `At the current price of $${Number(pricePerShare ?? 0).toFixed(2)}, $${amount.toFixed(2)} would sell 0 whole shares. Increase the amount or specify a quantity to proceed.`,
            },
            text: `At the current price of $${Number(pricePerShare ?? 0).toFixed(2)}, $${amount.toFixed(2)} would sell 0 whole shares. Increase the amount or specify a quantity to proceed.`,
          };
        }
        quantity = computed;
      }

      const tradeValue = quantity * pricePerShare;

      if (!confirmed && tradeValue >= 1000) {
        const { confirmationId: id } = await pendingStore.put({
          tool,
          arguments: { ...(plan.arguments ?? {}) },
        });
        const requestedAmount = Number(plan.arguments?.amount ?? 0);
        let pendingMessage = `This trade is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`;
        if (requestedAmount > 0) {
          const executedAmount = quantity * pricePerShare;
          const remainder = requestedAmount - executedAmount;
          pendingMessage = `Requested $${requestedAmount.toFixed(2)}; at $${pricePerShare.toFixed(2)} per share you can sell ${quantity} shares for $${executedAmount.toFixed(2)}${remainder > 0 ? ` (remainder $${remainder.toFixed(2)} not sold)` : ""}. Please confirm before executing.`;
        }

        return {
          plan,
          payload: {
            requiresConfirmation: true,
            confirmationId: id,
            message: pendingMessage,
            quantity,
            value: tradeValue,
            pricePerShare,
          },
          text: pendingMessage,
        };
      }

      // proceed
      try {
        const result = await account.sell(quantity);
        const executionPrice = Number(result?.price ?? pricePerShare ?? 0);
        const executedAmount = Number(result.quantity) * executionPrice;
        const requestedAmount = Number(plan.arguments?.amount ?? 0);
        const remainder =
          requestedAmount > 0
            ? Math.max(0, requestedAmount - executedAmount)
            : null;
        const execText =
          requestedAmount > 0
            ? `Sold ${result.quantity} shares at $${executionPrice.toFixed(2)} for $${executedAmount.toFixed(2)}${remainder > 0 ? `; $${remainder.toFixed(2)} could not be sold as whole shares.` : " (exact)."}`
            : `Sell order completed for ${result.quantity} shares at $${executionPrice.toFixed(2)}. Cash balance: $${Number(result.cashAvailable ?? 0).toFixed(2)}.`;

        return {
          plan,
          payload: {
            ...result,
            executedAmount,
            pricePerShare: executionPrice,
            remainder,
          },
          text: execText,
        };
      } catch (error) {
        return {
          plan,
          payload: { error: error?.message ?? String(error) },
          text: error?.message ?? String(error),
        };
      }
    }

    if (tool === TOOL_NAMES.transferCash) {
      const amount = Number(plan.arguments?.amount ?? 0);
      const confirmed = plan.arguments?.confirm === true;

      // Deposits/withdrawals of $500+ require a human confirmation before the
      // cash is moved (mirrors the large-trade gate above).
      if (!confirmed && Number.isFinite(amount) && Math.abs(amount) >= 500) {
        const { confirmationId: id } = await pendingStore.put({
          tool,
          arguments: { ...(plan.arguments ?? {}) },
        });
        const transferType = amount >= 0 ? "deposit" : "withdrawal";
        const absAmount = Math.abs(amount);
        const pendingMessage = `A cash ${transferType} of $${absAmount.toFixed(2)} requires confirmation. Please confirm before it is processed.`;
        return {
          plan,
          payload: {
            requiresConfirmation: true,
            confirmationId: id,
            message: pendingMessage,
            transferType,
            amount: absAmount,
            value: absAmount,
          },
          text: pendingMessage,
        };
      }

      try {
        const result = await account.transfer(amount);
        return {
          plan,
          payload: result,
          text: `Cash transfer processed. Available cash is now $${Number(result.cashAvailable ?? 0).toFixed(2)}.`,
        };
      } catch (error) {
        return {
          plan,
          payload: { error: error?.message ?? String(error) },
          text: error?.message ?? String(error),
        };
      }
    }

    if (tool === TOOL_NAMES.placeOrder) {
      let orderType = String(plan.arguments?.type ?? "limit").toLowerCase();
      const orderSide = String(plan.arguments?.side ?? "buy").toLowerCase();
      const quantity = normalizeTradeQuantity(plan.arguments?.quantity);
      const triggerPrice = Number(plan.arguments?.price ?? 0);
      const confirmed = plan.arguments?.confirm === true;

      // Normalize type based on semantics: a buy trigger below current price
      // is a limit order (buy when price <= trigger). A buy trigger above
      // current price is a stop (buy when price >= trigger). Mirror logic
      // for sells. This corrects LLM plans that accidentally choose the
      // opposite type.
      if (Number.isFinite(triggerPrice) && triggerPrice > 0) {
        const current = Number(pricePerShare ?? 0);
        let inferred = orderType; // default to provided
        if (orderSide === "buy") {
          // If trigger is less than or equal to current, force Limit to avoid instant market execution
          inferred = triggerPrice <= current ? "limit" : "stop";
        } else if (orderSide === "sell") {
          // If trigger is greater than or equal to current, force Limit to lock in that exact price or better
          inferred = triggerPrice >= current ? "limit" : "stop";
        }
        if (inferred !== orderType) {
          orderType = inferred;
        }
      }

      if (!quantity) {
        return {
          plan,
          payload: { error: "A quantity of at least 1 share is required." },
          text: "A quantity of at least 1 share is required for this order. For example, say 'limit buy 2 shares at $95'.",
        };
      }

      if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
        return {
          plan,
          payload: { error: "A trigger price greater than $0 is required." },
          text: "A trigger price greater than $0 is required.",
        };
      }

      const tradeValue = quantity * Number(pricePerShare ?? 0);

      if (!confirmed && tradeValue >= 1000) {
        const { confirmationId: id } = await pendingStore.put({
          tool,
          arguments: { ...(plan.arguments ?? {}) },
        });
        return {
          plan,
          payload: {
            requiresConfirmation: true,
            confirmationId: id,
            message: `This ${orderType} ${orderSide} order is worth $${tradeValue.toFixed(2)} at the current price. Please confirm before placing it.`,
            quantity,
            value: tradeValue,
            pricePerShare: Number(pricePerShare ?? 0),
          },
          text: `This ${orderType} ${orderSide} order is worth $${tradeValue.toFixed(2)} at the current price. Please confirm before placing it.`,
        };
      }

      try {
        const result = await account.placeOrder({
          type: orderType,
          side: orderSide,
          quantity,
          price: triggerPrice,
        });
        return {
          plan,
          payload: result,
          text: `${orderType} ${orderSide} order placed for ${result.quantity} shares at $${Number(result.price ?? 0).toFixed(2)}.`,
        };
      } catch (error) {
        return {
          plan,
          payload: { error: error?.message ?? String(error) },
          text: error?.message ?? String(error),
        };
      }
    }

    if (tool === TOOL_NAMES.listOrders) {
      const filterType = String(plan.arguments?.type ?? "").toLowerCase();
      const filterSide = String(plan.arguments?.side ?? "").toLowerCase();
      const orders = (await account.listOrders()).orders.filter(
        (order) =>
          order.status === "open" &&
          (!filterType || order.type === filterType) &&
          (!filterSide || order.kind === filterSide),
      );
      return {
        plan,
        payload: { orders },
        text: orders.length
          ? `Open orders: ${orders.map((order) => `${order.type} ${order.kind} ${order.quantity} @ $${Number(order.price ?? 0).toFixed(2)} (${order.status})`).join(", ")}.`
          : "There are no current open orders.",
      };
    }

    if (tool === TOOL_NAMES.cancelOrder) {
      try {
        const result = await account.cancelOrder(
          plan.arguments?.orderId ?? "pending",
        );
        return {
          plan,
          payload: result,
          text:
            result?.status === "cancelled"
              ? `Canceled order ${plan.arguments?.orderId ?? "the selected order"}.`
              : "I could not cancel that order.",
        };
      } catch (error) {
        return {
          plan,
          payload: { error: error?.message ?? String(error) },
          text: error?.message ?? String(error),
        };
      }
    }

    return {
      plan,
      payload: null,
      text:
        fallbackText ??
        "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.",
    };
  }

  async function handleRequest(body = {}) {
    try {
      const message = String(body?.message ?? "").trim();

      // Allow requests that perform an action (confirm/cancel) without a textual `message`.
      if (!message && !body?.action) {
        return { status: 400, body: { error: "A message is required." } };
      }

      // Special client message to cancel or confirm a pending human confirmation
      // Expect JSON actions: { action: 'cancel', confirmationId } or { action: 'confirm', confirmationId }
      if (body?.action === "cancel" || body?.action === "confirm") {
        const action = body.action;
        const confirmationId = body.confirmationId;
        const pending = confirmationId
          ? await pendingStore.get(confirmationId)
          : null;

        if (!pending) {
          return {
            status: 200,
            body: {
              plan: { tool: null, arguments: {} },
              text: "There is no pending trade with that confirmationId.",
            },
          };
        }

        if (action === "cancel") {
          await pendingStore.remove(confirmationId);
          return {
            status: 200,
            body: {
              plan: { tool: null, arguments: {} },
              text: "Cancelled pending trade.",
            },
          };
        }

        // action === 'confirm'
        await pendingStore.remove(confirmationId);
        const confirmationPlan = {
          tool: pending.tool,
          arguments: {
            ...(pending.arguments ?? {}),
            confirm: true,
          },
        };

        const executed = await buildChatResponse(confirmationPlan);
        return { status: 200, body: { ...executed, text: executed.text } };
      }

      const response = await getAssistantResponse(message, {
        baseUrl: llm.baseUrl,
        chatPath: llm.chatPath,
        apiKey: llm.apiKey,
        model: llm.model,
        fetchFn: llm.fetchFn,
        pricePerShare: await currentPrice(),
      });

      const plan = response?.plan ?? {
        tool: TOOL_NAMES.getPortfolioSummary,
        arguments: {},
      };
      const fallbackText =
        response?.text ??
        "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.";

      const executed = await buildChatResponse(plan, fallbackText);
      return {
        status: 200,
        body: {
          ...response,
          ...executed,
          text: executed.text,
        },
      };
    } catch (error) {
      console.error("Assistant route error:", error);
      return {
        status: 500,
        body: {
          plan: { tool: TOOL_NAMES.getPortfolioSummary, arguments: {} },
          text: "I can help with portfolio checks, price quotes, buys, sells, limit and stop orders, deposits, withdrawals, and order cancellations.",
        },
      };
    }
  }

  return { handleRequest, buildChatResponse, currentPrice };
}

// Re-export the tool registry so package consumers (and src/index.js) can
// access the definitions without importing tools.js directly.
export { TOOLS, TOOL_NAMES };
