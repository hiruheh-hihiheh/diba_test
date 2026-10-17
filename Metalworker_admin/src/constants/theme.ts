// src/constants/theme.ts
//
// The single design-token source for the whole app.
//
// Design language: "Forge" — graphite surfaces, a molten-copper accent, soft
// radii and quiet elevation. Light and dark palettes share the same hue family
// so switching themes changes luminance, never brand identity.
//
// Every color, spacing, radius, font size, motion duration and elevation used
// by a screen should come from here so light/dark stay in lockstep and screens
// never invent ad-hoc values.
import { Platform, type TextStyle } from "react-native";

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 44 } as const;

/**
 * Soft, modern corner language. `pill` stays 999 for status chips and the
 * theme toggle; everything else is deliberately rounder than a default app so
 * surfaces read as objects rather than boxes.
 */
export const radius = { xs: 8, sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

export const textSizes = {
  caption: 11,
  xs: 12,
  sm: 13,
  md: 15,
  lg: 19,
  xl: 26,
  xxl: 33,
} as const;

/**
 * Type ramp. Font family is intentionally the platform system face (SF Pro on
 * iOS, Roboto on Android): it renders instantly, supports every glyph and
 * keeps the app feeling native. Hierarchy comes from size, weight and
 * letter-spacing instead.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 36, fontWeight: "800", letterSpacing: -0.8 },
  title: { fontSize: 24, lineHeight: 29, fontWeight: "800", letterSpacing: -0.5 },
  section: { fontSize: 18, lineHeight: 23, fontWeight: "700", letterSpacing: -0.2 },
  cardTitle: { fontSize: 16, lineHeight: 21, fontWeight: "700", letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "500" },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  meta: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 1.1 },
  numeric: { fontSize: 28, lineHeight: 32, fontWeight: "800", letterSpacing: -0.7, fontVariant: ["tabular-nums"] },
} satisfies Record<string, TextStyle>;

/** Shared animation timings (ms). Keep motion quick and responsive. */
export const motion = { fast: 120, base: 200, slow: 300 } as const;

/**
 * One elevation preset for every surface. react-native-web does not implement
 * the native `shadow*` props and wants a single `boxShadow` string; native
 * wants the `shadow*` family (with `elevation` for Android). `Platform.select`
 * keeps one style object usable by every component.
 */
export const elevation = {
  none: {},
  card:
    Platform.select({
      web: { boxShadow: "0 1px 2px rgba(8, 10, 14, 0.04), 0 1px 1px rgba(8, 10, 14, 0.03)" },
      default: {
        shadowColor: "#080A0E",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 1,
      },
    }) ?? {},
  raised:
    Platform.select({
      web: { boxShadow: "0 10px 28px rgba(8, 10, 14, 0.10), 0 2px 6px rgba(8, 10, 14, 0.05)" },
      default: {
        shadowColor: "#080A0E",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 14,
        elevation: 5,
      },
    }) ?? {},
  overlay:
    Platform.select({
      web: { boxShadow: "0 18px 48px rgba(8, 10, 14, 0.22)" },
      default: {
        shadowColor: "#080A0E",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.26,
        shadowRadius: 28,
        elevation: 12,
      },
    }) ?? {},
} as const;

/**
 * Shape shared by both palettes.
 *
 * Declared explicitly (rather than derived from one palette) so TypeScript
 * enforces that both palettes define exactly the same keys — a key added to
 * one and forgotten in the other becomes a compile error.
 */
export interface ThemeColors {
  background: string;
  /** Slightly tinted canvas behind grouped cards. */
  backgroundAlt: string;
  surface: string;
  surfaceSecondary: string;
  surfaceRaised: string;
  surfaceHover: string;
  surfaceSunken: string;
  primary: string;
  primaryHover: string;
  primaryMuted: string;
  /** Solid tinted fill for icon bubbles and quiet badges. */
  primarySoft: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderHover: string;
  borderStrong: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  successMuted: string;
  dangerMuted: string;
  warningMuted: string;
  infoMuted: string;
  /** Dim scrim drawn over content behind modals, sheets and the drawer. */
  overlay: string;
  primaryButtonText: string;
  secondaryButtonText: string;
}

/**
 * Dark: deep graphite with a molten-copper accent. Accent fills carry dark ink
 * (not white) — that is what makes the copper read as incandescent rather than
 * as a flat orange block, and it keeps contrast above 8:1.
 */
export const darkColors: ThemeColors = {
  background: "#0A0B0D",
  backgroundAlt: "#0E1013",
  surface: "#121418",
  surfaceSecondary: "#0D0F12",
  surfaceRaised: "#181B20",
  surfaceHover: "#1F232A",
  surfaceSunken: "#08090B",
  primary: "#FF8A3D",
  primaryHover: "#FFA05F",
  primaryMuted: "rgba(255, 138, 61, 0.14)",
  primarySoft: "rgba(255, 138, 61, 0.10)",
  text: "#F6F7F9",
  textSecondary: "#D3D8DF",
  textMuted: "#8B94A1",
  border: "#232831",
  borderHover: "#313742",
  borderStrong: "#3B424F",
  success: "#4ADE80",
  danger: "#FB7185",
  warning: "#FBBF24",
  info: "#60A5FA",
  successMuted: "rgba(74, 222, 128, 0.14)",
  dangerMuted: "rgba(251, 113, 133, 0.14)",
  warningMuted: "rgba(251, 191, 36, 0.14)",
  infoMuted: "rgba(96, 165, 250, 0.14)",
  overlay: "rgba(4, 5, 7, 0.62)",
  primaryButtonText: "#1B0E04",
  secondaryButtonText: "#F6F7F9",
};

/**
 * Light: warm paper canvas (not pure white, which makes flat cards
 * disappear), white surfaces and a deeper copper that keeps white button text
 * above AA contrast.
 */
export const lightColors: ThemeColors = {
  background: "#F6F5F3",
  backgroundAlt: "#F1EFEC",
  surface: "#FFFFFF",
  surfaceSecondary: "#FBFAF8",
  surfaceRaised: "#FFFFFF",
  surfaceHover: "#F0EEEA",
  surfaceSunken: "#EEEBE6",
  primary: "#C2410C",
  primaryHover: "#9A330A",
  primaryMuted: "rgba(194, 65, 12, 0.09)",
  primarySoft: "rgba(194, 65, 12, 0.06)",
  text: "#17191D",
  textSecondary: "#41464F",
  textMuted: "#727A87",
  border: "#E5E2DC",
  borderHover: "#D5D1C9",
  borderStrong: "#C4BFB5",
  success: "#0F9D63",
  danger: "#D92D20",
  warning: "#B45309",
  info: "#2563EB",
  successMuted: "rgba(15, 157, 99, 0.10)",
  dangerMuted: "rgba(217, 45, 32, 0.09)",
  warningMuted: "rgba(180, 83, 9, 0.10)",
  infoMuted: "rgba(37, 99, 235, 0.09)",
  overlay: "rgba(24, 20, 16, 0.42)",
  primaryButtonText: "#FFFFFF",
  secondaryButtonText: "#17191D",
};

export interface AppTheme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  textSizes: typeof textSizes;
  typography: typeof typography;
  motion: typeof motion;
  elevation: typeof elevation;
  /** True when the active palette is the dark one. */
  isDark: boolean;
}
