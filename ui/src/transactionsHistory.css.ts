import { style } from "@vanilla-extract/css";
import {
  backgrounds,
  borderWidths,
  colors,
  fontSizes,
  fontWeights,
  radii,
  space,
} from "./sprinkles.css.ts";

export const section = style({
  marginTop: space.xl,
  padding: space.lg,
  borderRadius: radii.md,
  background: colors.surfaceCard,
});

export const title = style({
  marginBottom: space.md,
  marginTop: space.none,
  fontSize: fontSizes.xl,
});

export const filters = style({
  display: "flex",
  flexWrap: "wrap",
  gap: space.md,
  marginBottom: space.lg,
  alignItems: "center",
});

export const filterGroup = style({
  display: "flex",
  alignItems: "center",
  gap: space.xs,
  flexWrap: "wrap",
});

export const filterLabel = style({
  color: colors.textMuted,
  fontSize: fontSizes.sm,
  fontWeight: fontWeights.semibold,
});

export const chip = style({
  paddingLeft: space.sm,
  paddingRight: space.sm,
  paddingTop: space.xs,
  paddingBottom: space.xs,
  borderRadius: radii.full,
  border: `${borderWidths.thin}px solid ${colors.borderStrong}`,
  background: backgrounds.transparent,
  color: colors.text,
  cursor: "pointer",
  fontSize: fontSizes.sm,
  fontWeight: fontWeights.semibold,
  ":hover": {
    borderColor: colors.borderAccentSoft,
    color: colors.textStrong,
  },
});

export const chipActive = style({
  background: colors.chipActiveBackground,
  borderColor: colors.borderAccent,
  color: colors.textStrong,
});

export const priceInputs = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: space.xs,
});

export const priceInput = style({
  paddingLeft: space.sm,
  paddingRight: space.sm,
  paddingTop: space.xs,
  paddingBottom: space.xs,
  borderRadius: radii.sm,
  width: 84,
  border: `${borderWidths.thin}px solid ${colors.borderStrong}`,
  background: colors.surfaceOverlay,
  color: colors.textStrong,
  fontSize: fontSizes.md,
  ":focus": {
    outline: "none",
    borderColor: colors.borderAccent,
  },
});

export const tableWrapper = style({
  overflowX: "auto",
});

export const positive = style({
  color: colors.positive,
  fontWeight: fontWeights.bold,
});

export const negative = style({
  color: colors.negative,
  fontWeight: fontWeights.bold,
});

export const statusOpen = style({
  color: colors.warning,
});

export const statusCompleted = style({
  color: colors.positive,
});

export const statusCancelled = style({
  color: colors.neutral,
});

export const statusFailed = style({
  color: colors.negative,
});

export const muted = style({
  color: colors.textFaint,
});
