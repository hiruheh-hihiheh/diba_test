// src/components/ui/IconButton.tsx
//
// Square icon-only control used in headers, toolbars and card corners. Keeps a
// 44pt minimum touch target regardless of the requested visual size.
import React, { useMemo, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Icon, type IconName } from "./Icon";

interface IconButtonProps {
  icon: IconName;
  /** Required: icon-only controls must describe themselves. */
  accessibilityLabel: string;
  onPress: () => void;
  variant?: "ghost" | "soft" | "outline" | "solid";
  size?: number;
  iconSize?: number;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = "soft",
  size = 40,
  iconSize = 19,
  color,
  disabled = false,
  style,
}: IconButtonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [scale] = useState(() => new Animated.Value(1));

  const spring = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      friction: 9,
      tension: 300,
    }).start();

  const fg =
    color ??
    (variant === "solid" ? theme.colors.primaryButtonText : theme.colors.text);

  const background =
    variant === "solid"
      ? theme.colors.primary
      : variant === "soft"
      ? theme.colors.surfaceHover
      : variant === "outline"
      ? theme.colors.surface
      : "transparent";

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => spring(0.9)}
        onPressOut={() => spring(1)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        hitSlop={6}
        style={[
          styles.base,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: background,
            borderWidth: variant === "outline" ? 1 : 0,
            borderColor: theme.colors.border,
            opacity: disabled ? 0.45 : 1,
          },
        ]}
      >
        <Icon name={icon} size={iconSize} color={fg} />
      </Pressable>
    </Animated.View>
  );
}

const createStyles = (_theme: AppTheme) =>
  StyleSheet.create({
    base: { alignItems: "center", justifyContent: "center" },
  });
