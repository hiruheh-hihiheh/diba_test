import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { theme } from "../../constants/theme";

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
  style,
}: ButtonProps) {
  const unavailable = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" ? styles.primary : styles.ghost,
        pressed && styles.pressed,
        unavailable && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "ghost" ? theme.colors.text : "#FFFFFF"} />
      ) : (
        <Text style={[styles.text, variant === "ghost" && styles.ghostText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.md,
  },
  primary: { backgroundColor: theme.colors.primary },
  ghost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  text: { color: "#FFFFFF", fontSize: theme.textSizes.md, fontWeight: "600" },
  ghostText: { color: theme.colors.text },
});