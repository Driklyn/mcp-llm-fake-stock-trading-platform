import React from "react";
import * as styles from "./input.css.ts";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export default function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={`${styles.input}${className ? " " + className : ""}`}
      {...props}
    />
  );
}
