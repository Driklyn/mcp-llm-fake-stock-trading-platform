import { style } from "@vanilla-extract/css";
import { colors, fontSizes, space } from "../sprinkles.css.ts";

export const chatHeader = style({});

export const hint = style({
  display: "block",
  marginBottom: space.md,
  color: colors.textMuted,
  fontSize: fontSizes.md,
});
