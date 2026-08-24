import React from "react";
import * as styles from "./appShell.css.ts";

export type AppShellProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function AppShell({
  children,
  className,
  ...props
}: AppShellProps) {
  return (
    <div
      className={`${styles.shell}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </div>
  );
}
