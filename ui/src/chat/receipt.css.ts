import { style } from "@vanilla-extract/css";
import { colors, fontSizes, space } from "../sprinkles.css.ts";

export const receipt = style({
  display: "flex",
  flexDirection: "column",
  gap: space.xs,
});

export const row = style({
  fontSize: fontSizes.lg,
  color: colors.textStrong,
});

export const note = style({
  marginTop: space.xs,
  fontSize: fontSizes.base,
  color: colors.textMuted,
});
