import test from "node:test";
import assert from "node:assert/strict";
import { createAccountService } from "../src/trading/account.js";

/**
 * Fake cloud client with an in-memory portfolio that the mutation methods
 * mutate, so the account service's post-mutation summary refresh sees the
 * same state the "API" just wrote.
 */
function stubClient(overrides = {}) {
  const portfolio = {
    ok: true,
    cash: 10000,
    holdings: [],
    totalValue: 10000,
    costBasis: 0,
    realizedGains: 0,
    investedValue: 0,
    totalEquity: 10000,
    cashTransferred: 0,
    openOrders: [],
    recentTrades: [],
    recentTransfers: [],
  };

  const client = {
    async fetchPortfolio() {
      // Mirror trading-api's getPortfolio: the 9-field account object is
      // precomputed server-side and shipped as `{ ok, account, generatedAt }`.
      const cashAvailable = Number(portfolio.cash ?? 0);
      const investedValue = Number(portfolio.investedValue ?? 0);
      const costBasis = Number(portfolio.costBasis ?? 0);
      const realizedGains = Number(portfolio.realizedGains ?? 0);
      const unrealizedGains = investedValue - costBasis;
      return {
        ok: true,
        account: {
          cashAvailable,
          investedValue,
          costBasis,
          realizedGains,
          unrealizedGains,
          totalGainsLosses: realizedGains + unrealizedGains,
          // Mirror trading-api's semantic: Holdings = total net shares held
          // (sum of open position quantities), not the count of distinct symbols.
          holdings: portfolio.holdings.reduce(
            (sum, h) => sum + (Number(h.quantity) > 0 ? Number(h.quantity) : 0),
            0,
          ),
          totalEquity: Number(
            portfolio.totalEquity ?? cashAvailable + investedValue,
          ),
          cashTransferred: Number(portfolio.cashTransferred ?? 0),
        },
        generatedAt: 1787529600,
      };
    },
    async fetchLatestTick() {
      return {
        symbol: "FAKE",
        points: [
          { timestamp: 1787529600, price: 99 },
          { timestamp: 1787529615, price: 100 },
        ],
      };
    },
    async fetchTransactions() {
      const trades = portfolio.recentTrades.map((t) => ({
        table: "trade",
        ...t,
      }));
      const transfers = portfolio.recentTransfers.map((t) => ({
        table: "transfer",
        ...t,
      }));
      const orders = portfolio.openOrders.map((o) => ({
        table: "order",
        ...o,
      }));
      return { ok: true, transactions: [...trades, ...transfers, ...orders] };
    },
    async postTrade({ side, quantity }) {
      const fillPrice = 100;
      if (side === "BUY") {
        portfolio.cash -= fillPrice * quantity;
        portfolio.costBasis = fillPrice * quantity;
        portfolio.holdings = [
          {
            symbol: "FAKE",
            quantity,
            averagePrice: fillPrice,
            currentPrice: fillPrice,
            value: fillPrice * quantity,
          },
        ];
      } else {
        portfolio.cash += fillPrice * quantity;
        portfolio.costBasis = 0;
        portfolio.holdings = [];
      }
      portfolio.investedValue = portfolio.holdings[0]?.value ?? 0;
      portfolio.totalValue = portfolio.cash + portfolio.investedValue;
      portfolio.totalEquity = portfolio.totalValue;
      portfolio.recentTrades = [
        {
          id: 1,
          symbol: "FAKE",
          side,
          quantity,
          price: fillPrice,
          created_at: 1787529630,
        },
      ];
      return {
        ok: true,
        trade: {
          id: 1,
          symbol: "FAKE",
          side,
          quantity,
          price: fillPrice,
          created_at: 1787529630,
        },
        fillPrice,
        portfolio: {
          cash: portfolio.cash,
          quantity: portfolio.holdings[0]?.quantity ?? 0,
          averagePrice: fillPrice,
        },
      };
    },
    async postTransfer({ amount }) {
      portfolio.cash += amount;
      portfolio.cashTransferred += amount;
      portfolio.totalValue = portfolio.cash;
      portfolio.totalEquity = portfolio.cash;
      portfolio.recentTransfers = [{ id: 1, amount, created_at: 1787529630 }];
      return { ok: true, amount, cash: portfolio.cash };
    },
    async postOrder() {
      const order = {
        id: 1,
        symbol: "FAKE",
        side: "BUY",
        type: "limit",
        quantity: 2,
        price: 95,
        status: "open",
        created_at: 1787529600,
      };
      portfolio.openOrders = [order];
      return { ok: true, order };
    },
    async fetchOrders() {
      return { ok: true, orders: portfolio.openOrders };
    },
    async cancelOrder() {
      const [open] = portfolio.openOrders;
      portfolio.openOrders = [];
      return {
        ok: true,
        order: { ...open, status: "cancelled" },
      };
    },
    ...overrides,
  };
  return client;
}

test("getPortfolioSummary relays the precomputed cloud account", async () => {
  const service = createAccountService({ client: stubClient(), now: () => 0 });
  const summary = await service.getPortfolioSummary({ force: true });

  // The full 9-field account object is preserved for finalize()/transfer().
  assert.equal(summary.account.cashAvailable, 10000);
  assert.equal(summary.account.totalEquity, 10000);
  assert.equal(summary.account.cashTransferred, 0);
  assert.equal(summary.account.holdings, 0);
  // Only `{ account }` is relayed — the cloud envelope stays server-side.
  assert.equal(summary.ok, undefined);
  assert.equal(summary.generatedAt, undefined);
  assert.equal(summary.transactions, undefined);
  // Quote/price data is no longer part of the summary shape.
  assert.equal(summary.price, undefined);
  assert.equal(summary.symbol, undefined);
  assert.equal(summary.history, undefined);
  assert.equal(summary.orders, undefined);
});

test("init primes the cache from the cloud", async () => {
  const previousApi = process.env.TRADING_API_BASE_URL;
  const previousCdn = process.env.TRADING_CDN_BASE_URL;
  process.env.TRADING_API_BASE_URL = "https://api.example.com";
  process.env.TRADING_CDN_BASE_URL = "https://edge.example.com";
  try {
    const service = createAccountService({
      client: stubClient(),
      now: () => 0,
    });
    const summary = await service.init();
    assert.equal(summary.account.cashAvailable, 10000);
    assert.equal(service.getCachedQuote().price, 100);
  } finally {
    if (previousApi === undefined) delete process.env.TRADING_API_BASE_URL;
    else process.env.TRADING_API_BASE_URL = previousApi;
    if (previousCdn === undefined) delete process.env.TRADING_CDN_BASE_URL;
    else process.env.TRADING_CDN_BASE_URL = previousCdn;
  }
});

test("buy returns the post-trade portfolio result shape", async () => {
  const service = createAccountService({ client: stubClient(), now: () => 0 });
  const result = await service.buy(5);

  assert.equal(result.kind, "buy");
  assert.equal(result.quantity, 5); // traded quantity
  assert.equal(result.holdings, 5); // post-trade position
  assert.equal(result.price, 100);
  assert.equal(result.cashAvailable, 9500);
  assert.equal(result.costBasis, 500);
  assert.equal(result.totalEquity, 10000);
});

test("sell returns realized gains and a zeroed position", async () => {
  const client = stubClient();
  await client.postTrade({ side: "BUY", quantity: 5 });
  const service = createAccountService({ client, now: () => 0 });
  const result = await service.sell(5);

  assert.equal(result.kind, "sell");
  assert.equal(result.quantity, 5);
  assert.equal(result.holdings, 0);
  assert.equal(result.cashAvailable, 10000);
  assert.ok("realizedGains" in result);
});

test("transfer returns the deposit/withdrawal shape", async () => {
  const service = createAccountService({ client: stubClient(), now: () => 0 });
  const deposit = await service.transfer(2500);
  assert.equal(deposit.transferType, "deposit");
  assert.equal(deposit.amount, 2500);
  assert.equal(deposit.cashAvailable, 12500);
  assert.equal(deposit.cashTransferred, 2500);

  const withdrawal = await service.transfer(-500);
  assert.equal(withdrawal.transferType, "withdrawal");
  assert.equal(withdrawal.amount, 500);
  assert.equal(withdrawal.cashAvailable, 12000);
});

test("placeOrder maps the cloud order into the client order shape", async () => {
  const service = createAccountService({ client: stubClient(), now: () => 0 });
  const order = await service.placeOrder({
    type: "limit",
    side: "buy",
    quantity: 2,
    price: 95,
  });
  assert.equal(order.id, "1");
  assert.equal(order.type, "limit");
  assert.equal(order.kind, "buy");
  assert.equal(order.quantity, 2);
  assert.equal(order.price, 95);
  assert.equal(order.status, "open");
  assert.equal(order.createdAt, 1787529600 * 1000);
});

test("cancelOrder and listOrders delegate to the cloud", async () => {
  const service = createAccountService({ client: stubClient(), now: () => 0 });
  await service.placeOrder({
    type: "limit",
    side: "buy",
    quantity: 2,
    price: 95,
  });
  const orders = await service.listOrders();
  assert.equal(orders.orders.length, 1);

  const cancelled = await service.cancelOrder("1");
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await service.listOrders()).orders.length, 0);
});

test("getLedgerTransactions returns the raw cloud rows for the server relay", async () => {
  const client = stubClient();
  const service = createAccountService({ client, now: () => 0 });

  await client.postTrade({ side: "BUY", quantity: 5 });
  await client.postTransfer({ amount: 2500 });

  const rows = await service.getLedgerTransactions({ force: true });
  assert.equal(rows.length, 2);

  const trade = rows.find((row) => row.table === "trade");
  assert.equal(trade.id, 1);
  assert.equal(trade.side, "BUY"); // raw cloud casing — not mapped yet
  assert.equal(trade.quantity, 5);
  assert.equal(trade.price, 100);

  const transfer = rows.find((row) => row.table === "transfer");
  assert.equal(transfer.id, 1);
  assert.equal(transfer.amount, 2500);
  assert.equal(transfer.side, undefined); // no null-padded transfer columns
  assert.equal("kind" in trade, false); // rows pass through unmodified
});

test("getTransactions merges trades, transfers, and open orders into one feed", async () => {
  const client = stubClient();
  const service = createAccountService({ client, now: () => 0 });

  // No activity yet.
  assert.deepEqual(await service.getTransactions({ force: true }), []);

  // Add a trade, a deposit, and an open limit order to the stub portfolio.
  await client.postTrade({ side: "BUY", quantity: 5 });
  await client.postTransfer({ amount: 2500 });
  await service.placeOrder({
    type: "limit",
    side: "buy",
    quantity: 2,
    price: 95,
  });

  const transactions = await service.getTransactions({ force: true });
  assert.equal(transactions.length, 3);

  const trade = transactions.find((entry) => entry.id === "trade-1");
  assert.equal(trade.kind, "buy");
  assert.equal(trade.side, "buy");
  assert.equal(trade.quantity, 5);
  assert.equal(trade.price, 100);
  assert.equal(trade.amount, 500);
  assert.equal(trade.timestamp, 1787529630 * 1000);

  const transfer = transactions.find((entry) => entry.id === "transfer-1");
  assert.equal(transfer.kind, "deposit");
  assert.equal(transfer.amount, 2500);
  assert.equal(transfer.timestamp, 1787529630 * 1000);

  const order = transactions.find((entry) => entry.id === "order-1");
  assert.equal(order.kind, "limit");
  assert.equal(order.side, "buy");
  assert.equal(order.quantity, 2);
  assert.equal(order.price, 95);
  assert.equal(order.amount, 190);
  assert.equal(order.status, "open");
  assert.equal(order.timestamp, 1787529600 * 1000);
});
