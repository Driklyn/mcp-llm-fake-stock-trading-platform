import { style } from "@vanilla-extract/css";
import {
  colors,
  fontWeights,
  opacity,
  radii,
  space,
} from "./sprinkles.css.ts";

export const button = style({
  borderRadius: radii.sm,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  paddingRight: space.md,
  appearance: "none",
  border: "none",
  cursor: "pointer",
  fontWeight: fontWeights.bold,
  background: colors.gradientPrimary,
  color: colors.textOnPrimary,
});

export const secondary = style({
  background: colors.gradientSecondary,
});

export const disabled = style({
  opacity: opacity.disabled,
  cursor: "not-allowed",
});
