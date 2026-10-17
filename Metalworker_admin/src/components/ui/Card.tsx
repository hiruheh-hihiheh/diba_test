// src/components/ui/Card.tsx
import React, { useMemo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { PressableScale } from "./PressableScale";

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  /** Raise the card so it reads as floating (used by sheets/dialogs). */
  elevated?: boolean;
  /** Tinted surface for inset panels inside another card. */
  inset?: boolean;
  /** Remove the default padding. */
  unpadded?: boolean;
  /** Copper-tinted border marking a selection or focal item. */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

/**
 * The standard surface container for list rows, panels and grouped content.
 * Bordered, softly elevated and theme-aware; optionally tappable with spring
 * press feedback.
 */
export function Card({
  children,
  onPress,
  elevated = false,
  inset = false,
  unpadded = false,
  selected = false,
  style,
  accessibilityLabel,
  accessibilityHint,
}: CardProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const surface = [
    styles.card,
    inset && styles.inset,
    !unpadded && styles.padded,
    elevated && styles.elevated,
    selected && { borderColor: theme.colors.primary },
    style,
  ];

  if (onPress) {
    return (
      <PressableScale
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={surface}
      >
        {children}
      </PressableScale>
    );
  }

  return <View style={surface}>{children}</View>;
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      ...theme.elevation.card,
    },
    padded: {
      padding: theme.spacing.md,
    },
    inset: {
      backgroundColor: theme.colors.surfaceSecondary,
      borderColor: theme.colors.border,
      elevation: 0,
    },
    elevated: {
      backgroundColor: theme.colors.surfaceRaised,
      ...theme.elevation.raised,
    },
  });
