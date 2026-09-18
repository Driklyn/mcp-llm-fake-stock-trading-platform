import { style } from "@vanilla-extract/css";
import { colors, fontSizes, letterSpacings, space } from "./sprinkles.css.ts";

export const eyebrow = style({
  margin: space.none,
  color: colors.textMuted,
  textTransform: "uppercase",
  letterSpacing: letterSpacings.wide,
  fontSize: fontSizes.xs,
});
