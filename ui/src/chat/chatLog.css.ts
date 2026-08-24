import { style } from "@vanilla-extract/css";
import { space } from "../sprinkles.css.ts";

export const chatLog = style({
  display: "flex",
  flexDirection: "column",
  gap: space.sm,
  paddingRight: space.xs,
  marginBottom: space.lg,
  maxHeight: 360,
  overflowY: "auto",
});
