import { style } from "@vanilla-extract/css";
import { radii, space } from "./sprinkles.css.ts";

export const messageBox = style({
  marginTop: space.lg,
  padding: space.md,
  borderRadius: radii.sm,
  background: "rgba(32, 60, 83, 0.9)",
  color: "#dfeafc",
  border: "1px solid rgba(149, 170, 200, 0.2)",
});
