import React from "react";
import * as styles from "./appShell.css.ts";

export type LayoutProps = React.HTMLAttributes<HTMLElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function Layout({ children, className, ...props }: LayoutProps) {
  return (
    <main
      className={`${styles.layout}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </main>
  );
}
