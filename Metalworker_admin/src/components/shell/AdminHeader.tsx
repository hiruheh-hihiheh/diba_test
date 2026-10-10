// src/components/shell/AdminHeader.tsx
//
// The app bar every admin screen shares: hamburger (or back button on detail
// routes), the route title, and the theme toggle. Sits above screen content
// in normal flow; safe-area top padding keeps it clear of the status bar.
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { ThemeToggle } from "../ui/ThemeToggle";

interface AdminHeaderProps {
  title: string;
  /** When true a back button replaces the hamburger. */
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
  const styles = useMemo(() => createStyles(theme), [theme]);

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
      <View style={styles.headerInner}>
        <Pressable
          onPress={showBack ? onBackPress : onMenuPress}
          accessibilityRole="button"
          accessibilityLabel={showBack ? "Go back" : "Open navigation menu"}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconBtn,
            { backgroundColor: pressed ? theme.colors.surfaceHover : "transparent" },
          ]}
        >
          <Text style={[styles.iconText, { color: theme.colors.text }]}>
            {showBack ? "‹" : "☰"}
          </Text>
        </Pressable>

        <Text
          style={[styles.title, { color: theme.colors.text }]}
          numberOfLines={1}
        >
          {title}
        </Text>

        <ThemeToggle size={40} />
      </View>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    header: {
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerInner: {
      height: 52,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: theme.spacing.sm,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    iconText: {
      fontSize: 24,
      lineHeight: 28,
      fontWeight: "600",
    },
    title: {
      flex: 1,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      marginHorizontal: theme.spacing.sm,
    },
  });