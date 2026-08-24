import React, { useEffect, useRef, useState } from "react";
import * as styles from "./priceInput.css.ts";
import Input, { type InputProps } from "./Input";

export type PriceInputProps = Omit<
  InputProps,
  "type" | "value" | "onChange"
> & {
  value: number;
  onValueChange: (value: number) => void;
};

const sanitizeDecimal = (raw: string) => {
  const match = raw.match(/^\d*(\.\d{0,2})?/);
  const cleaned = match ? match[0] : "";
  // Collapse leading zeros ("050" -> "50", "01" -> "1", "000" -> "0").
  return cleaned.replace(/^0+(?=\d)/, "");
};

export default function PriceInput({
  value,
  onValueChange,
  className,
  onFocus,
  inputMode = "decimal",
  min = "0",
  step = "0.01",
  autoComplete = "off",
  ...props
}: PriceInputProps) {
  const [text, setText] = useState(String(value));
  const lastEmitted = useRef(value);

  // Re-sync only when the parent value changes externally, without
  // clobbering intermediate text while the user is typing.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      const next = sanitizeDecimal(String(value));
      setText(next);
      lastEmitted.current = value;
    }
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitizeDecimal(event.target.value);
    setText(next);
    const parsed = Number(next) || 0;
    lastEmitted.current = parsed;
    onValueChange(parsed);
  };

  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    // Select the whole value when it represents 0, so typing replaces it
    // (pressing "1" over "0" yields "1", not "01").
    if (Number(text) === 0) {
      event.currentTarget.select();
    }
    onFocus?.(event);
  };

  return (
    <div className={styles.wrap}>
      <span className={styles.prefix} aria-hidden="true">
        $
      </span>
      <Input
        {...props}
        type="text"
        inputMode={inputMode}
        min={min}
        step={step}
        autoComplete={autoComplete}
        className={`${styles.input}${className ? " " + className : ""}`}
        value={text}
        onChange={handleChange}
        onFocus={handleFocus}
      />
    </div>
  );
}
