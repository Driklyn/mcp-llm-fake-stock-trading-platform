import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";

export const topbar = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  marginBottom: space.xl,
});
