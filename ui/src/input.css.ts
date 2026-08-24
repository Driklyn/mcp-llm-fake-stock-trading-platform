import { style } from "@vanilla-extract/css";
import { radii, space } from "./sprinkles.css.ts";

export const input = style({
  borderRadius: radii.sm,
  marginTop: space.sm,
  paddingLeft: space.lg,
  paddingRight: space.lg,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  width: "100%",
  background: "rgba(10, 19, 27, 0.9)",
  border: "1px solid rgba(149, 170, 200, 0.2)",
  color: "#ecf4ff",
  font: "inherit",
});
