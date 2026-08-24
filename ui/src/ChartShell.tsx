import React from "react";
import * as styles from "./chartShell.css.ts";

export type ChartShellProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function ChartShell({
  children,
  className,
  ...props
}: ChartShellProps) {
  return (
    <div
      className={`${styles.shell}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
