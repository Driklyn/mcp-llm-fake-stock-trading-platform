import React from "react";
import * as styles from "./receipt.css.ts";

export type ReceiptRowProps = {
  label?: React.ReactNode;
  value?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export function ReceiptRow({
  label,
  value,
  children,
  className,
}: ReceiptRowProps) {
  return (
    <div className={`${styles.row}${className ? " " + className : ""}`}>
      {label != null ? <strong>{label}</strong> : null}
      {label != null && value != null ? " " : null}
      {value != null ? value : null}
      {children}
    </div>
  );
}

export type ReceiptNoteProps = {
  children?: React.ReactNode;
  className?: string;
};

export function ReceiptNote({ children, className }: ReceiptNoteProps) {
  return (
    <div className={`${styles.note}${className ? " " + className : ""}`}>
      {children}
    </div>
  );
}

export type ReceiptProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function Receipt({
  children,
  className,
  ...props
}: ReceiptProps) {
  return (
    <div
      className={`${styles.receipt}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
