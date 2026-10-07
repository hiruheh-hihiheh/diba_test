// src/components/shell/AdminHeader.tsx
//
// The one reusable header for the admin app. Left: hamburger (opens the
// navigation drawer) or a back button on detail screens. Center: the current
// route title. Right: the theme toggle only.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../context/ThemeContext";
import { ThemeToggle } from "../ui/ThemeToggle";

interface AdminHeaderProps {
  title: string;
  /** `true` → show a back button instead of the hamburger. */
  showBack: boolean;
  onMenuPress: () => void;
  onBackPress: () => void;
}

export function AdminHeader({
  title,
  showBack,
  onMenuPress,
  onBackPress,
}: AdminHeaderProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top,
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <Pressable
        onPress={showBack ? onBackPress : onMenuPress}
        accessibilityRole="button"
        accessibilityLabel={showBack ? "Go back" : "Open navigation menu"}
        hitSlop={8}
        style={({ pressed }) => [
          styles.menuBtn,
          { opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.menuIcon, { color: theme.colors.text }]}>
          {showBack ? "←" : "☰"}
        </Text>
      </Pressable>

      <Text
        style={[styles.title, { color: theme.colors.text }]}
        numberOfLines={1}
      >
        {title}
      </Text>

      <ThemeToggle />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 8,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  menuBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIcon: {
    fontSize: 20,
    fontWeight: "700",
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
  },
});