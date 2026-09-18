import { style } from "@vanilla-extract/css";
import {
  borderWidths,
  colors,
  fontSizes,
  fontWeights,
  fonts,
  lineHeights,
  radii,
  space,
} from "ui";

export const githubLink = style({
  display: "inline-flex",
  alignItems: "center",
  gap: space.sm,
  textDecoration: "none",
  whiteSpace: "nowrap",
  fontFamily: fonts.body,
  fontSize: fontSizes.base,
  fontWeight: fontWeights.bold,
  lineHeight: lineHeights.none,
  color: colors.textMuted,
  background: colors.surfaceInsetSoft,
  border: `${borderWidths.thin}px solid ${colors.border}`,
  borderRadius: radii.full,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  paddingRight: space.md,
  transition:
    "color 0.15s ease, border-color 0.15s ease, background 0.15s ease",

  ":hover": {
    color: colors.text,
    background: colors.surfaceCard,
  },
});

export const githubIcon = style({
  width: 16,
  height: 16,
  flexShrink: 0,
  fill: "currentColor",
});
