// src/components/ui/Card.tsx
import React, { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  /** Raise the card so it reads as floating (used by sheets/modals). */
  elevated?: boolean;
  /** Remove the default padding. */
  unpadded?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * The standard surface container for list rows, panels and grouped content.
 * Bordered, softly elevated and theme-aware; optionally tappable.
 */
export function Card({
  children,
  onPress,
  elevated = false,
  unpadded = false,
  style,
  accessibilityLabel,
}: CardProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const surface = [
    styles.card,
    !unpadded && styles.padded,
    elevated && styles.elevated,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          surface,
          pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
        ]}
      >
        {children}
      </Pressable>
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
    elevated: {
      backgroundColor: theme.colors.surfaceRaised,
      ...theme.elevation.raised,
    },
  });