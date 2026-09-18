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
  full: "100%",
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
};

export const fontSizes = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 15,
  xl: 17,
  xxl: 24,
  xxxl: 32,
};

export const fontWeights = {
  regular: 400,
  semibold: 600,
  bold: 700,
};

export const lineHeights = {
  none: 1,
  snug: 1.4,
  normal: 1.5,
};

export const letterSpacings = {
  wide: "0.12em",
};

export const fonts = {
  body: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

export const colors = {
  // Text
  textStrong: "#ecf4ff",
  text: "#dfeafc",
  textMuted: "#9ab4d6",
  textFaint: "#7f93af",
  textOnPrimary: "#ffffff",

  // Placeholder / prefix glyph
  textPlaceholder: "rgba(149, 170, 200, 0.7)",

  // State
  positive: "#4ade80",
  negative: "#f87171",
  warning: "#fbbf24",
  neutral: "#9ca3af",
  accent: "#4cbaf2",

  // Brand
  primary: "#2db978",
  primaryDark: "#1aaf76",
  secondary: "#4d6b94",
  secondaryDark: "#3a5f8a",

  // Surfaces
  surfacePanel: "rgba(11, 19, 27, 0.8)",
  surfaceCard: "rgba(18, 33, 49, 0.9)",
  surfaceInset: "rgba(10, 19, 27, 0.9)",
  surfaceRaised: "rgba(32, 60, 83, 0.9)",
  surfaceOverlay: "rgba(9, 17, 25, 0.9)",
  surfaceInsetSoft: "rgba(10, 19, 27, 0.6)",
  surfaceChart: "rgba(22, 32, 44, 0.8)",

  // Borders
  border: "rgba(149, 170, 200, 0.2)",
  borderStrong: "rgba(149, 170, 200, 0.3)",
  borderSubtle: "rgba(149, 170, 200, 0.12)",
  borderHeader: "rgba(149, 170, 200, 0.25)",
  borderAccent: "rgba(76, 186, 242, 0.7)",
  borderAccentSoft: "rgba(76, 186, 242, 0.6)",
  borderUser: "rgba(45, 185, 120, 0.3)",
  gridLine: "rgba(154, 180, 214, 0.18)",

  // Page
  pageBackground: "#07111f",
  pageGradient: "linear-gradient(160deg, #05101c 0%, #0c1f2f 100%)",
  chatBubbleAssistant: "rgba(74, 108, 154, 0.18)",
  chatBubbleUser: "rgba(45, 185, 120, 0.18)",
  rowHover: "rgba(76, 186, 242, 0.06)",
  chipActiveBackground: "rgba(76, 186, 242, 0.18)",

  // Gradients
  gradientPrimary: "linear-gradient(135deg, #2db978, #1aaf76)",
  gradientSecondary: "linear-gradient(135deg, #4d6b94, #3a5f8a)",
  chartGradient:
    "linear-gradient(180deg, rgba(22, 32, 44, 0.8), rgba(11, 19, 27, 0.8))",
};

// Flat surfaces and gradients for the `background` shorthand (which also accepts
// the `colors` transparent literal used by outline-style chips).
export const backgrounds = {
  ...colors,
  transparent: "transparent",
};

export const shadows = {
  panel: "0 18px 40px rgba(0, 0, 0, 0.15)",
};

export const opacity = {
  disabled: 0.6,
  muted: 0.7,
};

export const borderWidths = {
  thin: 1,
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

const typographyProperties = defineProperties({
  properties: {
    color: colors,
    fontFamily: fonts,
    fontSize: fontSizes,
    fontWeight: fontWeights,
    lineHeight: lineHeights,
    letterSpacing: letterSpacings,
  },
});

const surfaceProperties = defineProperties({
  properties: {
    background: backgrounds,
    borderColor: colors,
    borderWidth: borderWidths,
    boxShadow: shadows,
    opacity: opacity,
  },
});

const sizingProperties = defineProperties({
  properties: {
    width: space,
    minWidth: space,
    maxWidth: space,
    height: space,
    minHeight: space,
    maxHeight: space,
  },
});

export const sprinkles = createSprinkles(
  layoutProperties,
  spacingProperties,
  visualProperties,
  typographyProperties,
  surfaceProperties,
  sizingProperties,
);

export type Sprinkles = Parameters<typeof sprinkles>[0];
