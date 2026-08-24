import { createSprinkles, defineProperties } from "@vanilla-extract/sprinkles";

export const space = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};

const layoutProperties = defineProperties({
  properties: {
    display: ["flex", "grid", "block", "inline-flex", "none"],
    flexDirection: ["row", "column", "row-reverse", "column-reverse"],
    alignItems: ["flex-start", "flex-end", "center", "baseline", "stretch"],
    justifyContent: [
      "flex-start",
      "flex-end",
      "center",
      "space-between",
      "space-around",
      "space-evenly",
    ],
    flexWrap: ["nowrap", "wrap", "wrap-reverse"],
    gap: space,
    rowGap: space,
    columnGap: space,
  },
  shorthands: {
    placeItems: ["alignItems", "justifyContent"],
  },
});

// Horizontal margins additionally accept `auto` for centering via `marginX`.
const marginSpace = {
  ...space,
  auto: "auto",
};

const spacingProperties = defineProperties({
  conditions: {
    default: {},
    followedByType: { selector: "&:has(+ &)" },
    precededByType: { selector: "& + &" },
  },
  defaultCondition: "default",
  properties: {
    marginTop: space,
    marginRight: marginSpace,
    marginBottom: space,
    marginLeft: marginSpace,
    paddingTop: space,
    paddingRight: space,
    paddingBottom: space,
    paddingLeft: space,
    top: space,
    right: space,
    bottom: space,
    left: space,
  },
  shorthands: {
    margin: ["marginTop", "marginRight", "marginBottom", "marginLeft"],
    marginX: ["marginLeft", "marginRight"],
    marginY: ["marginTop", "marginBottom"],
    padding: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
    paddingX: ["paddingLeft", "paddingRight"],
    paddingY: ["paddingTop", "paddingBottom"],
  },
});

const visualProperties = defineProperties({
  properties: {
    borderRadius: radii,
    textAlign: ["left", "center", "right"],
  },
});

export const sprinkles = createSprinkles(
  layoutProperties,
  spacingProperties,
  visualProperties,
);

export type Sprinkles = Parameters<typeof sprinkles>[0];
