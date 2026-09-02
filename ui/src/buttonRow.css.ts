import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";

export const buttonRow = style({
  display: "grid",
  gap: space.md,
  marginBottom: space.lg,
  gridTemplateColumns: "1fr 1fr",
  selectors: {
    "&:has(+ &)": {
      marginBottom: space.md,
    },
  },
});
