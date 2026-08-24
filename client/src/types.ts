import type { Transaction } from "ui";

export type Account = {
  cashAvailable: number;
  investedValue: number;
  costBasis: number;
  realizedGains: number;
  unrealizedGains: number;
  totalGainsLosses: number;
  holdings: number;
  totalEquity: number;
  cashTransferred: number;
};

export type RawChartPoint = {
  value?: number;
  price?: number;
  timestamp?: number;
  time?: number;
};

export type ChartInputPoint = number | RawChartPoint;

export type MarketSnapshot = {
  price: number;
  account: Account;
  history: ChartInputPoint[];
  orders: unknown[];
  transactions?: Transaction[];
};

export type AssistantPayload = {
  message?: string;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationId?: string;
  executedAmount?: number;
  quantity?: number;
  pricePerShare?: number;
  remainder?: number;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  payload?: AssistantPayload | null;
};

export type SocketMessage = {
  type: string;
  success?: boolean;
  payload?: AssistantPayload;
  error?: string;
};

export type AssistantResponse = {
  text?: string;
  error?: string;
  payload?: AssistantPayload;
};

export type TradeSide = "buy" | "sell";
export type OrderType = "limit" | "stop";
export type TransferDirection = "deposit" | "withdraw";
