import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";

export const eyebrow = style({
  margin: space.none,
  color: "#9ab4d6",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: 11,
});
