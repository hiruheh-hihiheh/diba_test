import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "../../constants/theme";

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "outline";
  style?: StyleProp<ViewStyle>;
}

export function Button({ title, onPress, loading = false, disabled = false, variant = "primary", style }: ButtonProps) {
  const unavailable = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={unavailable}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" ? styles.primary : styles.outline,
        pressed && styles.pressed,
        unavailable && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "outline" ? theme.colors.primary : "#FFFFFF"} />
      ) : (
        <Text style={[styles.text, variant === "outline" && styles.outlineText]}>{title}</Text>
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
  primary: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  outline: { backgroundColor: "transparent", borderColor: theme.colors.border },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.5 },
  text: { color: "#FFFFFF", fontSize: theme.textSizes.md, fontWeight: "700", letterSpacing: 0.5 },
  outlineText: { color: theme.colors.text },
});