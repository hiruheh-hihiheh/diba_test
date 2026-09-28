// src/constants/theme.ts

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const textSizes = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 } as const;

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
  primaryButtonText: string;
  secondaryButtonText: string;
}

export const darkColors: ThemeColors = {
  background: "#000000",
  surface: "#141414",
  surfaceSecondary: "#0A0A0A",
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
  primaryButtonText: "#FFFFFF",
  secondaryButtonText: "#FFFFFF",
};

export const lightColors: ThemeColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSecondary: "#F7F7F7",
  surfaceHover: "#F3F4F6",
  primary: "#2563EB",
  primaryHover: "#1D4ED8",
  primaryMuted: "#2563EB20",
  text: "#111111",
  textSecondary: "#333333",
  textMuted: "#666666",
  border: "#E5E7EB",
  borderHover: "#D1D5DB",
  success: "#16A34A",
  danger: "#DC2626",
  warning: "#D97706",
  primaryButtonText: "#000000",
  secondaryButtonText: "#111111",
};

export interface AppTheme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  textSizes: typeof textSizes;
}