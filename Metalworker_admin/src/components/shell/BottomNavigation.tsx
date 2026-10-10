// src/components/shell/BottomNavigation.tsx
//
// Fixed bottom bar with the five high-frequency destinations (Home, Jobs,
// Bills, Folders, More). It sits in the normal layout flow below the content
// area, so screen content is never hidden behind it. The active tab's pill
// springs in; Jobs and More open sheets instead of navigating.
import React, { memo, useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  BOTTOM_TABS,
  type BottomTab,
  type BottomTabKey,
} from "../../navigation/navigationConfig";

interface BottomNavigationProps {
  activeTab: BottomTabKey | null;
  /** "jobs" / "more" when their sheet is open (keeps the tab lit). */
  openSheet: "jobs" | "more" | null;
  onSelect: (key: BottomTabKey) => void;
}

export function BottomNavigation({ activeTab, openSheet, onSelect }: BottomNavigationProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const resolved = openSheet ?? activeTab;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, 8),
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      {BOTTOM_TABS.map((tab) => (
        <TabButton
          key={tab.key}
          tab={tab}
          active={resolved === tab.key}
          theme={theme}
          onPress={() => onSelect(tab.key)}
        />
      ))}
    </View>
  );
}

const TabButton = memo(function TabButton({
  tab,
  active,
  theme,
  onPress,
}: {
  tab: BottomTab;
  active: boolean;
  theme: AppTheme;
  onPress: () => void;
}) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  // 1 = resting, 0.94 = lightly compressed while pressed or springing in.
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: active ? 1.12 : 1,
      useNativeDriver: true,
      friction: 6,
      tension: 90,
    }).start();
  }, [active, anim]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.tab,
        pressed && styles.tabPressed,
      ]}
    >
      <Animated.View
        style={[
          styles.pill,
          active && { backgroundColor: theme.colors.primaryMuted },
          { transform: [{ scale: anim }] },
        ]}
      >
        <Text
          style={[
            styles.icon,
            { color: active ? theme.colors.primary : theme.colors.textMuted },
          ]}
        >
          {tab.icon}
        </Text>
        <Text
          style={[
            styles.label,
            {
              color: active ? theme.colors.primary : theme.colors.textMuted,
              fontWeight: active ? "700" : "500",
            },
          ]}
        >
          {tab.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
});

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 6,
      ...theme.elevation.raised,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 6,
    },
    tabPressed: {
      opacity: 0.7,
    },
    pill: {
      minWidth: 64,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 4,
      borderRadius: theme.radius.xl,
      gap: 1,
    },
    icon: {
      fontSize: 18,
      lineHeight: 22,
    },
    label: {
      fontSize: theme.textSizes.caption,
    },
  });