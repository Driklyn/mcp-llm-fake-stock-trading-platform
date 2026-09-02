import { style } from "@vanilla-extract/css";
import { radii, space } from "./sprinkles.css.ts";

export const root = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: space.none,
  height: space.full,
});

export const tabList = style({
  display: "flex",
  gap: space.sm,
  marginBottom: space.lg,
  paddingBottom: space.sm,
  borderBottom: "1px solid rgba(149, 170, 200, 0.2)",
});

export const tab = style({
  borderRadius: radii.sm,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  paddingLeft: space.md,
  paddingRight: space.md,
  flex: 1,
  appearance: "none",
  border: "1px solid rgba(149, 170, 200, 0.2)",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "0.92rem",
  background: "rgba(10, 19, 27, 0.6)",
  color: "#9ab4d6",
  transition:
    "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",

  ":hover": {
    background: "rgba(18, 33, 49, 0.9)",
    color: "#dfeafc",
  },
});

export const active = style({
  background: "linear-gradient(135deg, #2db978, #1aaf76)",
  borderColor: "transparent",
  color: "white",

  ":hover": {
    background: "linear-gradient(135deg, #2db978, #1aaf76)",
    color: "white",
  },
});

export const tabContent = style({
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: space.none,
  height: space.full,
  overflow: "auto",
});

export const hidden = style({
  display: "none",
});
