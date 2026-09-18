import { style } from "@vanilla-extract/css";
import {
  colors,
  fontSizes,
  fontWeights,
  opacity,
  space,
} from "./sprinkles.css.ts";

export const table = style({
  width: space.full,
  borderCollapse: "collapse",
  fontSize: fontSizes.base,
  color: colors.text,
});

export const headerCell = style({
  paddingLeft: space.md,
  paddingRight: space.md,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  textAlign: "left",
  borderBottom: `1px solid ${colors.borderHeader}`,
  color: colors.textMuted,
  fontWeight: fontWeights.semibold,
  whiteSpace: "nowrap",
});

export const sortableHeader = style([
  headerCell,
  {
    cursor: "pointer",
    userSelect: "none",
    ":hover": {
      color: colors.textStrong,
    },
  },
]);

export const sortIndicator = style({
  marginLeft: space.xs,
  opacity: opacity.muted,
  fontSize: fontSizes.sm,
});

export const cell = style({
  paddingLeft: space.md,
  paddingRight: space.md,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  borderBottom: `1px solid ${colors.borderSubtle}`,
});

export const row = style({
  ":hover": {
    background: colors.rowHover,
  },
});

export const emptyCell = style({
  padding: space.xl,
  textAlign: "center",
  color: colors.textFaint,
});
