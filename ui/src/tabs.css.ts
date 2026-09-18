import { style } from "@vanilla-extract/css";
import {
  backgrounds,
  colors,
  fontSizes,
  fontWeights,
  radii,
  space,
} from "./sprinkles.css.ts";

export const root = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: space.none,
  height: space.full,
});

export const tabList = style({
  display: "flex",
  gap: space.sm,
  marginBottom: space.lg,
  paddingBottom: space.sm,
  borderBottom: `1px solid ${colors.border}`,
});

export const tab = style({
  borderRadius: radii.sm,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  paddingRight: space.md,
  flex: 1,
  appearance: "none",
  border: `1px solid ${colors.border}`,
  cursor: "pointer",
  fontWeight: fontWeights.bold,
  fontSize: fontSizes.lg,
  background: colors.surfaceInsetSoft,
  color: colors.textMuted,
  transition:
    "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",

  ":hover": {
    background: colors.surfaceCard,
    color: colors.text,
  },
});

export const active = style({
  background: colors.gradientPrimary,
  borderColor: backgrounds.transparent,
  color: colors.textOnPrimary,

  ":hover": {
    background: colors.gradientPrimary,
    color: colors.textOnPrimary,
  },
});

export const tabContent = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: space.none,
  height: space.full,
  overflow: "auto",
});

export const hidden = style({
  display: "none",
});
