import { useEffect, useRef, useState } from "react";
import {
  AppShell,
  Layout,
  Panel,
  Stat,
  StatsGrid,
  Tabs,
  TransactionsHistory,
  type Transaction,
} from "ui";
import ChatPanel from "./components/ChatPanel";
import ManualTradingPanel from "./components/ManualTradingPanel";
import MarketChart from "./components/MarketChart";
import PortfolioPanel from "./components/PortfolioPanel";
import TopBar from "./components/TopBar";
import type {
  Account,
  AssistantPayload,
  ChartInputPoint,
  ChatMessage,
  OrderType,
  SocketMessage,
  TradeSide,
  TransferDirection,
} from "./types";
import {
  BLOCK_SECONDS,
  DEFAULT_PARAMS,
  buildPriceSeries,
  getPriceAtTime,
  latestRealizedTick,
} from "./utils/marketPrice";
import { assistantUrl, isDirectMode, wsUrl } from "./config";
import {
  fetchLatestTick,
  fetchPortfolio,
  fetchTicks4h,
  fetchTransactions,
  placeOrder as cloudPlaceOrder,
  postTrade,
  postTransfer,
  type CloudPortfolioResponse,
  type CloudTicks,
  type CloudTransaction,
} from "./api/cloud";
import {
  mapCloudTransactions,
  mergeCloudTicks,
  ticksToChartPoints,
} from "./api/account";

type TradeResultPayload = AssistantPayload & {
  executedAmount?: number;
  quantity?: number;
  pricePerShare?: number;
  remainder?: number;
};

function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [chartPoints, setChartPoints] = useState<ChartInputPoint[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [refreshSeconds, setRefreshSeconds] = useState(15);
  const [message, setMessage] = useState("Connected to market");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "I can check your portfolio, quote FAKE, place buys/sells, limit and stop orders, and transfer cash.",
    },
  ]);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<AssistantPayload | null>(null);
  const [isChatWorking, setIsChatWorking] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  // Retained 4h tick window in both modes. Proxy-mode WS `tick` messages and
  // direct-mode polling both append fresh ticks via mergeCloudTicks instead of
  // replacing the whole window.
  const ticksRef = useRef<CloudTicks | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
      setRefreshSeconds((previous) => (previous > 1 ? previous - 1 : 15));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const CHART_WINDOW_BLOCKS = 960; // 4 hours of 15-second blocks

  // Deterministic local fallback for the market feed — used only when the
  // ticks/price API calls fail. Produces the same series the server would.
  const marketFallback = (nowMs: number) => {
    const nowSeconds = nowMs / 1000;
    return {
      price: getPriceAtTime(nowSeconds, DEFAULT_PARAMS),
      history: buildPriceSeries(
        nowSeconds - CHART_WINDOW_BLOCKS * BLOCK_SECONDS,
        nowSeconds,
        DEFAULT_PARAMS,
      ),
    };
  };

  // Direct-mode helpers: deterministic local fallbacks when the cloud ticks
  // endpoints are unreachable, plus the shared merge-then-render pipeline.
  const localFallback4h = (nowSeconds: number): CloudTicks => {
    const endBlock = Math.floor(nowSeconds / BLOCK_SECONDS) * BLOCK_SECONDS;
    const points = buildPriceSeries(
      endBlock - CHART_WINDOW_BLOCKS * BLOCK_SECONDS,
      endBlock,
      DEFAULT_PARAMS,
    ).map((point) => ({
      timestamp: Math.floor(point.timestamp / 1000),
      price: point.price,
    }));
    return {
      symbol: "FAKE",
      generatedAt: nowSeconds,
      from:
        points[0]?.timestamp ?? endBlock - CHART_WINDOW_BLOCKS * BLOCK_SECONDS,
      to: points[points.length - 1]?.timestamp ?? endBlock,
      count: points.length,
      points,
    };
  };

  const localFallbackLatest = (nowSeconds: number): CloudTicks => {
    const point = latestRealizedTick(nowSeconds, DEFAULT_PARAMS);
    return {
      symbol: "FAKE",
      generatedAt: nowSeconds,
      from: point.timestamp,
      to: point.timestamp,
      count: 1,
      points: [point],
    };
  };

  // Render a merged CloudTicks window: chart points for MarketChart plus the
  // latest point as the current price.
  const renderMarket = (mergedTicks: CloudTicks) => {
    ticksRef.current = mergedTicks;
    setChartPoints(ticksToChartPoints(mergedTicks));
    const points = Array.isArray(mergedTicks.points) ? mergedTicks.points : [];
    const last = points[points.length - 1] ?? null;
    setPrice(last != null ? Number(last.price) : null);
    setRefreshSeconds(15);
  };

  // Render the precomputed account summary plus the raw ledger rows mapped once
  // here (the client does ALL CloudTransaction → Transaction mapping in
  // account.ts, shared by direct and proxy mode).
  const renderAccount = (
    portfolio: CloudPortfolioResponse,
    transactions: CloudTransaction[],
  ) => {
    setAccount(portfolio.account);
    setTransactions(mapCloudTransactions(transactions));
    setRefreshSeconds(15);
  };

  // Direct mode pulls both feeds itself: the precomputed account portfolio plus
  // the raw consolidated ledger feed. A failing transactions feed falls back to
  // [] so the account still renders (mirrors proxy mode's Promise.allSettled
  // philosophy).
  const fetchDirectAccount = async (signal?: AbortSignal) => {
    const [portfolio, transactionsResult] = await Promise.all([
      fetchPortfolio(signal),
      fetchTransactions(signal).catch(() => ({ ok: true, transactions: [] })),
    ]);

    return {
      portfolio,
      transactions: Array.isArray(transactionsResult.transactions)
        ? transactionsResult.transactions
        : [],
    };
  };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    if (isDirectMode) {
      // Direct mode (client-only / GitHub Pages): poll the CloudFront ledger
      // and merge fresh ticks into the retained 4h window. There is no
      // WebSocket through the CloudFront HTTP distribution.
      const refreshDirect = async () => {
        try {
          const { portfolio, transactions } =
            await fetchDirectAccount(signal);
          let incoming: CloudTicks;
          try {
            incoming = await fetchLatestTick(signal);
          } catch {
            incoming = localFallbackLatest(Math.floor(Date.now() / 1000));
          }
          if (!cancelled) {
            renderAccount(portfolio, transactions);
            renderMarket(mergeCloudTicks(ticksRef.current, incoming));
          }
        } catch (error) {
          if (!cancelled) setMessage("Market connection is reconnecting...");
        }
      };

      const loadInitial = async () => {
        try {
          const { portfolio, transactions } =
            await fetchDirectAccount(signal);
          let incoming: CloudTicks;
          try {
            incoming = await fetchTicks4h(signal);
          } catch {
            incoming = localFallback4h(Math.floor(Date.now() / 1000));
          }
          if (!cancelled) {
            renderAccount(portfolio, transactions);
            renderMarket(mergeCloudTicks(ticksRef.current, incoming));
          }
        } catch (error) {
          if (!cancelled) setMessage("Market connection is reconnecting...");
        }
      };

      loadInitial();
      const pollId = setInterval(refreshDirect, 15_000);
      return () => {
        cancelled = true;
        controller.abort();
        clearInterval(pollId);
      };
    }

    // Proxy mode: load account, transactions, and the market feed
    // independently so one failing feed can't take down the others (an account
    // failure keeps the loading branch; a market failure falls back to the
    // deterministic engine). Ticks come from the Node server's /api/ticks/*
    // passthrough.
    const loadInitialState = async () => {
      const [portfolioResult, transactionsResult, ticks4hResult, latestResult] =
        await Promise.allSettled([
          fetchPortfolio(signal),
          fetchTransactions(signal),
          fetchTicks4h(signal),
          fetchLatestTick(signal),
        ]);
      if (cancelled) return;

      if (portfolioResult.status === "fulfilled") {
        setAccount(portfolioResult.value.account);
      } else {
        setMessage("Market connection is reconnecting...");
      }
      if (transactionsResult.status === "fulfilled") {
        // The /api/transactions relay ships raw ledger rows, same as direct
        // mode's /api/v1/transactions/50 — map them with the shared mapper.
        setTransactions(
          mapCloudTransactions(transactionsResult.value.transactions),
        );
      }
      if (ticks4hResult.status === "fulfilled") {
        if (latestResult.status === "fulfilled") {
          renderMarket(
            mergeCloudTicks(ticks4hResult.value, latestResult.value),
          );
        } else {
          renderMarket(ticks4hResult.value);
        }
      } else if (latestResult.status === "fulfilled") {
        renderMarket(latestResult.value);
      } else {
        const fallback = marketFallback(Date.now());
        setChartPoints(fallback.history);
        setPrice(fallback.price);
      }
      setRefreshSeconds(15);
    };

    loadInitialState();

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onmessage = (event) => {
      const data: SocketMessage = JSON.parse(event.data);

      if (data.type === "account") {
        const payload = data.payload as unknown as { account?: Account };
        if (payload?.account) {
          setAccount(payload.account);
          setRefreshSeconds(15);
        }
      }

      if (data.type === "transactions") {
        // The WS broadcast relays the raw ledger rows (same Cloud shape as
        // direct mode's /api/v1/transactions/50); map them once, here.
        const payload = data.payload as unknown as {
          transactions?: CloudTransaction[];
        };
        if (Array.isArray(payload?.transactions)) {
          setTransactions(mapCloudTransactions(payload.transactions));
        }
      }

      if (data.type === "tick") {
        const tick = data.payload as unknown as CloudTicks;
        renderMarket(mergeCloudTicks(ticksRef.current, tick));
      }

      if (data.type === "trade-result") {
        setMessage(
          data.success ? "Trade executed successfully" : "Trade failed",
        );

        const payload = data.payload as TradeResultPayload | undefined;

        // Append a structured receipt to the chat when the payload includes execution details
        if (data.success && payload && payload.executedAmount != null) {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                payload.message ?? `Executed ${payload.quantity ?? 0} shares.`,
              payload,
            },
          ]);
        } else {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                payload?.message ??
                payload?.error ??
                JSON.stringify(payload ?? data),
              payload,
            },
          ]);
        }
      }

      if (data.type === "error") {
        setMessage(data.error || "An error occurred");
      }
    };

    return () => {
      cancelled = true;
      controller.abort();
      ws.close();
    };
  }, []);

  const handleChatSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed || isChatWorking || pendingConfirmation) return;

    setIsChatWorking(true);
    const currentInput = trimmed;
    setChatMessages((previous) => [
      ...previous,
      { role: "user", content: currentInput },
    ]);
    setChatInput("");

    const text = currentInput;

    try {
      const assistantResponse = await fetch(assistantUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const assistantData: {
        text?: string;
        error?: string;
        payload?: AssistantPayload;
      } = await assistantResponse.json();
      const resultText =
        assistantData?.text ??
        "I can help with portfolio checks, price quotes, buys, sells, limit and stop orders, deposits, withdrawals, and order cancellations.";

      if (!assistantResponse.ok) {
        throw new Error(assistantData?.error ?? "Assistant unavailable");
      }

      // store pending confirmation payload when the server requests human confirmation
      const payload = assistantData.payload;
      if (payload?.requiresConfirmation) {
        setPendingConfirmation(payload);
        // also add the assistant's confirmation prompt to the chat log (include payload)
        setChatMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            content: payload.message ?? resultText,
            payload,
          },
        ]);
      } else {
        setPendingConfirmation(null);
        setChatMessages((previous) => [
          ...previous,
          {
            role: "assistant",
            content: resultText,
            payload,
          },
        ]);
      }
    } catch (error) {
      setChatMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? `I hit a problem: ${error.message}`
              : "I could not complete that request.",
        },
      ]);
    } finally {
      setIsChatWorking(false);
    }
  };

  const handleConfirm = async () => {
    if (isChatWorking) return;
    setIsChatWorking(true);
    try {
      setChatMessages((previous) => [
        ...previous,
        { role: "user", content: "confirm" },
      ]);

      const confirmationId = pendingConfirmation?.confirmationId;
      const res = await fetch(assistantUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", confirmationId }),
      });
      const data: {
        text?: string;
        payload?: AssistantPayload;
      } = await res.json();
      const text =
        data?.text ??
        data?.payload?.message ??
        (data?.payload ? JSON.stringify(data.payload) : JSON.stringify(data));
      setChatMessages((previous) => [
        ...previous,
        { role: "assistant", content: text, payload: data.payload },
      ]);
      setPendingConfirmation(null);
    } catch (err) {
      setChatMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `I hit a problem: ${(err as Error)?.message ?? err}`,
        },
      ]);
    } finally {
      setIsChatWorking(false);
    }
  };

  const handleCancelPending = async () => {
    if (isChatWorking) return;
    setIsChatWorking(true);
    try {
      const confirmationId = pendingConfirmation?.confirmationId;
      const res = await fetch(assistantUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", confirmationId }),
      });
      const data: {
        text?: string;
        payload?: AssistantPayload;
      } = await res.json();
      const text =
        data?.text ??
        data?.payload?.message ??
        (data?.payload ? JSON.stringify(data.payload) : JSON.stringify(data));
      setChatMessages((previous) => [
        ...previous,
        { role: "assistant", content: text, payload: data.payload },
      ]);
      setPendingConfirmation(null);
    } catch (err) {
      setChatMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `I hit a problem: ${(err as Error)?.message ?? err}`,
        },
      ]);
    } finally {
      setIsChatWorking(false);
    }
  };

  const refreshDirect = async () => {
    if (!isDirectMode) return;
    try {
      const { portfolio, transactions } = await fetchDirectAccount();
      let incoming: CloudTicks;
      try {
        incoming = await fetchLatestTick();
      } catch {
        incoming = localFallbackLatest(Math.floor(Date.now() / 1000));
      }
      renderAccount(portfolio, transactions);
      renderMarket(mergeCloudTicks(ticksRef.current, incoming));
    } catch {
      // Keep the last known state; the caller already surfaced the result.
    }
  };

  const handleManualTrade = async (side: TradeSide, quantity: number) => {
    const socket = socketRef.current;

    if (isDirectMode) {
      const currentPrice =
        price ?? getPriceAtTime(nowMs / 1000, DEFAULT_PARAMS);
      const tradeValue = quantity * currentPrice;
      if (
        quantity >= 10 ||
        (Number.isFinite(tradeValue) && tradeValue >= 1000)
      ) {
        const confirmed = window.confirm(
          `This ${side} order is worth $${tradeValue.toFixed(2)} at the current price. Confirm before placing it?`,
        );
        if (!confirmed) {
          setMessage("Trade cancelled.");
          return;
        }
      }
      try {
        const result = await postTrade(
          side.toUpperCase() as "BUY" | "SELL",
          quantity,
        );
        setMessage(result?.ok ? "Trade executed successfully" : "Trade failed");
        await refreshDirect();
      } catch (error) {
        setMessage((error as Error)?.message ?? "Trade failed");
      }
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setMessage("Market connection is reconnecting...");
      return;
    }
    socket.send(JSON.stringify({ type: side, quantity }));
  };

  const handleManualPlaceOrder = async (
    orderType: OrderType,
    side: TradeSide,
    quantity: number,
    price: number,
  ) => {
    const socket = socketRef.current;

    if (isDirectMode) {
      const currentPrice =
        price ?? getPriceAtTime(nowMs / 1000, DEFAULT_PARAMS);
      const tradeValue = quantity * currentPrice;
      if (
        quantity >= 10 ||
        (Number.isFinite(tradeValue) && tradeValue >= 1000)
      ) {
        const confirmed = window.confirm(
          `This ${orderType} ${side} order is worth $${tradeValue.toFixed(2)} at the current price. Confirm before placing it?`,
        );
        if (!confirmed) {
          setMessage("Order cancelled.");
          return;
        }
      }
      try {
        await cloudPlaceOrder(
          side.toUpperCase() as "BUY" | "SELL",
          orderType,
          quantity,
          price,
        );
        setMessage(
          `Placed ${orderType} ${side} order for ${quantity} shares at $${price.toFixed(2)}.`,
        );
        await refreshDirect();
      } catch (error) {
        setMessage((error as Error)?.message ?? "Failed to place order");
      }
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setMessage("Market connection is reconnecting...");
      return;
    }
    socket.send(
      JSON.stringify({ type: "place_order", orderType, side, quantity, price }),
    );
  };

  const handleManualTransfer = async (
    direction: TransferDirection,
    amount: number,
  ) => {
    const socket = socketRef.current;
    const signedAmount = direction === "deposit" ? amount : -amount;

    if (isDirectMode) {
      try {
        const result = await postTransfer(signedAmount);
        setMessage(
          result?.ok
            ? direction === "deposit"
              ? "Deposit completed"
              : "Withdrawal completed"
            : "Transfer failed",
        );
        await refreshDirect();
      } catch (error) {
        setMessage((error as Error)?.message ?? "Transfer failed");
      }
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setMessage("Market connection is reconnecting...");
      return;
    }
    socket.send(JSON.stringify({ type: "transfer", amount: signedAmount }));
  };

  const chatTabContent = (
    <ChatPanel
      messages={chatMessages}
      input={chatInput}
      isWorking={isChatWorking}
      hasPendingConfirmation={Boolean(pendingConfirmation)}
      onInputChange={setChatInput}
      onSubmit={handleChatSubmit}
      onConfirm={handleConfirm}
      onCancelPending={handleCancelPending}
    />
  );

  const manualTabContent = (
    <ManualTradingPanel
      message={message}
      onMessageChange={setMessage}
      onTrade={handleManualTrade}
      onPlaceOrder={handleManualPlaceOrder}
      onTransfer={handleManualTransfer}
    />
  );

  const tabs = [
    { id: "chat", label: "Chat", content: chatTabContent },
    { id: "manual", label: "Manual", content: manualTabContent },
  ];

  if (!account) {
    return (
      <AppShell>
        <TopBar />

        <Layout>
          <Panel wide>
            <h2>Portfolio</h2>
            <StatsGrid>
              <Stat label="Cash" value="Loading…" />
              <Stat label="Invested" value="Loading…" />
              <Stat label="Gains/Losses" value="Loading…" />
              <Stat label="Holdings" value="Loading…" />
              <Stat label="Total Equity" value="Loading…" />
            </StatsGrid>
          </Panel>

          <Panel as="aside">
            <Tabs defaultTab="chat" tabs={tabs} />
          </Panel>
        </Layout>

        <TransactionsHistory transactions={transactions} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TopBar />

      <Layout>
        <Panel wide>
          <PortfolioPanel account={account} />

          <MarketChart
            points={chartPoints}
            price={price}
            refreshSeconds={refreshSeconds}
          />
        </Panel>

        <Panel as="aside">
          <Tabs defaultTab="chat" tabs={tabs} />
        </Panel>
      </Layout>

      <TransactionsHistory transactions={transactions} />
    </AppShell>
  );
}

export default App;
