import React from "react";
import * as styles from "./topbar.css.ts";

export type TopBarProps = React.HTMLAttributes<HTMLElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function TopBar({ children, className, ...props }: TopBarProps) {
  return (
    <header
      className={`${styles.topbar}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </header>
  );
}
