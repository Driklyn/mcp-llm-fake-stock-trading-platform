import { style } from "@vanilla-extract/css";
import { colors, fontSizes, radii, space } from "./sprinkles.css.ts";

export const stat = style({
  borderRadius: radii.md,
  padding: space.md,
  background: colors.surfaceCard,
});

export const label = style({
  display: "block",
  marginBottom: space.sm,
  color: colors.textMuted,
  fontSize: fontSizes.sm,
});

export const value = style({
  fontSize: fontSizes.xl,
});
