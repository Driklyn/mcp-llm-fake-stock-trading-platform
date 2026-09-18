import { globalStyle } from "@vanilla-extract/css";
import {
  colors,
  fontSizes,
  fontWeights,
  fonts,
  lineHeights,
  space,
} from "ui";

globalStyle(":root", {
  colorScheme: "dark",
  fontFamily: fonts.body,
  lineHeight: lineHeights.normal,
  fontWeight: fontWeights.regular,
  background: colors.pageBackground,
  color: colors.textStrong,
});

globalStyle("*", {
  boxSizing: "border-box",
});

globalStyle("body", {
  marginTop: space.none,
  marginRight: space.none,
  marginBottom: space.none,
  marginLeft: space.none,
  minHeight: "100vh",
  background: colors.pageGradient,
});

globalStyle("button, input", {
  font: "inherit",
});

globalStyle("h1", {
  margin: space.none,
  fontSize: `clamp(${fontSizes.xxl}px, 2.25vw, ${fontSizes.xxxl}px)`,
});

globalStyle("h2", {
  marginTop: space.none,
});
