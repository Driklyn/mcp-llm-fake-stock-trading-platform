import React from "react";
import * as styles from "./button.css.ts";

export type ButtonVariant = "primary" | "secondary";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
};

export default function Button({
  children,
  variant,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const cls = [
    styles.button,
    variant === "secondary" ? styles.secondary : null,
    disabled ? styles.disabled : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      className={`${cls}${className ? " " + className : ""}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
