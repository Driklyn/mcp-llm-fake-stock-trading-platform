import React from "react";
import * as styles from "./stat.css.ts";

export type StatProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: React.ReactNode;
  value?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export default function Stat({
  label,
  value,
  children,
  className,
  ...props
}: StatProps) {
  return (
    <div
      className={`${styles.stat}${className ? " " + className : ""}`}
      {...props}
    >
      {label != null ? <span className={styles.label}>{label}</span> : null}
      {value != null ? <strong className={styles.value}>{value}</strong> : null}
      {children}
    </div>
  );
}
