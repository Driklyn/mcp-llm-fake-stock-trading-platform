import React from "react";
import * as styles from "./chatForm.css.ts";

export type ChatFormProps = React.FormHTMLAttributes<HTMLFormElement> & {
  children?: React.ReactNode;
  className?: string;
};

export default function ChatForm({
  children,
  className,
  ...props
}: ChatFormProps) {
  return (
    <form
      className={`${styles.chatForm}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </form>
  );
}
