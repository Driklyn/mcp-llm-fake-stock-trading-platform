import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";

export const shell = style({
  marginLeft: "auto",
  marginRight: "auto",
  paddingTop: space.xxl,
  paddingBottom: space.xxxl,
  paddingLeft: space.xl,
  paddingRight: space.xl,
  maxWidth: 1200,
});

export const layout = style({
  display: "grid",
  gap: space.xl,
  alignItems: "stretch",
  gridTemplateColumns: "2fr 1fr",
  height: 635,

  "@media": {
    "(max-width: 1023px)": {
      gridTemplateColumns: "1fr",
      height: "auto",
    },
  },
});
