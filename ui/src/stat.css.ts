import { style } from "@vanilla-extract/css";
import { radii, space } from "./sprinkles.css.ts";

export const stat = style({
  borderRadius: radii.md,
  padding: space.md,
  background: "rgba(18, 33, 49, 0.9)",
});

export const label = style({
  display: "block",
  marginBottom: space.sm,
  color: "#9ab4d6",
  fontSize: 12,
});

export const value = style({
  fontSize: "1.05rem",
});
