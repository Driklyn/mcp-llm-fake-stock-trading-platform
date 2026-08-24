import React from "react";
import * as styles from "./eyebrow.css.ts";

export type EyebrowProps = React.HTMLAttributes<HTMLParagraphElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function Eyebrow({
  children,
  className,
  ...props
}: EyebrowProps) {
  return (
    <p
      className={`${styles.eyebrow}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </p>
  );
}
