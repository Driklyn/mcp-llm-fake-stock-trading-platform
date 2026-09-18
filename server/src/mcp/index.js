import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  account,
  createMemoryPendingStore,
  createPendingStore,
  filterOpenOrders,
  inferOrderType,
  resolveMarketTradeQuantity,
  requiresConfirmationForTradeValue,
  requiresConfirmationForTransferValue,
  TOOL_DEFINITIONS,
  TOOL_NAMES,
  toZodShape,
} from "chat-assistant";

const definition = (name) => TOOL_DEFINITIONS[name];

// The argument surface the assistant advertises, validated the same way over
// MCP: only the fields a tool truly cannot run without are mandatory, so a
// market trade accepts `quantity` or `amount` and requires neither.
const inputSchemaFor = (name) =>
  toZodShape(definition(name).schema, { required: definition(name).required });

/**
 * MCP tool layer over the account service (which proxies trading-api). The
 * service is injectable so tests can substitute a stub, and every argument
 * schema is derived from chat-assistant's TOOL_DEFINITIONS so the MCP surface
 * can never drift from the assistant's.
 *
 * Safeguard gates mirror the chat assistant exactly: trades at `quantity >= 10`
 * or $1,000+ and cash transfers of $500+ require an explicit `confirm: true`.
 *
 * A gated call also writes the pending action to the same pending store the chat
 * assistant uses — in-memory in local dev, TTL-expiring DynamoDB in production —
 * and returns the minted `confirmationId`, so `resolve_confirmation` can execute
 * or discard it. The store is injected per process (see server.js); when it is
 * not, an in-memory store is created lazily so read-only tools and tests never
 * depend on AWS configuration.
 *
 * When the client advertises `capabilities.elicitation.form`, the same gate asks
 * the user inline with an `elicitation/create` request instead: the confirmation
 * happens while the tool call is still open, so no ID round-trip is needed and no
 * pending entry is written. Elicitation is a server->client request over a
 * bidirectional session, so it layers on top of the `confirm: true` argument and
 * the pending store rather than replacing either — headless, stdio and
 * non-capable clients transparently take the structured path.
 */
export function createTradingMcpServer({
  service = account,
  pendingStore,
} = {}) {
  const server = new McpServer({
    name: "fake-stock-trading-mcp",
    version: "1.0.0",
  });

  // Lazy fallback (decision #8): constructed on the first gated call so a
  // missing PENDING_CONFIRMATIONS_TABLE can never break a read-only tool.
  let fallbackStore = null;
  const store = () => {
    if (pendingStore) return pendingStore;
    fallbackStore ??= createMemoryPendingStore();
    return fallbackStore;
  };

  // The confirm/cancel entry point re-runs the originating tool through its own
  // handler, so the execution path stays single-sourced.
  const toolHandlers = new Map();

  function registerTool(name, config, handler) {
    toolHandlers.set(name, handler);
    server.registerTool(name, config, handler);
  }

  // Elicitation is a server->client request, so it needs a bidirectional session
  // and a client that advertised `capabilities.elicitation.form` during
  // initialization (the SDK's `elicitInput` throws otherwise). Absence is the
  // normal case for the stdio bootstrap and any headless client, and it always
  // falls back to the structured payload below.
  const supportsElicitation = () =>
    server.server.getClientCapabilities()?.elicitation?.form != null;

  // Single source of the confirmation payload shape. Every gated handler
  // returns whatever this builds, so the pending write and the ID field can
  // never drift between tools. Gated tools hand over their `tool` name and the
  // validated arguments so the pending entry can be replayed on confirm.
  async function confirmationRequired({
    tool,
    arguments: argumentValues,
    ...details
  }) {
    const { confirmationId } = await store().put({
      tool,
      arguments: { ...argumentValues },
    });
    const payload = {
      requiresConfirmation: true,
      confirmationId,
      ...details,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }

  // Market buys/sells convert an optional dollar `amount` into whole shares at
  // the live price, exactly like chat.js. An amount that rounds down to zero
  // whole shares returns the assistant's structured error instead of calling
  // the service, so both surfaces refuse the same requests.
  function marketTradeError({ side, amount, pricePerShare }) {
    const verb = side === "buy" ? "buy" : "sell";
    const guidance =
      side === "buy"
        ? "Increase the amount or buy 1 share to proceed."
        : "Increase the amount or specify a quantity to proceed.";
    return {
      error: `At the current price of $${pricePerShare.toFixed(2)}, $${amount.toFixed(2)} would ${verb} 0 whole shares. ${guidance}`,
      side,
      requestedAmount: amount,
      pricePerShare,
    };
  }

  // The two terminal outcomes of `resolve_confirmation`. Both are structured
  // results rather than errors: the caller asked about an action and gets a
  // definite answer either way.
  function noPendingAction(confirmationId) {
    const payload = {
      error: "There is no pending action with that confirmationId.",
      confirmationId,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }

  function confirmationCancelled(confirmationId, tool) {
    const payload = {
      resolved: "cancelled",
      confirmationId,
      ...(tool ? { tool } : {}),
      message: "Cancelled the pending action. Nothing was executed.",
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  }

  // Elicitation outcomes that did not execute. `decline` and `cancel` are
  // reported distinctly because the protocol distinguishes "the user said no"
  // from "the prompt was dismissed"; the same wording covers an accepted form
  // that came back with `confirm: false`.
  function confirmationDenied(action, message) {
    const payload = { resolved: action, message };
    return {
      content: [
        {
          type: "text",
          text: `${message}\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
      structuredContent: payload,
    };
  }

  function confirmationDeclined({ label = "action" } = {}) {
    return confirmationDenied(
      "declined",
      `The user declined the ${label}. Nothing was executed.`,
    );
  }

  function confirmationDismissed({ label = "action" } = {}) {
    return confirmationDenied(
      "cancelled",
      `The confirmation prompt for the ${label} was dismissed. Nothing was executed.`,
    );
  }

  /**
   * The one gate every confirmable action goes through. Returns
   * `{ confirmed: true }` when the caller may execute and otherwise the terminal
   * result to hand back untouched:
   *
   * - `confirm: true` supplied -> execute, always. The explicit flag wins so the
   *   documented fallback path and every existing client keep working.
   * - A client that did not advertise `capabilities.elicitation.form` -> the
   *   structured `{ requiresConfirmation: true, confirmationId, ... }` payload.
   * - A capable client -> a form elicitation carrying a single boolean `confirm`
   *   field. Only `accept` with `confirm: true` executes.
   */
  async function ensureConfirmed({
    confirmed,
    tool,
    arguments: argumentValues,
    ...details
  }) {
    if (confirmed === true) {
      return { confirmed: true };
    }

    if (!supportsElicitation()) {
      return {
        confirmed: false,
        result: await confirmationRequired({
          tool,
          arguments: argumentValues,
          ...details,
        }),
      };
    }

    // Elicitation renders a form, not a button, so a boolean maps to a checkbox
    // or toggle (the closest rendering to a confirm action; an enum would render
    // as a dropdown). The `message` carries the full context, the Cancel action
    // is protocol-level, and `content` is re-checked rather than trusted even
    // though the SDK validates it against this schema.
    const elicitation = await server.server.elicitInput({
      mode: "form",
      message: details.message,
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Confirm",
            description:
              typeof details.value === "number"
                ? `This ${details.label ?? tool} is worth $${details.value.toFixed(2)}. Confirm to execute.`
                : `Confirm to execute this ${details.label ?? tool}.`,
            default: false,
          },
        },
        required: ["confirm"],
      },
    });

    if (elicitation?.action === "decline") {
      return { confirmed: false, result: confirmationDeclined(details) };
    }
    if (elicitation?.action === "cancel") {
      return { confirmed: false, result: confirmationDismissed(details) };
    }

    // Accepting only means the form was submitted. An accepted form that leaves
    // `confirm` unchecked is not consent, so it falls back to the structured
    // payload (with its confirmationId) instead of executing.
    if (elicitation?.content?.confirm !== true) {
      return {
        confirmed: false,
        result: await confirmationRequired({
          tool,
          arguments: argumentValues,
          ...details,
        }),
      };
    }

    return { confirmed: true };
  }

  // The human-readable summary shared by the structured payload and the
  // elicitation message, so the user always sees the same quantity, price and
  // remainder whether they confirm inline or by echoing a confirmationId.
  function tradePendingMessage({ side, pricePerShare, result }) {
    if (result.fromAmount) {
      const remainderNote =
        result.remainder > 0
          ? ` (remainder $${result.remainder.toFixed(2)} not ${side === "buy" ? "spent" : "sold"})`
          : "";
      return `Requested $${result.amount.toFixed(2)}; at $${pricePerShare.toFixed(2)} per share you can ${side} ${result.quantity} shares for $${result.spent.toFixed(2)}${remainderNote}. Please confirm before executing.`;
    }
    return `This ${side} is worth $${result.spent.toFixed(2)}. Please confirm before executing.`;
  }

  // Market buys and sells differ only by side: the same resolve -> gate ->
  // execute sequence runs once here, so neither surface nor the elicitation path
  // can be wired into one and forgotten in the other.
  function registerMarketTrade({ name, side, label, verb }) {
    registerTool(
      name,
      {
        description: `${
          side === "buy" ? "Buy" : "Sell"
        } FAKE shares immediately at the current price. Pass \`quantity\`, or an \`amount\` in dollars that is converted to whole shares at the live price.`,
        inputSchema: inputSchemaFor(name),
      },
      async ({ quantity, amount, confirm = false }) => {
        const quote = await service.getQuote();
        const pricePerShare = Number(quote?.price ?? 0);
        const resolved = resolveMarketTradeQuantity({
          quantity,
          amount,
          pricePerShare,
        });

        // A missing quantity, and a dollar amount that rounds down to zero whole
        // shares, never reach the service: the caller is given the assistant's
        // own structured refusal. These are refusals rather than confirmable
        // actions, so they bypass the store and the elicitation prompt.
        const refused =
          resolved.quantity == null
            ? {
                error: `A quantity of at least 1 whole share (or a dollar amount) is required to ${verb}.`,
              }
            : resolved.fromAmount && resolved.quantity <= 0
              ? marketTradeError({
                  side,
                  amount: resolved.amount,
                  pricePerShare,
                })
              : null;

        if (refused) {
          return {
            content: [{ type: "text", text: JSON.stringify(refused, null, 2) }],
            structuredContent: refused,
          };
        }

        if (
          requiresConfirmationForTradeValue(resolved.quantity, pricePerShare)
        ) {
          const gate = await ensureConfirmed({
            confirmed: confirm === true,
            tool: name,
            arguments: { quantity, amount },
            label,
            value: resolved.spent,
            quantity: resolved.quantity,
            message: tradePendingMessage({
              side,
              pricePerShare,
              result: resolved,
            }),
          });
          if (!gate.confirmed) return gate.result;
        }

        const result =
          side === "buy"
            ? await service.buy(resolved.quantity)
            : await service.sell(resolved.quantity);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      },
    );
  }

  registerTool(
    "get_portfolio_summary",
    {
      description:
        "Get the current portfolio summary: cash, invested amount (cost basis), gains/losses, holdings, and total equity.",
      inputSchema: {},
    },
    async () => {
      const summary = await service.getPortfolioSummary();
      const payload = { account: summary.account };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "get_quote",
    {
      description: "Get the current FAKE stock price and recent history.",
      inputSchema: {},
    },
    async () => {
      const quote = await service.getQuote();
      const payload = {
        symbol: quote.symbol,
        price: quote.price,
        history: quote.history.slice(-30),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  registerMarketTrade({
    name: TOOL_NAMES.buyStock,
    side: "buy",
    label: "buy order",
    verb: "buy",
  });

  registerMarketTrade({
    name: TOOL_NAMES.sellStock,
    side: "sell",
    label: "sell order",
    verb: "sell",
  });

  registerTool(
    "transfer_cash",
    {
      description:
        "Deposit cash into or withdraw cash from the user's account. Positive amounts deposit; negative amounts withdraw.",
      inputSchema: inputSchemaFor(TOOL_NAMES.transferCash),
    },
    async ({ amount, confirm = false }) => {
      // Deposits/withdrawals of $500+ require a human confirmation, matching
      // the assistant and the `confirm` description in tools.js.
      if (requiresConfirmationForTransferValue(amount) && confirm !== true) {
        const transferType = Number(amount) >= 0 ? "deposit" : "withdrawal";
        const absAmount = Math.abs(Number(amount));
        const gate = await ensureConfirmed({
          confirmed: confirm === true,
          tool: TOOL_NAMES.transferCash,
          arguments: { amount },
          label: `cash ${transferType}`,
          value: absAmount,
          transferType,
          amount: absAmount,
          message: `A cash ${transferType} of $${absAmount.toFixed(2)} requires confirmation. Please confirm before it is processed.`,
        });
        if (!gate.confirmed) return gate.result;
      }

      const result = await service.transfer(amount);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  registerTool(
    "place_order",
    {
      description:
        "Place a limit or stop order for FAKE shares. Limit buy executes when the price falls to or below the limit price; limit sell executes when the price rises to or above it. Stop buy executes when the price rises to or above the stop price; stop sell executes when the price falls to or below it.",
      inputSchema: inputSchemaFor(TOOL_NAMES.placeOrder),
    },
    async ({ type, side, quantity, price, confirm = false }) => {
      const tool = TOOL_NAMES.placeOrder;
      const quote = await service.getQuote();
      const currentPrice = Number(quote?.price ?? 0);
      const tradeValue = Number(quantity) * currentPrice;

      // The requested type is validated by Zod, but a semantically impossible
      // combination (e.g. a buy trigger below market) is corrected the same way
      // the assistant corrects it — and, unlike before, the correction is
      // reported instead of applied silently.
      const {
        type: orderType,
        corrected,
        requestedType,
      } = inferOrderType({
        requestedType: type,
        side,
        triggerPrice: price,
        currentPrice,
      });
      const warning = corrected
        ? `Your ${requestedType} ${side} at $${Number(price).toFixed(2)} was placed as a ${orderType} ${side}, since a ${requestedType} ${side} trigger at that price would have filled instantly at the current market price of $${currentPrice.toFixed(2)}.`
        : null;

      if (
        requiresConfirmationForTradeValue(quantity, currentPrice) &&
        confirm !== true
      ) {
        const pendingMessage = `This order is worth $${tradeValue.toFixed(2)}. Please confirm before executing.`;
        const gate = await ensureConfirmed({
          confirmed: confirm === true,
          tool,
          arguments: { type, side, quantity, price },
          label: `${requestedType} ${side} order`,
          value: tradeValue,
          quantity,
          message: warning ? `${warning} ${pendingMessage}` : pendingMessage,
          ...(warning ? { warning } : {}),
        });
        if (!gate.confirmed) return gate.result;
      }

      const result = await service.placeOrder({
        type: orderType,
        side,
        quantity,
        price,
      });
      const payload = { ...result, ...(warning ? { warning } : {}) };
      return {
        content: [
          {
            type: "text",
            text: warning
              ? `${JSON.stringify(payload, null, 2)}\n\n${warning}`
              : JSON.stringify(payload, null, 2),
          },
        ],
        structuredContent: payload,
      };
    },
  );

  registerTool(
    "list_orders",
    {
      description:
        "List the user's open trading orders, optionally filtered by type (limit/stop) and side (buy/sell).",
      inputSchema: inputSchemaFor(TOOL_NAMES.listOrders),
    },
    async ({ type, side }) => {
      const result = await service.listOrders();
      const payload = {
        orders: filterOpenOrders(result?.orders, { type, side }),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  registerTool(
    "cancel_order",
    {
      description:
        "Cancel an open limit or stop order. Defaults to the user's pending order when no orderId is given.",
      inputSchema: inputSchemaFor(TOOL_NAMES.cancelOrder),
    },
    async ({ orderId }) => {
      const result = await service.cancelOrder(orderId ?? "pending");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  // The confirm/cancel entry point. Without it a minted `confirmationId` would
  // be a write-only dead end: gated tools write the pending action to the store
  // and the caller has to be able to act on that ID. Confirming re-executes the
  // stored arguments through the originating tool's handler with `confirm: true`
  // (so the gate is passed and the execution path is not duplicated); cancelling
  // discards the entry without touching the service.
  registerTool(
    TOOL_NAMES.resolveConfirmation,
    {
      description: definition(TOOL_NAMES.resolveConfirmation).description,
      inputSchema: inputSchemaFor(TOOL_NAMES.resolveConfirmation),
    },
    async ({ confirmationId, action }) => {
      const pending = await store().get(confirmationId);

      if (!pending) {
        // Covers an unknown ID and an expired entry: both stores return null.
        return noPendingAction(confirmationId);
      }

      if (action === "cancel") {
        await store().remove(confirmationId);
        return confirmationCancelled(confirmationId, pending.tool);
      }

      const execute = toolHandlers.get(pending.tool);
      if (!execute) {
        // A pending entry is only useful if its tool still exists; refuse rather
        // than silently dropping the request.
        return noPendingAction(confirmationId);
      }

      await store().remove(confirmationId);
      return execute({ ...(pending.arguments ?? {}), confirm: true });
    },
  );

  return server;
}

export async function startTradingMcpServer(options = {}) {
  const server = createTradingMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  account
    .init()
    .then(() => {
      // The stdio bootstrap picks its store the way every host does: DynamoDB
      // only when PENDING_CONFIRMATIONS_TABLE is configured, in-memory
      // otherwise, so running offline never tries to reach AWS.
      const { store, kind } = createPendingStore();
      return startTradingMcpServer({ pendingStore: store }).then(() => {
        console.log(`Fake stock MCP server running on stdio (${kind} store)`);
      });
    })
    .catch((error) => {
      console.error("Failed to start fake stock MCP server:", error);
      process.exit(1);
    });
}
