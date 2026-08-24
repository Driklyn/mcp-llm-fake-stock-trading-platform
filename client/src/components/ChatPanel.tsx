import type { FormEvent } from "react";
import {
  Button,
  ChatBubble,
  ChatForm,
  ChatHeader,
  ChatLog,
  Input,
  Receipt,
  ReceiptNote,
  ReceiptRow,
  sprinkles,
} from "ui";
import type { ChatMessage } from "../types";

export type ChatPanelProps = {
  messages: ChatMessage[];
  input: string;
  isWorking: boolean;
  hasPendingConfirmation: boolean;
  onInputChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onConfirm: () => void;
  onCancelPending: () => void;
};

export default function ChatPanel({
  messages,
  input,
  isWorking,
  hasPendingConfirmation,
  onInputChange,
  onSubmit,
  onConfirm,
  onCancelPending,
}: ChatPanelProps) {
  return (
    <>
      <ChatHeader />

      <ChatLog>
        {messages.map((messageItem, index) => (
          <ChatBubble
            key={`${messageItem.role}-${index}`}
            role={messageItem.role}
          >
            {messageItem.payload &&
            messageItem.payload.executedAmount != null ? (
              <Receipt>
                <ReceiptRow
                  label="Shares:"
                  value={Number(messageItem.payload.quantity ?? 0)}
                />
                <ReceiptRow
                  label="Price / share:"
                  value={`$${Number(messageItem.payload.pricePerShare ?? 0).toFixed(2)}`}
                />
                <ReceiptRow
                  label="Total:"
                  value={`$${Number(messageItem.payload.executedAmount ?? 0).toFixed(2)}`}
                />
                {Number(messageItem.payload.remainder ?? 0) > 0 ? (
                  <ReceiptRow
                    label="Remainder:"
                    value={`$${Number(messageItem.payload.remainder ?? 0).toFixed(2)}`}
                  />
                ) : null}
                {messageItem.content ? (
                  <ReceiptNote>{messageItem.content}</ReceiptNote>
                ) : null}
              </Receipt>
            ) : (
              messageItem.content
            )}
          </ChatBubble>
        ))}

        {hasPendingConfirmation ? (
          <div
            className={sprinkles({
              display: "flex",
              flexDirection: "column",
              gap: "sm",
              marginTop: "sm",
              marginBottom: "md",
            })}
          >
            <div className={sprinkles({ display: "flex", gap: "sm" })}>
              <Button onClick={onConfirm} disabled={isWorking}>
                Confirm
              </Button>
              <Button
                variant="secondary"
                onClick={onCancelPending}
                disabled={isWorking}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </ChatLog>

      <ChatForm onSubmit={onSubmit}>
        <Input
          type="text"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="Ask me to check your portfolio, buy shares, place limit/stop orders, transfer cash..."
          disabled={isWorking || hasPendingConfirmation}
        />
        <Button type="submit" disabled={isWorking || hasPendingConfirmation}>
          {isWorking ? "Working..." : "Send"}
        </Button>
      </ChatForm>
    </>
  );
}
