import { style } from "@vanilla-extract/css";
import { borderWidths, colors, radii, space } from "./sprinkles.css.ts";

export const messageBox = style({
  marginTop: space.lg,
  padding: space.md,
  borderRadius: radii.sm,
  background: colors.surfaceRaised,
  color: colors.text,
  border: `${borderWidths.thin}px solid ${colors.border}`,
});
