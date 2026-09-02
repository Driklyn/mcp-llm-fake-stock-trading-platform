import { style } from "@vanilla-extract/css";
import { radii, space } from "ui";

export const githubLink = style({
  display: "inline-flex",
  alignItems: "center",
  gap: space.sm,
  textDecoration: "none",
  whiteSpace: "nowrap",
  fontFamily: "inherit",
  fontSize: "0.875rem",
  fontWeight: 700,
  lineHeight: 1,
  color: "#9ab4d6",
  background: "rgba(10, 19, 27, 0.6)",
  border: "1px solid rgba(149, 170, 200, 0.2)",
  borderRadius: radii.full,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  paddingRight: space.md,
  transition:
    "color 0.15s ease, border-color 0.15s ease, background 0.15s ease",

  ":hover": {
    color: "#dfeafc",
    background: "rgba(18, 33, 49, 0.9)",
  },
});

export const githubIcon = style({
  width: 16,
  height: 16,
  flexShrink: 0,
  fill: "currentColor",
});
