import { style } from "@vanilla-extract/css";
import {
  borderWidths,
  colors,
  radii,
  shadows,
  space,
} from "./sprinkles.css.ts";

export const panel = style({
  display: "flex",
  flexDirection: "column",
  borderRadius: radii.lg,
  padding: space.lg,
  background: colors.surfacePanel,
  border: `${borderWidths.thin}px solid ${colors.border}`,
  boxShadow: shadows.panel,
  minHeight: 420,
  height: space.full,
  minWidth: space.none,
  overflow: "hidden",
});

export const wide = style({
  display: "flex",
  flexDirection: "column",
  minHeight: 520,
  alignSelf: "stretch",
  flex: "1 1 auto",
  height: space.full,
  minWidth: space.none,
  overflow: "hidden",
});
