import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";
import { input as baseInput } from "./input.css.ts";

// Single-cell grid: the "$" prefix and the input share the same grid area and
// border-box. The prefix inherits the input's font and line-height, and mirrors
// its top-edge box metrics (margin-top, 1px border, vertical padding) using the
// same design tokens — so the "$" glyph is laid out exactly where the input's
// first text line begins. No centering math to drift across fonts/sizes.
export const wrap = style({
  display: "grid",
});

export const prefix = style({
  marginTop: space.sm,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  gridArea: "1 / 1",
  justifySelf: "start",
  position: "relative",
  zIndex: 1, // keep the "$" above the input's background (shared border-box)
  border: "1px solid transparent",
  background: "transparent",
  color: "rgba(149, 170, 200, 0.7)",
  pointerEvents: "none",
  userSelect: "none",
});

export const input = style([
  baseInput,
  {
    paddingLeft: space.xl,
    gridArea: "1 / 1",
  },
]);
