import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";

export const grid = style({
  display: "grid",
  gap: space.md,
  marginBottom: space.xl,
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",

  "@media": {
    "(max-width: 1023px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    },
  },
});
