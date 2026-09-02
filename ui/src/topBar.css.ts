import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";

export const topBar = style({
  display: "flex",
  gap: space.sm,
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: space.xl,

  "@media": {
    "(max-width: 1023px)": {
      flexDirection: "column-reverse",
    },
  },
});
