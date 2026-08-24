const DEFAULT_SEED = 10000;
const DEFAULT_PRICE = 100;
const TICK_INTERVAL_MS = 15000;

export function floorToTick(timestamp = Date.now()) {
  const time = Number(timestamp);
  return Math.floor(time / TICK_INTERVAL_MS) * TICK_INTERVAL_MS;
}

export function normalizeHistoryEntries(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history.map((entry, index) => {
    if (typeof entry === "number") {
      return {
        price: Number(entry),
        timestamp: floorToTick(
          Date.now() - (history.length - index - 1) * TICK_INTERVAL_MS,
        ),
      };
    }

    if (entry && typeof entry === "object") {
      const timestamp = Number(entry.timestamp ?? entry.time ?? Date.now());
      const price = Number(entry.price ?? entry.value ?? DEFAULT_PRICE);
      return {
        price: Number.isFinite(price) ? price : DEFAULT_PRICE,
        timestamp: Number.isFinite(timestamp)
          ? floorToTick(timestamp)
          : floorToTick(),
      };
    }

    return { price: DEFAULT_PRICE, timestamp: floorToTick() };
  });
}

function updateAccountTotals(state) {
  state.account.investedValue = state.account.holdings * state.price;
  state.account.totalEquity =
    state.account.cashAvailable + state.account.investedValue;
  return state.account;
}

export function createInitialState() {
  return {
    symbol: "FAKE",
    price: DEFAULT_PRICE,
    history: [
      {
        price: DEFAULT_PRICE,
        timestamp: floorToTick(),
      },
    ],
    account: {
      cashAvailable: DEFAULT_SEED,
      holdings: 0,
      costBasis: 0,
      realizedGains: 0,
      investedValue: 0,
      totalEquity: DEFAULT_SEED,
      cashTransferred: 0,
    },
    orders: [],
    nextOrderId: 1,
    transactions: [],
    nextTransactionId: 1,
  };
}

function recordTransaction(state, entry) {
  state.transactions.push({
    id: `txn-${state.nextTransactionId++}`,
    timestamp: Date.now(),
    ...entry,
  });
}

export function getPortfolioSummary(state) {
  const history = normalizeHistoryEntries(state.history).slice(-30);
  const unrealizedGains = state.account.investedValue - state.account.costBasis;
  const totalGainsLosses = state.account.realizedGains + unrealizedGains;

  return {
    symbol: state.symbol,
    price: state.price,
    account: {
      ...state.account,
      unrealizedGains,
      totalGainsLosses,
    },
    holdings: state.account.holdings,
    cashAvailable: state.account.cashAvailable,
    investedValue: state.account.investedValue,
    costBasis: state.account.costBasis,
    totalGainsLosses,
    totalEquity: state.account.totalEquity,
    history: history.map((entry) => ({
      price: entry.price,
      timestamp: entry.timestamp,
    })),
    orders: listOrders(state).orders,
    transactions: state.transactions.map((entry) => ({ ...entry })),
  };
}

export function listTransactions(state) {
  return {
    transactions: state.transactions.map((entry) => ({ ...entry })),
  };
}

export function buyStock(state, quantity, options = {}) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be positive.");
  }

  const total = state.price * qty;
  if (state.account.cashAvailable < total) {
    throw new Error("Insufficient cash for this purchase.");
  }

  state.account.cashAvailable -= total;
  state.account.holdings += qty;
  state.account.costBasis += total;
  updateAccountTotals(state);

  recordTransaction(state, {
    kind: "buy",
    quantity: qty,
    price: options.price ?? state.price,
    amount: total,
    status: "completed",
    orderId: options.orderId,
  });

  return {
    symbol: state.symbol,
    kind: "buy",
    quantity: qty,
    price: state.price,
    holdings: state.account.holdings,
    cashAvailable: state.account.cashAvailable,
    investedValue: state.account.investedValue,
    costBasis: state.account.costBasis,
    totalEquity: state.account.totalEquity,
  };
}

export function sellStock(state, quantity, options = {}) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be positive.");
  }

  if (state.account.holdings < qty) {
    throw new Error("Not enough shares to sell.");
  }

  const proceeds = state.price * qty;
  const avgCostPerShare =
    state.account.holdings > 0
      ? state.account.costBasis / state.account.holdings
      : 0;
  const costOfSoldShares = avgCostPerShare * qty;
  state.account.costBasis = Math.max(
    0,
    state.account.costBasis - costOfSoldShares,
  );
  state.account.realizedGains += proceeds - costOfSoldShares;
  state.account.holdings -= qty;
  state.account.cashAvailable += proceeds;
  updateAccountTotals(state);

  recordTransaction(state, {
    kind: "sell",
    quantity: qty,
    price: options.price ?? state.price,
    amount: proceeds,
    status: "completed",
    orderId: options.orderId,
  });

  return {
    symbol: state.symbol,
    kind: "sell",
    quantity: qty,
    price: state.price,
    holdings: state.account.holdings,
    cashAvailable: state.account.cashAvailable,
    investedValue: state.account.investedValue,
    costBasis: state.account.costBasis,
    realizedGains: state.account.realizedGains,
    totalEquity: state.account.totalEquity,
  };
}

export function transferCash(state, amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) {
    throw new Error("Transfer amount must be a non-zero number.");
  }

  const delta = Number(value);
  if (delta < 0 && Math.abs(delta) > state.account.cashAvailable) {
    throw new Error("Withdrawal exceeds available cash.");
  }

  state.account.cashAvailable += delta;
  state.account.cashTransferred += delta;
  updateAccountTotals(state);

  const typeKey = delta >= 0 ? "deposit" : "withdrawal";
  recordTransaction(state, {
    kind: typeKey,
    amount: Math.abs(delta),
    status: "completed",
  });

  return {
    symbol: state.symbol,
    transferType: typeKey,
    amount: Math.abs(delta),
    cashAvailable: state.account.cashAvailable,
    totalEquity: state.account.totalEquity,
    cashTransferred: state.account.cashTransferred,
  };
}

export function listOrders(state) {
  return {
    orders: state.orders.map((order) => ({ ...order })),
  };
}

function shouldExecuteOpenOrder(order, currentPrice) {
  if (order.type === "limit") {
    return order.kind === "buy"
      ? currentPrice <= order.price
      : currentPrice >= order.price;
  }

  // stop
  return order.kind === "buy"
    ? currentPrice >= order.price
    : currentPrice <= order.price;
}

export function placeOrder(state, { type, side, quantity, price } = {}) {
  const typeKey = String(type ?? "").toLowerCase();
  const sideKey = String(side ?? "").toLowerCase();
  const qty = Number(quantity);
  const triggerPrice = Number(price);

  if (!["limit", "stop"].includes(typeKey)) {
    throw new Error("Order type must be 'limit' or 'stop'.");
  }
  if (!["buy", "sell"].includes(sideKey)) {
    throw new Error("Order side must be 'buy' or 'sell'.");
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error("Quantity must be at least 1 share.");
  }
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    throw new Error("Trigger price must be greater than $0.");
  }

  const order = {
    id: `ord-${state.nextOrderId++}`,
    symbol: state.symbol,
    type: typeKey,
    kind: sideKey,
    quantity: qty,
    price: triggerPrice,
    status: "open",
    createdAt: Date.now(),
  };

  state.orders.push(order);
  recordTransaction(state, {
    orderId: order.id,
    kind: typeKey,
    side: sideKey,
    quantity: qty,
    price: triggerPrice,
    amount: qty * triggerPrice,
    status: "open",
  });
  return { ...order };
}

export function cancelOrder(state, orderId) {
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found.`);
  }

  if (order.status !== "open") {
    throw new Error(
      `Order ${orderId} cannot be cancelled because it is already ${order.status}.`,
    );
  }

  order.status = "cancelled";
  recordTransaction(state, {
    orderId: order.id,
    kind: order.type,
    side: order.kind,
    quantity: order.quantity,
    price: order.price,
    amount: Number(order.quantity) * Number(order.price),
    status: "cancelled",
  });
  return {
    id: order.id,
    type: order.type,
    kind: order.kind,
    quantity: order.quantity,
    price: order.price,
    status: order.status,
  };
}

export function processOpenOrders(state) {
  const executed = [];

  for (const order of state.orders) {
    if (order.status !== "open") {
      continue;
    }

    if (!shouldExecuteOpenOrder(order, state.price)) {
      continue;
    }

    try {
      const outcome =
        order.kind === "buy"
          ? buyStock(state, order.quantity, { orderId: order.id })
          : sellStock(state, order.quantity, { orderId: order.id });
      order.status = "executed";
      order.executedAt = Date.now();
      executed.push({
        id: order.id,
        type: order.type,
        kind: order.kind,
        quantity: order.quantity,
        price: order.price,
        status: "executed",
        result: outcome,
      });
    } catch (error) {
      order.status = "failed";
      order.error = error.message;
      recordTransaction(state, {
        orderId: order.id,
        kind: order.type,
        side: order.kind,
        quantity: order.quantity,
        price: order.price,
        amount: Number(order.quantity) * Number(order.price),
        status: "failed",
      });
      executed.push({
        id: order.id,
        type: order.type,
        kind: order.kind,
        quantity: order.quantity,
        price: order.price,
        status: "failed",
        error: error.message,
      });
    }
  }

  return executed;
}

export function tickMarket(state) {
  const drift = (Math.random() - 0.5) * 25;
  const newPrice = Math.max(
    20,
    Math.min(500, Number((state.price + drift).toFixed(2))),
  );

  state.price = newPrice;
  state.history = normalizeHistoryEntries(state.history);
  state.history.push({
    price: newPrice,
    timestamp: floorToTick(),
  });
  processOpenOrders(state);
  updateAccountTotals(state);

  return newPrice;
}
