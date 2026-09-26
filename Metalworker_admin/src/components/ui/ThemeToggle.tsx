import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { useTheme } from "../../context/ThemeContext";

export function ThemeToggle() {
  const { themeMode, toggleTheme, theme } = useTheme();
  
  const isDark = themeMode === "dark";
  
  return (
    <Pressable
      onPress={toggleTheme}
      accessibilityRole="button"
      accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={({ pressed }) => [
        styles.toggleBtn,
        { 
          backgroundColor: theme.colors.surfaceHover,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        }
      ]}
    >
      <Text style={[styles.icon, { color: theme.colors.text }]}>
        {isDark ? "☀️" : "🌙"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 18,
  },
});
