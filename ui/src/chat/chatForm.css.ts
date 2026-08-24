import { globalStyle, style } from "@vanilla-extract/css";
import { space } from "../sprinkles.css.ts";

export const chatForm = style({
  display: "grid",
  gap: space.md,
  gridTemplateColumns: "1fr auto",

  "@media": {
    "(max-width: 760px)": {
      gridTemplateColumns: "1fr",
    },
  },
});

globalStyle(`${chatForm} input`, {
  marginTop: 0,
});
