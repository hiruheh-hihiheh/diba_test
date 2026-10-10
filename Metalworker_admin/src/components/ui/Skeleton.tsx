// src/components/ui/Skeleton.tsx
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface SkeletonProps {
  /** Height of the block. Width defaults to 100% of the parent. */
  height?: number;
  /** Optional width (e.g. "60%" or 120). */
  width?: number | `${number}%`;
  /** Corner radius. Defaults to a soft rounded block. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Pulsing placeholder block shown while a screen is loading. Uses a gentle
 * opacity loop on the native driver so it never blocks the JS thread.
 */
export function Skeleton({ height = 16, width = "100%", radius = 8, style }: SkeletonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: theme.motion.slow,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: theme.motion.slow,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, theme.motion.slow]);

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[
        styles.block,
        { height, width, borderRadius: radius, opacity: pulse },
        style,
      ]}
    />
  );
}

/** A typical multi-line skeleton used while lists load. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <View style={styles.rows}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={64} style={styles.row} />
      ))}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    block: {
      backgroundColor: theme.colors.surfaceHover,
    },
  });

const styles = StyleSheet.create({
  rows: {
    gap: 12,
  },
  row: {
    width: "100%",
  },
});