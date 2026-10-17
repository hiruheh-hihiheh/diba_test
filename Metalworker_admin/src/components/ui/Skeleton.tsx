// src/components/ui/Skeleton.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";

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
 * opacity loop on the native driver so it never blocks the JS thread, and
 * freezes at a readable middle opacity when reduce-motion is on.
 */
export function Skeleton({ height = 16, width = "100%", radius = 8, style }: SkeletonProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0.55));

  useEffect(() => {
    if (reduced) {
      pulse.setValue(0.55);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: theme.motion.slow + 120,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: theme.motion.slow + 120,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced, theme.motion.slow]);

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

/** Rounded card-shaped placeholder with a few text lines. */
export function SkeletonCard({ lines = 2, height }: { lines?: number; height?: number }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.md,
        marginBottom: theme.spacing.sm + 2,
        gap: 10,
        minHeight: height,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Skeleton height={36} width={36} radius={12} />
        <View style={{ flex: 1, gap: 6 }}>
          <Skeleton height={11} width="62%" radius={4} />
          <Skeleton height={9} width="38%" radius={4} />
        </View>
      </View>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={9} width={i === lines - 1 ? "70%" : "92%"} radius={4} />
      ))}
    </View>
  );
}

/** A typical multi-block skeleton used while lists load. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <View style={styles.rows}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
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
    gap: 4,
  },
});
