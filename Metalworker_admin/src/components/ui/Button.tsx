// src/components/ui/Button.tsx
//
// The primary action control. One shape language, four intents:
//   primary   — molten copper fill, the single focal action on a screen
//   secondary — quiet outlined surface
//   ghost     — low-emphasis text action
//   danger    — destructive confirmation
//
// Press feedback is a short spring (scale + opacity) driven natively, and the
// loading state swaps the leading glyph for a spinner without changing the
// button's size.
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Icon, type IconName } from "./Icon";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading line icon. */
  icon?: IconName;
  /** Trailing line icon (e.g. chevronRight on "Open"). */
  trailingIcon?: IconName;
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
  trailingIcon,
  fullWidth = false,
  style,
}: ButtonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [scale] = useState(() => new Animated.Value(1));

  const unavailable = disabled || loading;

  const spring = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      friction: 9,
      tension: 300,
    }).start();

  const { background, border, textColor } = useMemo(() => {
    const c = theme.colors;
    switch (variant) {
      case "primary":
        return { background: c.primary, border: c.primary, textColor: c.primaryButtonText };
      case "danger":
        return { background: c.danger, border: c.danger, textColor: "#FFFFFF" };
      case "secondary":
        return { background: c.surface, border: c.borderStrong, textColor: c.text };
      default:
        return { background: "transparent", border: "transparent", textColor: c.textSecondary };
    }
  }, [theme, variant]);

  const iconSize = size === "sm" ? 15 : size === "lg" ? 19 : 17;

  return (
    <Animated.View
      style={[
        fullWidth && styles.fullWidth,
        { transform: [{ scale }] },
        style,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => !unavailable && spring(0.975)}
        onPressOut={() => spring(1)}
        disabled={unavailable}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: unavailable, busy: loading }}
        style={[
          styles.base,
          size === "sm" && styles.sm,
          size === "lg" && styles.lg,
          fullWidth && styles.fullWidth,
          {
            backgroundColor: background,
            borderColor: border,
            borderWidth: variant === "secondary" ? 1 : 0,
          },
          unavailable && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : icon ? (
          <Icon name={icon} size={iconSize} color={textColor} strokeWidth={2} />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.text,
            size === "sm" && styles.textSm,
            size === "lg" && styles.textLg,
            { color: textColor },
          ]}
        >
          {title}
        </Text>
        {trailingIcon && !loading ? (
          <Icon name={trailingIcon} size={iconSize} color={textColor} strokeWidth={2} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    base: {
      minHeight: 48,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: theme.spacing.sm,
      paddingHorizontal: 18,
    },
    sm: {
      minHeight: 38,
      paddingHorizontal: 13,
      borderRadius: theme.radius.sm,
      gap: 6,
    },
    lg: { minHeight: 54, borderRadius: theme.radius.lg, paddingHorizontal: 22 },
    fullWidth: { width: "100%" },
    disabled: { opacity: 0.45 },
    text: {
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      letterSpacing: -0.1,
      flexShrink: 1,
    },
    textSm: { fontSize: theme.textSizes.sm },
    textLg: { fontSize: theme.textSizes.md },
  });
