import React from "react";
import * as styles from "./statsGrid.css.ts";

export type StatsGridProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function StatsGrid({
  children,
  className,
  ...props
}: StatsGridProps) {
  return (
    <div
      className={`${styles.grid}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
