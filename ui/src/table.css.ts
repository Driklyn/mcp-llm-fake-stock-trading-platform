import { style } from "@vanilla-extract/css";
import { space } from "./sprinkles.css.ts";

export const table = style({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
  color: "#dfeafc",
});

export const headerCell = style({
  paddingLeft: space.md,
  paddingRight: space.md,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  textAlign: "left",
  borderBottom: "1px solid rgba(149, 170, 200, 0.25)",
  color: "#9ab4d6",
  fontWeight: 600,
  whiteSpace: "nowrap",
});

export const sortableHeader = style([
  headerCell,
  {
    cursor: "pointer",
    userSelect: "none",
    ":hover": {
      color: "#ecf4ff",
    },
  },
]);

export const sortIndicator = style({
  marginLeft: space.xs,
  opacity: 0.7,
  fontSize: 12,
});

export const cell = style({
  paddingLeft: space.md,
  paddingRight: space.md,
  paddingTop: space.sm,
  paddingBottom: space.sm,
  borderBottom: "1px solid rgba(149, 170, 200, 0.12)",
});

export const row = style({
  ":hover": {
    background: "rgba(76, 186, 242, 0.06)",
  },
});

export const emptyCell = style({
  padding: space.xl,
  textAlign: "center",
  color: "#7f93af",
});
