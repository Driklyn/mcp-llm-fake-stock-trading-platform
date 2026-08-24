import React from "react";
import * as styles from "./field.css.ts";

export type FieldProps = React.LabelHTMLAttributes<HTMLLabelElement> & {
  label?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export default function Field({
  label,
  children,
  className,
  ...props
}: FieldProps) {
  return (
    <label
      className={`${styles.field}${className ? " " + className : ""}`}
      {...props}
    >
      {label}
      {children}
    </label>
  );
}
