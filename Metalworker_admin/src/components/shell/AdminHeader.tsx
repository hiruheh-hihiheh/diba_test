// src/components/shell/AdminHeader.tsx
//
// The app bar every admin screen shares: menu (or back on detail routes), the
// route title, and the theme switch. It sits above content in normal flow and
// carries the safe-area top padding, so no screen has to think about the
// status bar.
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { IconButton } from "../ui/IconButton";
import { ThemeToggle } from "../ui/ThemeToggle";

interface AdminHeaderProps {
  title: string;
  /** When true a back button replaces the menu button. */
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
          backgroundColor: theme.colors.background,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.headerInner}>
        <IconButton
          icon={showBack ? "arrowLeft" : "menu"}
          accessibilityLabel={showBack ? "Go back" : "Open navigation menu"}
          onPress={showBack ? onBackPress : onMenuPress}
          variant="soft"
          size={38}
          iconSize={18}
        />

        <Text
          accessibilityRole="header"
          style={[styles.title, { color: theme.colors.text }]}
          numberOfLines={1}
        >
          {title}
        </Text>

        <ThemeToggle />
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
      height: 58,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      gap: 12,
    },
    title: {
      flex: 1,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      letterSpacing: -0.4,
    },
  });
