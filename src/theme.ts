/**
 * Cruzo design tokens.
 *
 * Two palettes with identical keys. The map overlays switch between them with
 * the basemap, because a dark panel that looks sharp at night is close to
 * unreadable on a phone clamped to handlebars in Dhaka sunshine — and the
 * reverse is true after dark.
 */

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceHigh: string;
  border: string;
  borderSoft: string;

  text: string;
  textDim: string;
  textFaint: string;

  accent: string;
  accentDim: string;
  accentWash: string;
  /** Text and glyphs drawn on top of `accent`. */
  onAccent: string;

  success: string;
  warning: string;
  danger: string;

  /** Panel backing over the map: opaque enough to read, not to hide the road. */
  scrim: string;
};

export const darkPalette: Palette = {
  bg: "#0B0E13",
  surface: "#151A22",
  surfaceAlt: "#1E2530",
  surfaceHigh: "#273040",
  border: "#2A3340",
  borderSoft: "#1F2833",

  text: "#F2F5F9",
  textDim: "#8B96A5",
  textFaint: "#5B6574",

  accent: "#FF5C1A",
  accentDim: "#C43F09",
  accentWash: "rgba(255, 92, 26, 0.14)",
  onAccent: "#1A0A02",

  success: "#2ED573",
  warning: "#FFB020",
  danger: "#FF4757",

  scrim: "rgba(11, 14, 19, 0.88)",
};

/**
 * Daylight palette.
 *
 * The accent is a shade deeper than the dark theme's: the same bright orange
 * that pops against near-black drops below a comfortable contrast ratio on
 * white, which matters most exactly when the sun is out.
 */
export const lightPalette: Palette = {
  bg: "#F3F6FA",
  surface: "#FFFFFF",
  surfaceAlt: "#EDF1F7",
  surfaceHigh: "#DFE6EF",
  border: "#C7D1DE",
  borderSoft: "#E4EAF2",

  text: "#0C1420",
  textDim: "#48566A",
  textFaint: "#79879A",

  accent: "#DC4A0C",
  accentDim: "#A9380A",
  accentWash: "rgba(220, 74, 12, 0.12)",
  onAccent: "#FFFFFF",

  success: "#15803D",
  warning: "#B45309",
  danger: "#C62828",

  scrim: "rgba(255, 255, 255, 0.94)",
};

/**
 * Default palette for screens outside the map, which are used before a ride
 * rather than in daylight on the road.
 */
export const colors = darkPalette;

/**
 * Marker colours assigned to riders by join order. Chosen to stay legible on
 * both the light and dark basemaps, and to remain distinguishable for the most
 * common forms of colour blindness.
 */
export const riderPalette = [
  "#FF5C1A",
  "#1E88E5",
  "#20A464",
  "#E5A100",
  "#8E5BD0",
  "#E0367F",
  "#00968A",
  "#D6453C",
] as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const font = {
  /** Tabular-ish feel for codes and numbers on Android. */
  mono: "monospace",
} as const;
