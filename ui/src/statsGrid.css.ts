import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";

export const grid = style({
  display: "grid",
  gap: space.md,
  marginBottom: space.xl,
  gridTemplateColumns: "repeat(5, minmax(120px, 1fr))",

  "@media": {
    "(max-width: 760px)": {
      gridTemplateColumns: "repeat(2, minmax(120px, 1fr))",
    },
  },
});
