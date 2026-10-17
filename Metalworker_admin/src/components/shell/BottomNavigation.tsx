// src/components/shell/BottomNavigation.tsx
//
// Fixed bottom bar with the five high-frequency destinations (Home, Jobs,
// Bills, Folders, More). It sits in normal layout flow below the content area,
// so screen content is never hidden behind it.
//
// The active destination lifts into a copper-tinted pill; Jobs and More open
// sheets and keep the tab lit while their sheet is open.
import React, { memo, useEffect, useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import {
  BOTTOM_TABS,
  type BottomTab,
  type BottomTabKey,
} from "../../navigation/navigationConfig";
import { Icon } from "../ui/Icon";

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
  const reduced = useReducedMotion();
  const [lift] = useState(() => new Animated.Value(active ? 1 : 0));

  useEffect(() => {
    if (reduced) {
      lift.setValue(active ? 1 : 0);
      return;
    }
    Animated.spring(lift, {
      toValue: active ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
      tension: 160,
    }).start();
  }, [active, lift, reduced]);

  const iconScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const iconLift = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });
  const color = active ? theme.colors.primary : theme.colors.textMuted;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
    >
      <Animated.View
        style={[
          styles.iconPill,
          { backgroundColor: active ? theme.colors.primarySoft : "transparent" },
        ]}
      >
        <Animated.View style={{ transform: [{ scale: iconScale }, { translateY: iconLift }] }}>
          <Icon name={tab.icon} size={21} color={color} strokeWidth={active ? 2 : 1.7} />
        </Animated.View>
      </Animated.View>
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          {
            color,
            fontWeight: active ? "700" : "500",
          },
        ]}
      >
        {tab.label}
      </Text>
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
      paddingTop: 2,
      paddingBottom: 2,
      minHeight: 50,
      gap: 2,
    },
    tabPressed: { opacity: 0.65 },
    iconPill: {
      width: 50,
      height: 27,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    label: {
      fontSize: 10,
      letterSpacing: 0.1,
    },
  });
