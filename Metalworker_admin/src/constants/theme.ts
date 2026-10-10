// src/constants/theme.ts
//
// The single design-token source for the whole app. Every color, spacing,
// radius, font size, motion duration and elevation used by a screen should
// come from here so that light/dark stay in lockstep and screens never invent
// ad-hoc values.
import { Platform } from "react-native";

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 44 } as const;
export const radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
export const textSizes = { caption: 11, xs: 12, sm: 14, md: 16, lg: 20, xl: 28, xxl: 34 } as const;

/** Shared animation timings (ms). Keep motion quick and responsive. */
export const motion = { fast: 140, base: 220, slow: 320 } as const;

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
      web: { boxShadow: "0 1px 2px rgba(16, 24, 40, 0.05), 0 1px 3px rgba(16, 24, 40, 0.10)" },
      default: {
        shadowColor: "#101828",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
        elevation: 1,
      },
    }) ?? {},
  raised:
    Platform.select({
      web: { boxShadow: "0 4px 12px rgba(16, 24, 40, 0.12)" },
      default: {
        shadowColor: "#101828",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.14,
        shadowRadius: 10,
        elevation: 4,
      },
    }) ?? {},
  overlay:
    Platform.select({
      web: { boxShadow: "0 8px 24px rgba(16, 24, 40, 0.18)" },
      default: {
        shadowColor: "#101828",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
        elevation: 8,
      },
    }) ?? {},
} as const;

/**
 * Shape shared by both palettes.
 *
 * Previously `ThemeColors` was `typeof darkColors` and `ThemeContext` cast
 * `lightColors as typeof darkColors` — a type lie that hid palette drift
 * (a key added to one palette and forgotten in the other) from the compiler.
 * Declaring the interface explicitly means TypeScript now enforces that both
 * palettes define the exact same keys.
 */
export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSecondary: string;
  surfaceRaised: string;
  surfaceHover: string;
  primary: string;
  primaryHover: string;
  primaryMuted: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderHover: string;
  success: string;
  danger: string;
  warning: string;
  successMuted: string;
  dangerMuted: string;
  warningMuted: string;
  /** Dim scrim drawn over content behind modals, sheets and the drawer. */
  overlay: string;
  primaryButtonText: string;
  secondaryButtonText: string;
}

export const darkColors: ThemeColors = {
  background: "#000000",
  surface: "#141414",
  surfaceSecondary: "#0A0A0A",
  surfaceRaised: "#1C1C1C",
  surfaceHover: "#1F1F1F",
  primary: "#E50914",
  primaryHover: "#B20710",
  primaryMuted: "#E5091420",
  text: "#FFFFFF",
  textSecondary: "#E5E5E5",
  textMuted: "#A3A3A3",
  border: "#2A2A2A",
  borderHover: "#404040",
  success: "#22C55E",
  danger: "#EF4444",
  warning: "#F59E0B",
  successMuted: "#22C55E1F",
  dangerMuted: "#EF44441F",
  warningMuted: "#F59E0B1F",
  overlay: "rgba(0, 0, 0, 0.55)",
  primaryButtonText: "#FFFFFF",
  secondaryButtonText: "#FFFFFF",
};

export const lightColors: ThemeColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSecondary: "#F7F7F7",
  surfaceRaised: "#FFFFFF",
  surfaceHover: "#F3F4F6",
  primary: "#2563EB",
  primaryHover: "#1D4ED8",
  primaryMuted: "#2563EB14",
  text: "#111111",
  textSecondary: "#333333",
  textMuted: "#667085",
  border: "#E5E7EB",
  borderHover: "#D0D5DD",
  success: "#16A34A",
  danger: "#DC2626",
  warning: "#D97706",
  successMuted: "#16A34A14",
  dangerMuted: "#DC262614",
  warningMuted: "#D9770614",
  overlay: "rgba(17, 17, 17, 0.5)",
  primaryButtonText: "#FFFFFF",
  secondaryButtonText: "#111111",
};

export interface AppTheme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  textSizes: typeof textSizes;
  motion: typeof motion;
  elevation: typeof elevation;
}