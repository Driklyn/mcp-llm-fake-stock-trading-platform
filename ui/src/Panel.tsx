import React from "react";
import * as styles from "./panel.css.ts";

export type PanelProps = React.HTMLAttributes<HTMLElement> & {
  children?: React.ReactNode;
  wide?: boolean;
  as?: "section" | "aside" | "div" | "article" | "main";
  className?: string;
};

export default function Panel({
  children,
  wide,
  as = "section",
  className,
  ...props
}: PanelProps) {
  const Tag = as;
  const cls = [styles.panel, wide ? styles.wide : null]
    .filter(Boolean)
    .join(" ");
  return (
    <Tag className={`${cls}${className ? " " + className : ""}`} {...props}>
      {children}
    </Tag>
  );
}
