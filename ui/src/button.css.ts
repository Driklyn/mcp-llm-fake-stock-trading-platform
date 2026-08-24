import { style } from "@vanilla-extract/css";
import { radii, space } from "./sprinkles.css.ts";

export const button = style({
  borderRadius: radii.sm,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  paddingRight: space.md,
  appearance: "none",
  border: "none",
  cursor: "pointer",
  fontWeight: 700,
  background: "linear-gradient(135deg, #2db978, #1aaf76)",
  color: "white",
});

export const secondary = style({
  background: "linear-gradient(135deg, #4d6b94, #3a5f8a)",
});

export const disabled = style({
  opacity: 0.6,
  cursor: "not-allowed",
});
