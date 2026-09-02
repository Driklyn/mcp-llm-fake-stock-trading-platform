import { style } from "@vanilla-extract/css";
import { radii, space } from "./sprinkles.css.ts";

export const section = style({
  marginTop: space.xl,
  padding: space.lg,
  borderRadius: radii.md,
  background: "rgba(18, 33, 49, 0.9)",
});

export const title = style({
  marginBottom: space.md,
  marginTop: space.none,
  fontSize: "1.05rem",
});

export const filters = style({
  display: "flex",
  flexWrap: "wrap",
  gap: space.md,
  marginBottom: space.lg,
  alignItems: "center",
});

export const filterGroup = style({
  display: "flex",
  alignItems: "center",
  gap: space.xs,
  flexWrap: "wrap",
});

export const filterLabel = style({
  color: "#9ab4d6",
  fontSize: 12,
  fontWeight: 600,
});

export const chip = style({
  paddingLeft: space.sm,
  paddingRight: space.sm,
  paddingTop: space.xs,
  paddingBottom: space.xs,
  borderRadius: radii.full,
  border: "1px solid rgba(149, 170, 200, 0.3)",
  background: "transparent",
  color: "#dfeafc",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  ":hover": {
    borderColor: "rgba(76, 186, 242, 0.6)",
    color: "#ecf4ff",
  },
});

export const chipActive = style({
  background: "rgba(76, 186, 242, 0.18)",
  borderColor: "rgba(76, 186, 242, 0.7)",
  color: "#ecf4ff",
});

export const priceInputs = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: space.xs,
});

export const priceInput = style({
  paddingLeft: space.sm,
  paddingRight: space.sm,
  paddingTop: space.xs,
  paddingBottom: space.xs,
  borderRadius: radii.sm,
  width: 84,
  border: "1px solid rgba(149, 170, 200, 0.3)",
  background: "rgba(9, 17, 25, 0.9)",
  color: "#ecf4ff",
  fontSize: 13,
  ":focus": {
    outline: "none",
    borderColor: "rgba(76, 186, 242, 0.7)",
  },
});

export const tableWrapper = style({
  overflowX: "auto",
});

export const positive = style({
  color: "#4ade80",
  fontWeight: 700,
});

export const negative = style({
  color: "#f87171",
  fontWeight: 700,
});

export const statusOpen = style({
  color: "#fbbf24",
});

export const statusCompleted = style({
  color: "#4ade80",
});

export const statusCancelled = style({
  color: "#9ca3af",
});

export const statusFailed = style({
  color: "#f87171",
});

export const muted = style({
  color: "#7f93af",
});
