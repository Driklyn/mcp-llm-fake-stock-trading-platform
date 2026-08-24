import { style } from "@vanilla-extract/css";
import { space } from "../sprinkles.css.ts";

export const receipt = style({
  display: "flex",
  flexDirection: "column",
  gap: space.xs,
});

export const row = style({
  fontSize: "0.95rem",
  color: "#ecf4ff",
});

export const note = style({
  marginTop: space.xs,
  fontSize: "0.85rem",
  color: "#9ab4d6",
});
