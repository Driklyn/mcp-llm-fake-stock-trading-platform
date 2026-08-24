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

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }, [children]);

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
