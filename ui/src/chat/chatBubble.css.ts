import { style } from "@vanilla-extract/css";
import {
  borderWidths,
  colors,
  lineHeights,
  radii,
  space,
} from "../sprinkles.css.ts";

export const bubble = style({
  borderRadius: radii.md,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  paddingRight: space.md,
  maxWidth: "85%",
  lineHeight: lineHeights.snug,
  background: colors.chatBubbleAssistant,
  border: `${borderWidths.thin}px solid ${colors.border}`,
  alignSelf: "flex-start",
});

export const user = style({
  alignSelf: "flex-end",
  background: colors.chatBubbleUser,
  border: `${borderWidths.thin}px solid ${colors.borderUser}`,
});
