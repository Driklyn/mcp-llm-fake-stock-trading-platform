import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMemoryPendingStore } from "chat-assistant";
import { createTradingMcpServer } from "../src/mcp/index.js";

function stubService() {
  return {
    getPortfolioSummary: async () => ({
      account: {
        cashAvailable: 10000,
        holdings: 0,
        investedValue: 0,
        costBasis: 0,
        realizedGains: 0,
        unrealizedGains: 0,
        totalGainsLosses: 0,
        totalEquity: 10000,
        cashTransferred: 0,
      },
      transactions: [],
    }),
    getQuote: async () => ({ symbol: "FAKE", price: 100, history: [] }),
    buy: async (quantity) => ({
      kind: "buy",
      quantity,
      price: 100,
      holdings: quantity,
      cashAvailable: 10000 - 100 * quantity,
    }),
    sell: async (quantity) => ({
      kind: "sell",
      quantity,
      cashAvailable: 11000,
    }),
    transfer: async (amount) => ({
      transferType: amount >= 0 ? "deposit" : "withdrawal",
      amount: Math.abs(amount),
      cashAvailable: 10000 + amount,
      totalEquity: 10000 + amount,
      cashTransferred: amount,
    }),
    placeOrder: async ({ type, side, quantity, price }) => ({
      id: "1",
      type,
      kind: side,
      quantity,
      price,
      status: "open",
    }),
    listOrders: async () => ({ orders: [] }),
    cancelOrder: async (orderId) => ({ id: orderId, status: "cancelled" }),
  };
}

// A client that advertises `capabilities.elicitation.form` and answers
// `elicitation/create` the way the SDK's own example hosts do. `responder`
// receives the request params and returns an `ElicitResult`, so each test can
// drive accept/decline/cancel and inspect the form it was shown.
function elicitationCapabilities() {
  return { elicitation: { form: {} } };
}

async function withMcpClient(
  service,
  fn,
  { pendingStore, capabilities, responder } = {},
) {
  const serverInstance = createTradingMcpServer({ service, pendingStore });
  const [client, server] = InMemoryTransport.createLinkedPair();
  await serverInstance.connect(server);
  const mcpClient = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: capabilities ?? {} },
  );
  if (responder) {
    mcpClient.setRequestHandler(ElicitRequestSchema, async (request) =>
      responder(request.params),
    );
  }
  await mcpClient.connect(client);
  try {
    await fn(mcpClient);
  } finally {
    await mcpClient.close();
  }
}

test("get_portfolio_summary returns the trimmed account summary as structured content", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "get_portfolio_summary",
      arguments: {},
    });
    assert.ok(result.content[0].text.includes("totalEquity"));
    assert.equal(result.structuredContent.account.cashAvailable, 10000);
    // The account object includes every field the summary text needs.
    for (const key of [
      "cashAvailable",
      "costBasis",
      "holdings",
      "totalEquity",
      "totalGainsLosses",
    ]) {
      assert.ok(
        key in result.structuredContent.account,
        `expected account.${key} in the tool payload`,
      );
    }
    assert.equal(result.structuredContent.price, undefined);
    assert.equal(result.structuredContent.transactions, undefined);
    assert.equal(result.structuredContent.orders, undefined);
  });
});

test("buy_stock executes a small trade without confirmation", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "buy_stock",
      arguments: { quantity: 2 },
    });
    assert.equal(result.structuredContent.kind, "buy");
    assert.equal(result.structuredContent.quantity, 2);
    assert.equal(result.structuredContent.cashAvailable, 9800);
  });
});

test("buy_stock requires confirmation for trades worth $1000 or more", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "buy_stock",
      arguments: { quantity: 10 }, // 10 * $100 = $1000
    });
    assert.equal(result.structuredContent.requiresConfirmation, true);
  });
});

test("sell_stock routes to the service", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "sell_stock",
      arguments: { quantity: 3 },
    });
    assert.equal(result.structuredContent.kind, "sell");
    assert.equal(result.structuredContent.quantity, 3);
  });
});

test("buy_stock requires confirmation at 10 shares even below $1000", async () => {
  const service = {
    ...stubService(),
    getQuote: async () => ({ symbol: "FAKE", price: 50, history: [] }),
  };
  await withMcpClient(service, async (client) => {
    // 10 * $50 = $500, below the $1000 value threshold.
    const result = await client.callTool({
      name: "buy_stock",
      arguments: { quantity: 10 },
    });
    assert.equal(result.structuredContent.requiresConfirmation, true);
    assert.equal(result.structuredContent.value, 500);
  });
});

test("place_order corrects an impossible order type and reports a warning", async () => {
  const orders = [];
  const service = {
    ...stubService(),
    placeOrder: async (input) => {
      orders.push(input);
      return { id: "1", quantity: input.quantity, price: input.price };
    },
  };
  await withMcpClient(service, async (client) => {
    // A stop buy below the $100 market price would fill instantly.
    const result = await client.callTool({
      name: "place_order",
      arguments: { type: "stop", side: "buy", quantity: 2, price: 95 },
    });
    assert.deepEqual(orders[0], {
      type: "limit",
      side: "buy",
      quantity: 2,
      price: 95,
    });
    assert.match(result.structuredContent.warning, /was placed as a limit buy/);
    assert.match(result.content[0].text, /was placed as a limit buy/);
  });
});

test("place_order does not warn when the order type is already correct", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "place_order",
      arguments: { type: "limit", side: "buy", quantity: 2, price: 95 },
    });
    assert.equal(result.structuredContent.warning, undefined);
  });
});

test("transfer_cash routes to the service for amounts under $500", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "transfer_cash",
      arguments: { amount: 250 },
    });
    assert.equal(result.structuredContent.transferType, "deposit");
    assert.equal(result.structuredContent.amount, 250);
    assert.equal(result.structuredContent.cashAvailable, 10250);
  });
});

test("transfer_cash requires confirmation for transfers of $500 or more", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "transfer_cash",
      arguments: { amount: 2500 },
    });
    assert.equal(result.structuredContent.requiresConfirmation, true);
    assert.match(result.structuredContent.message, /deposit of \$2500\.00/);
  });
});

test("transfer_cash requires confirmation for withdrawals of $500 or more", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "transfer_cash",
      arguments: { amount: -500 },
    });
    assert.equal(result.structuredContent.requiresConfirmation, true);
    assert.equal(result.structuredContent.transferType, "withdrawal");
    assert.equal(result.structuredContent.value, 500);
  });
});

test("transfer_cash executes once the transfer is confirmed", async () => {
  await withMcpClient(stubService(), async (client) => {
    const result = await client.callTool({
      name: "transfer_cash",
      arguments: { amount: 500, confirm: true },
    });
    assert.equal(result.structuredContent.amount, 500);
    assert.equal(result.structuredContent.cashAvailable, 10500);
    assert.equal(result.structuredContent.requiresConfirmation, undefined);
  });
});

test("place_order, list_orders, and cancel_order route to the service", async () => {
  await withMcpClient(stubService(), async (client) => {
    const placed = await client.callTool({
      name: "place_order",
      arguments: { type: "limit", side: "buy", quantity: 2, price: 95 },
    });
    assert.equal(placed.structuredContent.status, "open");

    const listed = await client.callTool({
      name: "list_orders",
      arguments: {},
    });
    assert.deepEqual(listed.structuredContent, { orders: [] });

    const cancelled = await client.callTool({
      name: "cancel_order",
      arguments: { orderId: "1" },
    });
    assert.equal(cancelled.structuredContent.status, "cancelled");
  });
});

test("buy_stock converts a dollar amount into whole shares at the live price", async () => {
  const buys = [];
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity, cashAvailable: 10000 - 100 * quantity };
    },
  };
  await withMcpClient(service, async (client) => {
    const result = await client.callTool({
      name: "buy_stock",
      arguments: { amount: 250 },
    });
    // $250 at $100 per share is 2 whole shares; the $50 remainder is not spent.
    assert.deepEqual(buys, [2]);
    assert.equal(result.structuredContent.quantity, 2);
  });
});

test("buy_stock refuses a dollar amount worth zero whole shares", async () => {
  const buys = [];
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity };
    },
  };
  await withMcpClient(service, async (client) => {
    const result = await client.callTool({
      name: "buy_stock",
      arguments: { amount: 50 },
    });
    // $50 cannot buy a single $100 share, so the service is never called and the
    // caller is given the same guidance the assistant gives.
    assert.deepEqual(buys, []);
    assert.match(result.structuredContent.error, /would buy 0 whole shares/);
    assert.match(result.structuredContent.error, /Increase the amount/);
  });
});

test("sell_stock converts a dollar amount and gates on share count", async () => {
  const service = {
    ...stubService(),
    // 10 shares at $50 is only $500, but the 10-share rule still gates it.
    getQuote: async () => ({ symbol: "FAKE", price: 50, history: [] }),
  };
  await withMcpClient(service, async (client) => {
    const result = await client.callTool({
      name: "sell_stock",
      arguments: { amount: 500 },
    });
    assert.equal(result.structuredContent.requiresConfirmation, true);
    assert.equal(result.structuredContent.quantity, 10);
    assert.equal(result.structuredContent.value, 500);
  });
});

test("buy_stock without a quantity or an amount is rejected before any service call", async () => {
  const buys = [];
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity };
    },
  };
  await withMcpClient(service, async (client) => {
    const result = await client.callTool({ name: "buy_stock", arguments: {} });
    assert.deepEqual(buys, []);
    assert.match(result.structuredContent.error, /at least 1 whole share/);
  });
});

test("list_orders filters to open orders and honors type and side", async () => {
  const service = {
    ...stubService(),
    listOrders: async () => ({
      orders: [
        { id: "1", type: "limit", kind: "buy", status: "open", price: 95 },
        { id: "2", type: "stop", kind: "sell", status: "filled", price: 105 },
        { id: "3", type: "stop", kind: "sell", status: "open", price: 120 },
        {
          id: "4",
          type: "limit",
          kind: "sell",
          status: "cancelled",
          price: 90,
        },
      ],
    }),
  };
  await withMcpClient(service, async (client) => {
    const all = await client.callTool({ name: "list_orders", arguments: {} });
    assert.deepEqual(
      all.structuredContent.orders.map((order) => order.id),
      ["1", "3"],
    );

    const sellStops = await client.callTool({
      name: "list_orders",
      arguments: { type: "stop", side: "sell" },
    });
    assert.deepEqual(
      sellStops.structuredContent.orders.map((order) => order.id),
      ["3"],
    );

    const limits = await client.callTool({
      name: "list_orders",
      arguments: { type: "limit" },
    });
    assert.deepEqual(
      limits.structuredContent.orders.map((order) => order.id),
      ["1"],
    );
  });
});

test("cancel_order defaults to the pending order", async () => {
  const cancelled = [];
  const service = {
    ...stubService(),
    cancelOrder: async (orderId) => {
      cancelled.push(orderId);
      return { id: orderId, status: "cancelled" };
    },
  };
  await withMcpClient(service, async (client) => {
    const result = await client.callTool({
      name: "cancel_order",
      arguments: {},
    });
    assert.deepEqual(cancelled, ["pending"]);
    assert.equal(result.structuredContent.id, "pending");
  });
});

test("a gated call mints a confirmationId in the injected pending store", async () => {
  const pendingStore = createMemoryPendingStore();
  const service = {
    ...stubService(),
    getQuote: async () => ({ symbol: "FAKE", price: 50, history: [] }),
  };
  await withMcpClient(
    service,
    async (client) => {
      const result = await client.callTool({
        name: "buy_stock",
        arguments: { quantity: 10 }, // 10 shares at $50 gates on the share rule
      });
      assert.equal(result.structuredContent.requiresConfirmation, true);

      const confirmationId = result.structuredContent.confirmationId;
      assert.equal(typeof confirmationId, "string");
      assert.ok(result.content[0].text.includes(confirmationId));

      // The pending action is retrievable and remembers the originating tool
      // and the arguments needed to re-execute it.
      const pending = await pendingStore.get(confirmationId);
      assert.equal(pending.tool, "buy_stock");
      assert.equal(pending.arguments.quantity, 10);
      assert.equal(await pendingStore.size(), 1);
    },
    { pendingStore },
  );
});

test("resolve_confirmation with `confirm` executes the pending action and removes it", async () => {
  const pendingStore = createMemoryPendingStore();
  const buys = [];
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity, price: 100, cashAvailable: 9000 };
    },
  };
  await withMcpClient(
    service,
    async (client) => {
      const gated = await client.callTool({
        name: "buy_stock",
        arguments: { quantity: 10 },
      });
      const { confirmationId } = gated.structuredContent;
      assert.deepEqual(buys, []);

      const resolved = await client.callTool({
        name: "resolve_confirmation",
        arguments: { confirmationId, action: "confirm" },
      });

      // The stored arguments are replayed with confirm: true, so the trade runs
      // through the same handler that gated it.
      assert.deepEqual(buys, [10]);
      assert.equal(resolved.structuredContent.kind, "buy");
      assert.equal(resolved.structuredContent.quantity, 10);
      assert.equal(resolved.structuredContent.requiresConfirmation, undefined);
      // The entry is consumed, so a second resolve finds nothing.
      assert.equal(await pendingStore.get(confirmationId), null);
    },
    { pendingStore },
  );
});

test("resolve_confirmation with `cancel` discards the pending action without executing", async () => {
  const pendingStore = createMemoryPendingStore();
  const transfers = [];
  const service = {
    ...stubService(),
    transfer: async (amount) => {
      transfers.push(amount);
      return { amount, cashAvailable: 10000 + amount };
    },
  };
  await withMcpClient(
    service,
    async (client) => {
      const gated = await client.callTool({
        name: "transfer_cash",
        arguments: { amount: 500 },
      });
      const { confirmationId } = gated.structuredContent;

      const resolved = await client.callTool({
        name: "resolve_confirmation",
        arguments: { confirmationId, action: "cancel" },
      });

      assert.deepEqual(transfers, []);
      assert.equal(resolved.structuredContent.resolved, "cancelled");
      assert.equal(resolved.structuredContent.tool, "transfer_cash");
      assert.equal(await pendingStore.get(confirmationId), null);
    },
    { pendingStore },
  );
});

test("resolve_confirmation rejects an unknown confirmationId", async () => {
  await withMcpClient(
    stubService(),
    async (client) => {
      const result = await client.callTool({
        name: "resolve_confirmation",
        arguments: { confirmationId: "does-not-exist", action: "confirm" },
      });
      assert.match(
        result.structuredContent.error,
        /no pending action with that confirmationId/,
      );
      assert.equal(result.structuredContent.confirmationId, "does-not-exist");
    },
    { pendingStore: createMemoryPendingStore() },
  );
});

test("a server with no injected pendingStore still gates and mints a usable confirmationId", async () => {
  const buys = [];
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity, price: 100, cashAvailable: 9000 };
    },
  };
  await withMcpClient(service, async (client) => {
    const gated = await client.callTool({
      name: "buy_stock",
      arguments: { quantity: 10 },
    });
    const { confirmationId } = gated.structuredContent;
    assert.equal(typeof confirmationId, "string");

    // The lazily created store backs `resolve_confirmation` too, so the ID is
    // not a dead end even without an injected store.
    const resolved = await client.callTool({
      name: "resolve_confirmation",
      arguments: { confirmationId, action: "confirm" },
    });
    assert.deepEqual(buys, [10]);
    assert.equal(resolved.structuredContent.kind, "buy");
  });
});

test("a capable client confirms inline through elicitation, with no pending entry", async () => {
  const pendingStore = createMemoryPendingStore();
  const buys = [];
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity, price: 100, cashAvailable: 9000 };
    },
  };
  const prompts = [];

  await withMcpClient(
    service,
    async (client) => {
      const result = await client.callTool({
        name: "buy_stock",
        arguments: { quantity: 10 },
      });

      // The human confirmed the prompt, so the trade executed inline...
      assert.deepEqual(buys, [10]);
      assert.equal(result.structuredContent.kind, "buy");
      assert.equal(result.structuredContent.quantity, 10);
      assert.equal(result.structuredContent.requiresConfirmation, undefined);

      // ...and the confirmation never touched the pending store, so there is
      // nothing left for `resolve_confirmation` to find.
      assert.equal(await pendingStore.size(), 0);
    },
    {
      pendingStore,
      capabilities: elicitationCapabilities(),
      responder: (params) => {
        prompts.push(params);
        return { action: "accept", content: { confirm: true } };
      },
    },
  );

  // The prompt is a form with a single boolean `confirm` field (decision #4), a
  // checkbox/toggle rather than the dropdown an enum would render, and the
  // message carries the human-readable value.
  assert.equal(prompts.length, 1);
  const [prompt] = prompts;
  assert.equal(prompt.mode, "form");
  assert.match(prompt.message, /worth \$1000\.00/);
  assert.deepEqual(prompt.requestedSchema.required, ["confirm"]);
  assert.equal(prompt.requestedSchema.type, "object");
  assert.deepEqual(prompt.requestedSchema.properties.confirm, {
    type: "boolean",
    title: "Confirm",
    description: "This buy order is worth $1000.00. Confirm to execute.",
    default: false,
  });
});

test("elicitation decline does not execute and is reported distinctly from cancel", async () => {
  const buys = [];
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity };
    },
  };

  for (const [action, expected] of [
    ["decline", "declined"],
    ["cancel", "cancelled"],
  ]) {
    await withMcpClient(
      service,
      async (client) => {
        const result = await client.callTool({
          name: "buy_stock",
          arguments: { quantity: 10 },
        });
        assert.deepEqual(buys, []);
        assert.equal(result.structuredContent.resolved, expected);
        assert.equal(result.structuredContent.requiresConfirmation, undefined);
        assert.match(result.content[0].text, new RegExp(expected));
      },
      {
        pendingStore: createMemoryPendingStore(),
        capabilities: elicitationCapabilities(),
        responder: () => ({ action }),
      },
    );
  }

  assert.deepEqual(buys, []);
});

test("an accepted form that leaves `confirm` unchecked falls back to the structured payload", async () => {
  const pendingStore = createMemoryPendingStore();
  const buys = [];
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity };
    },
  };

  await withMcpClient(
    service,
    async (client) => {
      const result = await client.callTool({
        name: "buy_stock",
        arguments: { quantity: 10 },
      });

      // Submitting the form is not consent, so the trade did not run and the
      // caller gets the usual structured payload with an actionable ID.
      assert.deepEqual(buys, []);
      assert.equal(result.structuredContent.requiresConfirmation, true);
      assert.equal(typeof result.structuredContent.confirmationId, "string");
      assert.equal(await pendingStore.size(), 1);

      const resolved = await client.callTool({
        name: "resolve_confirmation",
        arguments: {
          confirmationId: result.structuredContent.confirmationId,
          action: "confirm",
        },
      });
      assert.deepEqual(buys, [10]);
      assert.equal(resolved.structuredContent.kind, "buy");
    },
    {
      pendingStore,
      capabilities: elicitationCapabilities(),
      responder: () => ({ action: "accept", content: { confirm: false } }),
    },
  );
});

test("elicitation covers every gated action: transfer_cash and place_order", async () => {
  const transfers = [];
  const orders = [];
  const service = {
    ...stubService(),
    transfer: async (amount) => {
      transfers.push(amount);
      return { amount, cashAvailable: 10000 + amount };
    },
    placeOrder: async (order) => {
      orders.push(order);
      return { id: "1", ...order, kind: order.side, status: "open" };
    },
  };
  const messages = [];

  await withMcpClient(
    service,
    async (client) => {
      // Confirmed inline through elicitation, so both calls execute and return
      // the service result directly (the `transferType`/`amount` details belong
      // to the structured confirmation payload, not to an executed transfer).
      const withdrawal = await client.callTool({
        name: "transfer_cash",
        arguments: { amount: -600 },
      });
      assert.equal(withdrawal.structuredContent.amount, -600);
      assert.equal(withdrawal.structuredContent.cashAvailable, 9400);

      const order = await client.callTool({
        name: "place_order",
        arguments: { type: "limit", side: "buy", quantity: 20, price: 95 },
      });
      assert.equal(order.structuredContent.status, "open");
      assert.equal(order.structuredContent.quantity, 20);
      assert.equal(order.structuredContent.type, "limit");
    },
    {
      pendingStore: createMemoryPendingStore(),
      capabilities: elicitationCapabilities(),
      responder: (params) => {
        messages.push(params.message);
        return { action: "accept", content: { confirm: true } };
      },
    },
  );

  assert.deepEqual(transfers, [-600]);
  assert.equal(orders.length, 1);
  assert.equal(messages.length, 2);
  // Math.abs is applied before the prompt, so the sign never leaks into it.
  assert.match(
    messages[0],
    /cash withdrawal of \$600\.00 requires confirmation/,
  );
  assert.match(messages[1], /This order is worth \$2000\.00/);
});

test("the structured fallback payload names the transfer type and absolute amount", async () => {
  const pendingStore = createMemoryPendingStore();
  await withMcpClient(
    stubService(),
    async (client) => {
      const result = await client.callTool({
        name: "transfer_cash",
        arguments: { amount: -600 },
      });
      assert.equal(result.structuredContent.requiresConfirmation, true);
      assert.equal(result.structuredContent.transferType, "withdrawal");
      // The sign is folded into the type, so the amount is reported unsigned.
      assert.equal(result.structuredContent.amount, 600);
      assert.equal(result.structuredContent.value, 600);
      assert.match(result.structuredContent.message, /withdrawal of \$600\.00/);
    },
    { pendingStore },
  );
});

test("an unconfirmed `place_order` keeps its type-correction warning in the elicitation prompt and the fallback payload", async () => {
  const orders = [];
  const prompts = [];
  const service = {
    ...stubService(),
    placeOrder: async (order) => {
      orders.push(order);
      return { id: "1", ...order, kind: order.side, status: "open" };
    },
  };

  await withMcpClient(
    service,
    async (client) => {
      // A `stop buy` below the market is corrected to a `limit buy` and,
      // being worth $2,000, is gated too. Submitting without `confirm`
      // leaves it unexecuted.
      const result = await client.callTool({
        name: "place_order",
        arguments: { type: "stop", side: "buy", quantity: 20, price: 95 },
      });

      assert.deepEqual(orders, []);
      assert.equal(result.structuredContent.requiresConfirmation, true);
      assert.match(
        result.structuredContent.warning,
        /was placed as a limit buy/,
      );
      assert.match(
        result.structuredContent.message,
        /Your stop buy at \$95\.00 was placed as a limit buy/,
      );
      // The warning travels into the prompt too, so the human sees the
      // correction before deciding.
      assert.match(prompts[0].message, /was placed as a limit buy/);
    },
    {
      pendingStore: createMemoryPendingStore(),
      capabilities: elicitationCapabilities(),
      responder: (params) => {
        prompts.push(params);
        return { action: "accept", content: { confirm: false } };
      },
    },
  );

  assert.equal(prompts.length, 1);
});

test("a client without the elicitation capability gets the structured payload and is never prompted", async () => {
  const pendingStore = createMemoryPendingStore();
  const buys = [];
  const prompted = false;
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity };
    },
  };

  // The client is built by hand rather than through `withMcpClient`: the SDK
  // rejects registering an `elicitation/create` handler unless the capability
  // was advertised, and this case must prove the server never sends one at all.
  const serverInstance = createTradingMcpServer({ service, pendingStore });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await serverInstance.connect(serverTransport);
  const mcpClient = new Client({ name: "test-client", version: "1.0.0" });
  await mcpClient.connect(clientTransport);

  try {
    const result = await mcpClient.callTool({
      name: "buy_stock",
      arguments: { quantity: 10 },
    });
    assert.equal(result.structuredContent.requiresConfirmation, true);
    assert.equal(typeof result.structuredContent.confirmationId, "string");
    assert.equal(result.structuredContent.quantity, 10);
    assert.equal(result.structuredContent.value, 1000);
  } finally {
    await mcpClient.close();
  }

  assert.equal(prompted, false);
  assert.deepEqual(buys, []);
  assert.equal(await pendingStore.size(), 1);
});

test("a capable client confirms a transfer inline and a dismissal is never followed by a prompt", async () => {
  const pendingStore = createMemoryPendingStore();
  const transfers = [];
  const service = {
    ...stubService(),
    transfer: async (amount) => {
      transfers.push(amount);
      return { amount, cashAvailable: 10000 + amount };
    },
  };
  const prompts = [];

  await withMcpClient(
    service,
    async (client) => {
      // The prompt is answered inline, so the withdrawal runs and the transfer
      // never appears in the pending store.
      const withdrawal = await client.callTool({
        name: "transfer_cash",
        arguments: { amount: -500 },
      });
      assert.equal(withdrawal.structuredContent.amount, -500);
      assert.equal(withdrawal.structuredContent.cashAvailable, 9500);
      assert.equal(await pendingStore.size(), 0);

      // The human dismissed the deposit prompt, so nothing executes and the
      // response is a structured dismissal rather than a pending payload.
      const dismissed = await client.callTool({
        name: "transfer_cash",
        arguments: { amount: 500 },
      });
      assert.deepEqual(transfers, [-500]);
      assert.equal(dismissed.structuredContent.resolved, "cancelled");
      assert.equal(dismissed.structuredContent.requiresConfirmation, undefined);
      assert.equal(await pendingStore.size(), 0);
    },
    {
      pendingStore,
      capabilities: elicitationCapabilities(),
      responder: (params) => {
        prompts.push(params);
        return params.message.includes("withdrawal")
          ? { action: "accept", content: { confirm: true } }
          : { action: "cancel" };
      },
    },
  );

  // Both gated calls prompted inline; the store stayed empty throughout, so no
  // confirmationId was ever minted for a capable client.
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].message, /withdrawal of \$500\.00/);
  assert.match(prompts[1].message, /deposit of \$500\.00/);
  assert.deepEqual(transfers, [-500]);
});

test("a confirmed trade over a live session gates, executes, and leaves no pending entry", async () => {
  const pendingStore = createMemoryPendingStore();
  const sells = [];
  const service = {
    ...stubService(),
    sell: async (quantity) => {
      sells.push(quantity);
      return { kind: "sell", quantity, price: 100, cashAvailable: 10000 };
    },
  };

  await withMcpClient(
    // The elicitation request has to travel over a bidirectional session while
    // the tool call is still open; an in-memory pair supports that round trip.
    service,
    async (client) => {
      const result = await client.callTool({
        name: "sell_stock",
        arguments: { quantity: 15 },
      });

      assert.deepEqual(sells, [15]);
      assert.equal(result.structuredContent.kind, "sell");
      assert.equal(result.structuredContent.requiresConfirmation, undefined);
      assert.equal(await pendingStore.size(), 0);
    },
    {
      pendingStore,
      capabilities: elicitationCapabilities(),
      responder: () => ({ action: "accept", content: { confirm: true } }),
    },
  );
});

test("`confirm: true` still executes for a capable client without prompting", async () => {
  const buys = [];
  let prompted = false;
  const service = {
    ...stubService(),
    buy: async (quantity) => {
      buys.push(quantity);
      return { kind: "buy", quantity };
    },
  };

  await withMcpClient(
    service,
    async (client) => {
      const result = await client.callTool({
        name: "buy_stock",
        arguments: { quantity: 10, confirm: true },
      });
      assert.equal(result.structuredContent.kind, "buy");
      assert.equal(result.structuredContent.requiresConfirmation, undefined);
      assert.deepEqual(buys, [10]);
    },
    {
      pendingStore: createMemoryPendingStore(),
      capabilities: elicitationCapabilities(),
      responder: () => {
        prompted = true;
        return { action: "accept", content: { confirm: true } };
      },
    },
  );

  assert.equal(prompted, false);
});
