// src/components/ui/Badge.tsx
//
// One status pill for the whole app. Status is communicated by label + color
// (never color alone), and the tone names map to the semantic palette tokens.
import React, { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "success"
  | "danger"
  | "warning"
  | "info";

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  /** `soft` is the default quiet fill; `solid` is for the one focal state. */
  variant?: "soft" | "solid" | "outline";
  size?: "sm" | "md";
  /** Small leading dot reinforces the status without relying on color alone. */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  numberOfLines?: number;
}

export function Badge({
  label,
  tone = "neutral",
  variant = "soft",
  size = "sm",
  dot = false,
  style,
  numberOfLines = 1,
}: BadgeProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { fg, bg } = useMemo(() => {
    const c = theme.colors;
    switch (tone) {
      case "primary":
        return { fg: c.primary, bg: c.primaryMuted };
      case "success":
        return { fg: c.success, bg: c.successMuted };
      case "danger":
        return { fg: c.danger, bg: c.dangerMuted };
      case "warning":
        return { fg: c.warning, bg: c.warningMuted };
      case "info":
        return { fg: c.info, bg: c.infoMuted };
      default:
        return { fg: c.textSecondary, bg: c.surfaceHover };
    }
  }, [theme, tone]);

  const solid = variant === "solid";
  const outline = variant === "outline";
  const textColor = solid ? theme.colors.primaryButtonText : fg;

  return (
    <View
      style={[
        styles.base,
        size === "md" && styles.md,
        {
          backgroundColor: solid ? fg : outline ? "transparent" : bg,
          borderColor: solid ? fg : outline ? fg : "transparent",
          borderWidth: outline ? 1 : 0,
        },
        style,
      ]}
    >
      {dot ? (
        <View
          style={[
            styles.dot,
            { backgroundColor: solid ? theme.colors.primaryButtonText : fg },
          ]}
        />
      ) : null}
      <Text
        numberOfLines={numberOfLines}
        style={[styles.text, size === "md" && styles.textMd, { color: textColor }]}
      >
        {label}
      </Text>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    base: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 6,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: theme.radius.pill,
      maxWidth: "100%",
    },
    md: { paddingHorizontal: 11, paddingVertical: 5 },
    dot: { width: 5, height: 5, borderRadius: 3 },
    text: {
      fontSize: theme.textSizes.caption,
      fontWeight: "700",
      letterSpacing: 0.2,
      flexShrink: 1,
    },
    textMd: { fontSize: theme.textSizes.xs },
  });
