// src/components/shell/BottomNavigation.tsx
//
// Fixed bottom bar with the five high-frequency destinations. It sits in the
// normal layout flow (never absolutely positioned), so screen content is never
// hidden behind it and no per-screen bottom padding is needed. The bottom
// inset keeps it clear of the iPhone home indicator / Android gesture bar.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../../context/ThemeContext";
import {
  BOTTOM_TABS,
  type BottomTabKey,
} from "../../navigation/navigationConfig";

interface BottomNavigationProps {
  activeTab: BottomTabKey | null;
  onSelect: (key: BottomTabKey) => void;
}

export function BottomNavigation({ activeTab, onSelect }: BottomNavigationProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, 6),
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      {BOTTOM_TABS.map((tab) => {
        const selected = tab.key === activeTab;
        const color = selected ? theme.colors.primary : theme.colors.textMuted;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            style={({ pressed }) => [
              styles.tab,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.icon, { color }]}>{tab.icon}</Text>
            <Text
              style={[
                styles.label,
                { color, fontWeight: selected ? "700" : "500" },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    minHeight: 56,
  },
  icon: {
    fontSize: 20,
  },
  label: {
    fontSize: 11,
    marginTop: 2,
  },
});