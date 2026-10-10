// src/components/ui/Button.tsx
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional leading glyph (emoji) shown before the label. */
  icon?: string;
  /** Stretch to fill the container width. */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
  size = "md",
  icon,
  fullWidth = false,
  style,
}: ButtonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const unavailable = disabled || loading;

  const bgStyle =
    variant === "primary"
      ? { backgroundColor: theme.colors.primary }
      : variant === "danger"
      ? { backgroundColor: theme.colors.danger }
      : { backgroundColor: "transparent" };

  const textColor =
    variant === "primary" || variant === "danger"
      ? theme.colors.primaryButtonText
      : theme.colors.text;

  const borderColor =
    variant === "secondary" || variant === "ghost"
      ? theme.colors.border
      : undefined;

  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === "sm" && styles.sm,
        fullWidth && styles.fullWidth,
        bgStyle,
        borderColor ? { borderWidth: 1, borderColor } : null,
        pressed && !unavailable && styles.pressed,
        pressed && !unavailable && { transform: [{ scale: 0.98 }] },
        unavailable && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        icon ? <Text style={[styles.icon, { color: textColor }]}>{icon}</Text> : null
      )}
      <Text
        style={[
          styles.text,
          { color: textColor },
          size === "sm" && styles.textSm,
        ]}
      >
        {loading ? `${title}…` : title}
      </Text>
    </Pressable>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    base: {
      minHeight: 50,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
    },
    sm: {
      minHeight: 40,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.sm,
    },
    fullWidth: {
      width: "100%",
    },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.5 },
    icon: { fontSize: 16 },
    text: { fontSize: theme.textSizes.md, fontWeight: "600" },
    textSm: { fontSize: theme.textSizes.sm },
  });