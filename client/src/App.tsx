import { useEffect, useMemo, useRef, useState } from "react";
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
  AssistantPayload,
  ChatMessage,
  MarketSnapshot,
  OrderType,
  SocketMessage,
  TradeSide,
  TransferDirection,
} from "./types";
import {
  BLOCK_SECONDS,
  DEFAULT_PARAMS,
  blockForTime,
  buildPriceSeries,
  getPriceAtTime,
  latestRealizedTick,
  type MarketParams,
} from "./utils/marketPrice";
import {
  apiBaseUrl,
  assistantUrl,
  isDirectMode,
  wsUrl,
} from "./config";
import {
  fetchLatestTick,
  fetchPortfolio,
  fetchTicks4h,
  placeOrder as cloudPlaceOrder,
  postTrade,
  postTransfer,
  type CloudPortfolio,
  type CloudTicks,
} from "./api/cloud";
import {
  buildSnapshotFromCloud,
  mergeCloudTicks,
} from "./api/snapshot";

type TradeResultPayload = AssistantPayload & {
  executedAmount?: number;
  quantity?: number;
  pricePerShare?: number;
  remainder?: number;
};

function App() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [refreshSeconds, setRefreshSeconds] = useState(15);
  const [message, setMessage] = useState("Connected to market");
  const [marketParams, setMarketParams] = useState<MarketParams | null>(null);
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
  // Direct mode (GitHub Pages): accumulated 4h tick window. Refreshes append
  // fresh ticks via mergeCloudTicks instead of replacing the whole window.
  const directTicksRef = useRef<CloudTicks | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
      setRefreshSeconds((previous) => (previous > 1 ? previous - 1 : 15));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentBlock =
    marketParams == null ? null : blockForTime(nowMs / 1000);

  const livePrice = useMemo(
    () =>
      marketParams && currentBlock != null
        ? getPriceAtTime(currentBlock * BLOCK_SECONDS, marketParams)
        : null,
    [marketParams, currentBlock],
  );

  const CHART_WINDOW_BLOCKS = 960; // 4 hours of 15-second blocks

  const chartPoints = useMemo(() => {
    if (!marketParams || currentBlock == null) return [];
    const endSeconds = currentBlock * BLOCK_SECONDS;
    return buildPriceSeries(
      endSeconds - CHART_WINDOW_BLOCKS * BLOCK_SECONDS,
      endSeconds,
      marketParams,
    );
  }, [marketParams, currentBlock]);

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
      from: points[0]?.timestamp ?? endBlock - CHART_WINDOW_BLOCKS * BLOCK_SECONDS,
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

  const renderDirectSnapshot = (
    portfolio: CloudPortfolio,
    incoming: CloudTicks,
  ) => {
    const merged = mergeCloudTicks(directTicksRef.current, incoming);
    directTicksRef.current = merged;
    setSnapshot(buildSnapshotFromCloud(portfolio, merged, DEFAULT_PARAMS));
    setMarketParams(DEFAULT_PARAMS);
    setRefreshSeconds(15);
  };

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let cancelled = false;

    if (isDirectMode) {
      // Direct mode (client-only / GitHub Pages): poll the CloudFront ledger
      // and merge fresh ticks into the retained 4h window. There is no
      // WebSocket through the CloudFront HTTP distribution.
      const refreshSnapshot = async () => {
        try {
          const portfolio = await fetchPortfolio(signal);
          let incoming: CloudTicks;
          try {
            incoming = await fetchLatestTick(signal);
          } catch {
            incoming = localFallbackLatest(Math.floor(Date.now() / 1000));
          }
          if (!cancelled) renderDirectSnapshot(portfolio, incoming);
        } catch (error) {
          if (!cancelled) {
            setMessage("Market connection is reconnecting...");
            setSnapshot((previous) => previous ?? null);
          }
        }
      };

      const loadInitial = async () => {
        try {
          const portfolio = await fetchPortfolio(signal);
          let incoming: CloudTicks;
          try {
            incoming = await fetchTicks4h(signal);
          } catch {
            incoming = localFallback4h(Math.floor(Date.now() / 1000));
          }
          if (!cancelled) renderDirectSnapshot(portfolio, incoming);
        } catch (error) {
          if (!cancelled) {
            setMessage("Market connection is reconnecting...");
            setSnapshot((previous) => previous ?? null);
          }
        }
      };

      loadInitial();
      const pollId = setInterval(refreshSnapshot, 15_000);
      return () => {
        cancelled = true;
        controller.abort();
        clearInterval(pollId);
      };
    }

    const loadInitialSnapshot = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/snapshot`, { signal });
        if (!response.ok) {
          throw new Error("Snapshot unavailable");
        }

        const data: MarketSnapshot = await response.json();
        if (!cancelled && data) {
          setSnapshot(data);
          setMarketParams(data.marketParams ?? null);
          setRefreshSeconds(15);
        }
      } catch (err) {
        if (!cancelled) {
          setSnapshot(null);
          setMessage("Market connection is reconnecting...");
        }
      }
    };

    loadInitialSnapshot();

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onmessage = (event) => {
      const data: SocketMessage = JSON.parse(event.data);

      if (data.type === "snapshot") {
        const payload = data.payload as unknown as MarketSnapshot & {
          marketParams?: MarketParams;
        };
        setSnapshot(payload);
        setMarketParams((previous) => payload?.marketParams ?? previous);
        setRefreshSeconds(15);
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

  const refreshSnapshot = async () => {
    if (!isDirectMode) return;
    try {
      const portfolio = await fetchPortfolio();
      let incoming: CloudTicks;
      try {
        incoming = await fetchLatestTick();
      } catch {
        incoming = localFallbackLatest(Math.floor(Date.now() / 1000));
      }
      renderDirectSnapshot(portfolio, incoming);
    } catch {
      // Keep the last known snapshot; the caller already surfaced the result.
    }
  };

  const handleManualTrade = async (side: TradeSide, quantity: number) => {
    const socket = socketRef.current;

    if (isDirectMode) {
      const tradeValue = quantity * (livePrice ?? 0);
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
        await refreshSnapshot();
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
      const tradeValue = quantity * (livePrice ?? 0);
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
        await refreshSnapshot();
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
        await refreshSnapshot();
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

  const currentSnapshot = snapshot;
  const transactions: Transaction[] = currentSnapshot?.transactions ?? [];

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

  if (!currentSnapshot) {
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

        <TransactionsHistory transactions={[]} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TopBar />

      <Layout>
        <Panel wide>
          <PortfolioPanel snapshot={currentSnapshot} />

          <MarketChart
            points={chartPoints}
            price={livePrice}
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
