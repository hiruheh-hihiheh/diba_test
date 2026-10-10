// src/components/ui/ThemeToggle.tsx
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../../context/ThemeContext";

export function ThemeToggle({
  size = 40,
}: {
  /** Button footprint (square). Defaults to 40. */
  size?: number;
}) {
  const { themeMode, toggleTheme, theme } = useTheme();
  const isDark = themeMode === "dark";

  // Gentle rotation on every switch: clockwise to light, counter to dark.
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(spin, {
      toValue: isDark ? 0 : 1,
      duration: theme.motion.base,
      useNativeDriver: true,
    }).start();
  }, [isDark, spin, theme.motion.base]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Pressable
      onPress={toggleTheme}
      accessibilityRole="button"
      accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
      accessibilityState={{ selected: isDark }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.toggleBtn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.surfaceHover,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Animated.Text
        style={[
          styles.icon,
          { color: theme.colors.text, transform: [{ rotate }] },
        ]}
      >
        {isDark ? "☀️" : "🌙"}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggleBtn: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 18,
  },
});