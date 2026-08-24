import { style } from "@vanilla-extract/css";
import { radii } from "./sprinkles.css.ts";

export const shell = style({
  display: "block",
  borderRadius: radii.md,
  position: "relative",
  width: "100%",
  minHeight: 320,
  height: "auto",
  flex: "1 1 auto",
  background:
    "linear-gradient(180deg, rgba(22, 32, 44, 0.8), rgba(11, 19, 27, 0.8))",
  overflow: "hidden",
});
