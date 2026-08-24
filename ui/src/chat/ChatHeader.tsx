import React from "react";
import * as styles from "./chatHeader.css.ts";

export type ChatHeaderProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  className?: string;
};

const assistantHint = [
  "Check my portfolio",
  "Buy 2 shares",
  "Sell 1 share",
  "Deposit $500",
  "Place a limit buy of 3 at $95",
].join(" • ");

export default function ChatHeader({
  children,
  className,
  ...props
}: ChatHeaderProps) {
  return (
    <div
      className={`${styles.chatHeader}${className ? " " + className : ""}`}
      {...props}
    >
      <span className={styles.hint}>Try: {assistantHint}</span>
      {children}
    </div>
  );
}
