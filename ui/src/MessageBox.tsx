import React from "react";
import * as styles from "./messageBox.css.ts";

export type MessageBoxProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function MessageBox({
  children,
  className,
  ...props
}: MessageBoxProps) {
  return (
    <div
      className={`${styles.messageBox}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
