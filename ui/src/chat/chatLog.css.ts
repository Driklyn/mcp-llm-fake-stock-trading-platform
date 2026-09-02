import { style } from "@vanilla-extract/css";
import { space } from "../sprinkles.css.ts";

export const chatLog = style({
  display: "flex",
  flexDirection: "column",
  gap: space.sm,
  paddingRight: space.xs,
  marginBottom: space.lg,
  flex: 1,
  minHeight: space.none,
  height: space.full,
  overflowY: "auto",
});
