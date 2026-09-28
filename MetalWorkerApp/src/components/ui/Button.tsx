import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { theme } from "../../constants/theme";

type Variant = "primary" | "outline" | "ghost" | "danger";

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: Variant;
  /** Announced by screen readers; falls back to `title`. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
  accessibilityLabel,
  style,
  fullWidth = true,
}: ButtonProps) {
  const unavailable = disabled || loading;
  const spinnerColor = variant === "outline" || variant === "ghost" ? theme.colors.primary : "#FFFFFF";

  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      // Keeps the tap area at 48dp even when the label is a single short word.
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variantStyles[variant],
        pressed && !unavailable && styles.pressed,
        unavailable && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <Text style={[styles.text, textStyles[variant]]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1.5,
  },
  fullWidth: { alignSelf: "stretch" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
  text: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  outline: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: theme.colors.danger, borderColor: theme.colors.danger },
});

const textStyles = StyleSheet.create({
  primary: { color: "#FFFFFF" },
  outline: { color: theme.colors.text },
  ghost: { color: theme.colors.primary },
  danger: { color: "#FFFFFF" },
});
