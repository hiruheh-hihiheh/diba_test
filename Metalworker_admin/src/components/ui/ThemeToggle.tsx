// src/components/ui/ThemeToggle.tsx
//
// A compact sun/moon switch. The knob translates between the two glyphs and
// the whole control springs slightly on press, so the state change is felt as
// well as seen.
import React, { useEffect, useMemo, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { Icon } from "./Icon";

const WIDTH = 52;
const HEIGHT = 30;
const PAD = 3;
const KNOB = HEIGHT - PAD * 2;

export function ThemeToggle({ size: _size }: { size?: number }) {
  const { themeMode, toggleTheme, theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduced = useReducedMotion();
  const isDark = themeMode === "dark";
  const [progress] = useState(() => new Animated.Value(isDark ? 0 : 1));
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduced) {
      progress.setValue(isDark ? 0 : 1);
      return;
    }
    Animated.spring(progress, {
      toValue: isDark ? 0 : 1,
      useNativeDriver: true,
      friction: 9,
      tension: 140,
    }).start();
  }, [isDark, progress, reduced]);

  const knobX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, WIDTH - KNOB - PAD * 2],
  });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={toggleTheme}
        onPressIn={() =>
          Animated.spring(scale, {
            toValue: 0.94,
            useNativeDriver: true,
            friction: 9,
            tension: 300,
          }).start()
        }
        onPressOut={() =>
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            friction: 9,
            tension: 300,
          }).start()
        }
        accessibilityRole="switch"
        accessibilityLabel="Dark theme"
        accessibilityState={{ checked: isDark }}
        hitSlop={10}
        style={styles.track}
      >
        <View style={styles.iconSlot}>
          <Icon name="sun" size={12} color={theme.colors.textMuted} strokeWidth={2} />
        </View>
        <View style={styles.iconSlot}>
          <Icon name="moon" size={12} color={theme.colors.textMuted} strokeWidth={2} />
        </View>
        <Animated.View
          style={[
            styles.knob,
            {
              transform: [{ translateX: knobX }],
            },
          ]}
        >
          <Icon
            name={isDark ? "moon" : "sun"}
            size={13}
            color={theme.colors.primaryButtonText}
            strokeWidth={2}
          />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    track: {
      width: WIDTH,
      height: HEIGHT,
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceHover,
      borderWidth: 1,
      borderColor: theme.colors.border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 8,
      overflow: "hidden",
    },
    iconSlot: { width: 12, alignItems: "center", justifyContent: "center" },
    knob: {
      position: "absolute",
      left: PAD,
      top: PAD,
      width: KNOB,
      height: KNOB,
      borderRadius: KNOB / 2,
      backgroundColor: theme.colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
  });
