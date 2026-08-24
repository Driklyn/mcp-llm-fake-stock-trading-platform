import { useState, type RefObject } from "react";
import { Button, ButtonRow, Field, Input, MessageBox, PriceInput } from "ui";
import type { OrderType, TradeSide, TransferDirection } from "../types";

export type ManualTradingPanelProps = {
  message: string;
  socketRef: RefObject<WebSocket | null>;
  onMessageChange: (value: string) => void;
};

export default function ManualTradingPanel({
  message,
  socketRef,
  onMessageChange,
}: ManualTradingPanelProps) {
  const [quantity, setQuantity] = useState(1);
  const [orderPrice, setOrderPrice] = useState(0);
  const [transferAmount, setTransferAmount] = useState(0);

  const sendTrade = (type: TradeSide) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      onMessageChange("Market connection is reconnecting...");
      return;
    }

    socket.send(JSON.stringify({ type, quantity }));
    onMessageChange(`Submitting ${type} order for ${quantity} shares...`);
  };

  const sendOrder = (orderType: OrderType, side: TradeSide) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      onMessageChange("Market connection is reconnecting...");
      return;
    }

    const price = Number(orderPrice);
    if (!Number.isFinite(price) || price <= 0) {
      onMessageChange("Enter a limit/stop price greater than $0.");
      return;
    }

    socket.send(
      JSON.stringify({
        type: "place_order",
        orderType,
        side,
        quantity,
        price,
      }),
    );
    onMessageChange(
      `Placing ${orderType} ${side} order for ${quantity} shares at $${price.toFixed(2)}...`,
    );
  };

  const sendTransfer = (direction: TransferDirection) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      onMessageChange("Market connection is reconnecting...");
      return;
    }

    const amount =
      direction === "deposit"
        ? Math.abs(transferAmount)
        : -Math.abs(transferAmount);

    socket.send(JSON.stringify({ type: "transfer", amount }));
    onMessageChange(
      `${direction === "deposit" ? "Deposit" : "Withdrawal"} in progress...`,
    );
  };

  return (
    <>
      <Field label="Shares">
        <Input
          type="number"
          min="1"
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value) || 1)}
        />
      </Field>
      <ButtonRow>
        <Button type="button" onClick={() => sendTrade("buy")}>
          Buy
        </Button>
        <Button variant="secondary" onClick={() => sendTrade("sell")}>
          Sell
        </Button>
      </ButtonRow>

      <Field label="Limit/Stop Price">
        <PriceInput value={orderPrice} onValueChange={setOrderPrice} />
      </Field>

      <ButtonRow>
        <Button type="button" onClick={() => sendOrder("limit", "buy")}>
          Limit Buy
        </Button>
        <Button variant="secondary" onClick={() => sendOrder("limit", "sell")}>
          Limit Sell
        </Button>
      </ButtonRow>
      <ButtonRow>
        <Button type="button" onClick={() => sendOrder("stop", "buy")}>
          Stop Buy
        </Button>
        <Button variant="secondary" onClick={() => sendOrder("stop", "sell")}>
          Stop Sell
        </Button>
      </ButtonRow>

      <Field label="Cash Transfer">
        <PriceInput value={transferAmount} onValueChange={setTransferAmount} />
      </Field>
      <ButtonRow>
        <Button onClick={() => sendTransfer("deposit")}>Deposit</Button>
        <Button variant="secondary" onClick={() => sendTransfer("withdraw")}>
          Withdraw
        </Button>
      </ButtonRow>

      <MessageBox>{message}</MessageBox>
    </>
  );
}
