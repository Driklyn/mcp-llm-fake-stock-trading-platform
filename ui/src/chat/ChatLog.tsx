import React, { useLayoutEffect, useRef } from "react";
import * as styles from "./chatLog.css.ts";

export type ChatLogProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function ChatLog({
  children,
  className,
  ...props
}: ChatLogProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);

  // Scroll to the bottom only when new content is actually appended (the log
  // grows), not on every parent re-render. Keying the effect off `children` is
  // unreliable because its reference changes on every render even when no
  // message was added, which made the log snap to the bottom whenever the app
  // re-rendered on its periodic timer. For unchanged content the browser keeps
  // scrollHeight identical across renders, so nothing scrolls.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;

    if (log.scrollHeight > prevScrollHeightRef.current) {
      log.scrollTop = log.scrollHeight;
    }
    prevScrollHeightRef.current = log.scrollHeight;
  });

  return (
    <div
      ref={logRef}
      className={`${styles.chatLog}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
