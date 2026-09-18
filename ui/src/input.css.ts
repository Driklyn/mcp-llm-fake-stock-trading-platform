import { style } from "@vanilla-extract/css";
import { borderWidths, colors, radii, space } from "./sprinkles.css.ts";

export const input = style({
  borderRadius: radii.sm,
  marginTop: space.sm,
  paddingLeft: space.lg,
  paddingRight: space.lg,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  width: space.full,
  background: colors.surfaceInset,
  border: `${borderWidths.thin}px solid ${colors.border}`,
  color: colors.textStrong,
  font: "inherit",
});
