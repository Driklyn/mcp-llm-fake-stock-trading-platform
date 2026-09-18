import { style } from "@vanilla-extract/css";
import { colors, radii, space } from "./sprinkles.css.ts";

export const shell = style({
  display: "block",
  borderRadius: radii.md,
  position: "relative",
  width: space.full,
  minHeight: 220,
  height: space.full,
  flex: "1 1 auto",
  background: colors.chartGradient,
  overflow: "hidden",

  "@media": {
    "(max-width: 1023px)": {
      minHeight: 220,
      height: "min(48vh, 340px)",
    },
  },
});
