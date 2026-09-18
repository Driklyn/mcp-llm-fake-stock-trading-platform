import { style } from "@vanilla-extract/css";
import { colors, fontSizes, space } from "./sprinkles.css.ts";

export const field = style({
  display: "block",
  marginBottom: space.md,
  color: colors.text,
  fontSize: fontSizes.lg,
});
