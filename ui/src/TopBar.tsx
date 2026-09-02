import React from "react";
import * as styles from "./topBar.css.ts";

export type TopBarProps = React.HTMLAttributes<HTMLElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function TopBar({ children, className, ...props }: TopBarProps) {
  return (
    <header
      className={`${styles.topBar}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </header>
  );
}
