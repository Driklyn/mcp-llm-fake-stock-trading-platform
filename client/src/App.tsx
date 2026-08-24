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
  AssistantPayload,
  ChartInputPoint,
  ChatMessage,
  MarketSnapshot,
  SocketMessage,
} from "./types";
import MarketWorker from "./workers/marketWorker.js?worker";

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
  const [chartPoints, setChartPoints] = useState<ChartInputPoint[]>([]);
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
  const workerRef = useRef<Worker | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const currentHistory = snapshot?.history ?? [];

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshSeconds((previous) => (previous > 1 ? previous - 1 : 15));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const worker = new MarketWorker();
    workerRef.current = worker;

    worker.onmessage = (
      event: MessageEvent<{ points?: ChartInputPoint[] }>,
    ) => {
      const { points } = event.data || {};
      setChartPoints(Array.isArray(points) ? points : currentHistory);
    };

    return () => worker.terminate();
  }, [currentHistory]);

  useEffect(() => {
    const normalizedHistory =
      Array.isArray(currentHistory) && currentHistory.length > 0
        ? currentHistory
        : [];

    workerRef.current?.postMessage({ points: normalizedHistory });
  }, [currentHistory]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialSnapshot = async () => {
      try {
        const response = await fetch("http://localhost:3001/api/snapshot");
        if (!response.ok) {
          throw new Error("Snapshot unavailable");
        }

        const data: { snapshot?: MarketSnapshot } = await response.json();
        const nextSnapshot = data?.snapshot ?? (data as MarketSnapshot);
        if (!cancelled && nextSnapshot) {
          setSnapshot(nextSnapshot);
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

    const ws = new WebSocket("ws://localhost:3001");
    socketRef.current = ws;

    ws.onmessage = (event) => {
      const data: SocketMessage = JSON.parse(event.data);

      if (data.type === "snapshot") {
        setSnapshot(data.payload as unknown as MarketSnapshot);
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
      const assistantResponse = await fetch(
        "http://localhost:3001/api/assistant",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        },
      );

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
      const res = await fetch("http://localhost:3001/api/assistant", {
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
      const res = await fetch("http://localhost:3001/api/assistant", {
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
      socketRef={socketRef}
      onMessageChange={setMessage}
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
            price={currentSnapshot?.price ?? null}
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
