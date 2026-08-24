import React from "react";
import * as styles from "./chatBubble.css.ts";

export type ChatBubbleVariant = "user" | "assistant";

export type ChatBubbleProps = React.HTMLAttributes<HTMLDivElement> & {
  role?: ChatBubbleVariant;
  children?: React.ReactNode;
  className?: string;
};

export default function ChatBubble({
  role = "assistant",
  children,
  className,
  ...props
}: ChatBubbleProps) {
  const cls = [styles.bubble, role === "user" ? styles.user : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={`${cls}${className ? " " + className : ""}`} {...props}>
      {children}
    </div>
  );
}
