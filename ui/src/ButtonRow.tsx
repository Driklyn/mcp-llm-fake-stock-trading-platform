import React from "react";
import * as styles from "./buttonRow.css.ts";

export type ButtonRowProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function ButtonRow({
  children,
  className,
  ...props
}: ButtonRowProps) {
  return (
    <div
      className={`${styles.buttonRow}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
