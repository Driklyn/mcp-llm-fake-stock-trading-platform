import { style } from "@vanilla-extract/css";
import { radii, space } from "./sprinkles.css.ts";

export const panel = style({
  borderRadius: radii.lg,
  padding: space.lg,
  background: "rgba(11, 19, 27, 0.8)",
  border: "1px solid rgba(149, 170, 200, 0.2)",
  boxShadow: "0 18px 40px rgba(0, 0, 0, 0.15)",
  minHeight: 420,
});

export const wide = style({
  display: "flex",
  flexDirection: "column",
  minHeight: 520,
  alignSelf: "stretch",
  flex: "1 1 auto",
});
