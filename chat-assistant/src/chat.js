/**
 * The chat assistant — host-agnostic request handler shared by the local dev
 * server (server/) and the production Lambda (infra/lambdas/assistant).
 *
 * createAssistant({ account, pendingStore, llm }) returns a `handleRequest`
 * that turns a chat payload into `{ status, body }`, so any HTTP host can wrap
 * it: Express in dev, API Gateway in production. Large trades ($1,000+) are
 * gated behind a human confirmation stored in the injected pendingStore.
 */

import { getAssistantResponse, normalizeTradeQuantity } from "./llm.js";

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
  if (!pendingStore) throw new Error("createAssistant requires a pendingStore.");

  async function currentPrice() {
    const quote = await account.getQuote();
    return Number(quote?.price ?? 0);
  }

  async function buildChatResponse(plan, payload, fallbackText) {
    const tool = plan?.tool;
    const pricePerShare = await currentPrice();

    if (tool === null) {
      return {
        plan,
        payload: null,
        text:
          plan?.fallback ??
          fallbackText ??
          "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.",
      };
    }

    if (!tool) {
      return {
        plan: { tool: "get_account_snapshot", arguments: {} },
        payload: await account.getPortfolioSummary(),
        text:
          fallbackText ??
          "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.",
      };
    }

    if (tool === "get_account_snapshot") {
      const summary = await account.getPortfolioSummary();
      return {
        plan,
        payload: summary,
        text: `Portfolio snapshot: cash $${Number(summary.account.cashAvailable ?? 0).toFixed(2)}, holdings ${summary.account.holdings}, invested $${Number(summary.account.costBasis ?? 0).toFixed(2)}, total equity $${Number(summary.account.totalEquity ?? 0).toFixed(2)}, gains/losses $${Number(summary.totalGainsLosses ?? 0).toFixed(2)}.`,
      };
    }

    if (tool === "get_quote") {
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

    if (tool === "buy_stock") {
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
        const executedAmount = Number(result.quantity) * pricePerShare;
        const requestedAmount = Number(plan.arguments?.amount ?? 0);
        const remainder =
          requestedAmount > 0
            ? Math.max(0, requestedAmount - executedAmount)
            : null;
        const execText =
          requestedAmount > 0
            ? `Bought ${result.quantity} shares at $${pricePerShare.toFixed(2)} for $${executedAmount.toFixed(2)}${remainder > 0 ? `; $${remainder.toFixed(2)} could not buy another whole share and remains in cash.` : " (exact)."}`
            : `Buy order completed for ${result.quantity} shares. Cash remaining: $${Number(result.cashAvailable ?? 0).toFixed(2)}.`;

        return {
          plan,
          payload: { ...result, executedAmount, pricePerShare, remainder },
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

    if (tool === "sell_stock") {
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
        const executedAmount = Number(result.quantity) * pricePerShare;
        const requestedAmount = Number(plan.arguments?.amount ?? 0);
        const remainder =
          requestedAmount > 0
            ? Math.max(0, requestedAmount - executedAmount)
            : null;
        const execText =
          requestedAmount > 0
            ? `Sold ${result.quantity} shares at $${pricePerShare.toFixed(2)} for $${executedAmount.toFixed(2)}${remainder > 0 ? `; $${remainder.toFixed(2)} could not be sold as whole shares.` : " (exact)."}`
            : `Sell order completed for ${result.quantity} shares. Cash balance: $${Number(result.cashAvailable ?? 0).toFixed(2)}.`;

        return {
          plan,
          payload: { ...result, executedAmount, pricePerShare, remainder },
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

    if (tool === "transfer_cash") {
      const amount = Number(plan.arguments?.amount ?? 0);
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

    if (tool === "place_order") {
      const orderType = String(plan.arguments?.type ?? "limit").toLowerCase();
      const orderSide = String(plan.arguments?.side ?? "buy").toLowerCase();
      const quantity = normalizeTradeQuantity(plan.arguments?.quantity);
      const triggerPrice = Number(plan.arguments?.price ?? 0);
      const confirmed = plan.arguments?.confirm === true;

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

    if (tool === "list_orders") {
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

    if (tool === "cancel_order") {
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
      payload: await account.getPortfolioSummary(),
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

        const executed = await buildChatResponse(confirmationPlan, null, "");
        return { status: 200, body: { ...executed, text: executed.text } };
      }

      const hasPending = (await pendingStore.size()) > 0;
      const confirmationPrompt =
        hasPending &&
        /(^|\s)(confirm|confirmed|accepted|accept|yes|proceed|go ahead|approve|approved|execute)(\s|$)/.test(
          message.toLowerCase(),
        );

      const response = await getAssistantResponse(message, {
        baseUrl: llm.baseUrl,
        chatPath: llm.chatPath,
        apiKey: llm.apiKey,
        model: llm.model,
        fetchFn: llm.fetchFn,
        pricePerShare: await currentPrice(),
        // If the user replied with a confirmation-like phrase, pass the most
        // recent pending confirmation so the deterministic planner attaches it.
        pendingTool: confirmationPrompt
          ? await pendingStore.mostRecent()
          : undefined,
      });

      const plan = response?.plan ?? {
        tool: "get_account_snapshot",
        arguments: {},
      };
      // If this was a natural-language confirmation and the assistant produced
      // a plan that includes `confirm: true`, clear the most-recent pending
      // confirmation entry.
      if (
        confirmationPrompt &&
        plan?.arguments?.confirm === true &&
        hasPending
      ) {
        const last = await pendingStore.mostRecent();
        if (last?.confirmationId) await pendingStore.remove(last.confirmationId);
      }
      const fallbackText =
        response?.text ??
        "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, depositing or withdrawing cash, and listing or canceling orders.";

      const executed = await buildChatResponse(plan, null, fallbackText);
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
          plan: { tool: "get_account_snapshot", arguments: {} },
          text: "I can help with portfolio checks, price quotes, buys, sells, limit and stop orders, deposits, withdrawals, and order cancellations.",
        },
      };
    }
  }

  return { handleRequest, buildChatResponse, currentPrice };
}





