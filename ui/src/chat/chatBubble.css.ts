import { style } from "@vanilla-extract/css";
import { radii, space } from "../sprinkles.css.ts";

export const bubble = style({
  borderRadius: radii.md,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  paddingRight: space.md,
  maxWidth: "85%",
  lineHeight: 1.4,
  background: "rgba(74, 108, 154, 0.18)",
  border: "1px solid rgba(149, 170, 200, 0.2)",
  alignSelf: "flex-start",
});

export const user = style({
  alignSelf: "flex-end",
  background: "rgba(45, 185, 120, 0.18)",
  border: "1px solid rgba(45, 185, 120, 0.3)",
});
