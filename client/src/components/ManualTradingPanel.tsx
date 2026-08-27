import { useState } from "react";
import { Button, ButtonRow, Field, Input, MessageBox, PriceInput } from "ui";
import type { OrderType, TradeSide, TransferDirection } from "../types";

/**
 * Transport-agnostic manual trading controls.
 *
 * The parent wires the executor callbacks to either the WebSocket (proxy mode,
 * dev server) or the CloudFront REST API (direct mode, GitHub Pages).
 */
export type ManualTradingPanelProps = {
  message: string;
  onMessageChange: (value: string) => void;
  onTrade: (side: TradeSide, quantity: number) => Promise<void>;
  onPlaceOrder: (
    orderType: OrderType,
    side: TradeSide,
    quantity: number,
    price: number,
  ) => Promise<void>;
  onTransfer: (direction: TransferDirection, amount: number) => Promise<void>;
};

export default function ManualTradingPanel({
  message,
  onMessageChange,
  onTrade,
  onPlaceOrder,
  onTransfer,
}: ManualTradingPanelProps) {
  const [quantity, setQuantity] = useState(1);
  const [orderPrice, setOrderPrice] = useState(0);
  const [transferAmount, setTransferAmount] = useState(0);

  const sendTrade = async (side: TradeSide) => {
    onMessageChange(`Submitting ${side} order for ${quantity} shares...`);
    await onTrade(side, quantity);
  };

  const sendOrder = async (orderType: OrderType, side: TradeSide) => {
    const price = Number(orderPrice);
    if (!Number.isFinite(price) || price <= 0) {
      onMessageChange("Enter a limit/stop price greater than $0.");
      return;
    }

    onMessageChange(
      `Placing ${orderType} ${side} order for ${quantity} shares at $${price.toFixed(2)}...`,
    );
    await onPlaceOrder(orderType, side, quantity, price);
  };

  const sendTransfer = async (direction: TransferDirection) => {
    const amount = Math.abs(transferAmount);
    onMessageChange(
      `${direction === "deposit" ? "Deposit" : "Withdrawal"} in progress...`,
    );
    await onTransfer(direction, amount);
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
