// src/components/ui/SegmentedControl.tsx
//
// Compact segmented control with a sliding indicator. Built for 2–4 short
// options (roles, status filters, list modes). Equal-width segments keep the
// indicator math trivial and the control thumb-sized on small phones.
import React, { useEffect, useMemo, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional count shown after the label. */
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Accessible name for the whole group. */
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

const PAD = 3;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedControlProps<T>) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const [progress] = useState(() => new Animated.Value(index));

  useEffect(() => {
    if (reduced) {
      progress.setValue(index);
      return;
    }
    Animated.spring(progress, {
      toValue: index,
      useNativeDriver: true,
      friction: 10,
      tension: 140,
    }).start();
  }, [index, progress, reduced]);

  const segmentWidth = width > 0 ? (width - PAD * 2) / options.length : 0;

  const translateX = useMemo(
    () =>
      width > 0
        ? Animated.multiply(progress, segmentWidth)
        : new Animated.Value(0),
    [progress, segmentWidth, width]
  );

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, style]}
    >
      {width > 0 ? (
        <Animated.View
          style={[
            styles.indicator,
            {
              width: segmentWidth,
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              option.count !== undefined
                ? `${option.label}, ${option.count}`
                : option.label
            }
            style={styles.segment}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: active ? theme.colors.text : theme.colors.textMuted },
                active && styles.labelActive,
              ]}
            >
              {option.label}
              {option.count !== undefined ? (
                <Text
                  style={[
                    styles.count,
                    { color: active ? theme.colors.primary : theme.colors.textMuted },
                  ]}
                >
                  {"  "}
                  {option.count}
                </Text>
              ) : null}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    track: {
      flexDirection: "row",
      padding: PAD,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.colors.border,
      minHeight: 44,
    },
    indicator: {
      position: "absolute",
      top: PAD,
      bottom: PAD,
      left: PAD,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.colors.border,
      ...theme.elevation.card,
    },
    segment: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 6,
      paddingVertical: 8,
      zIndex: 1,
    },
    label: { fontSize: theme.textSizes.sm, fontWeight: "600" },
    labelActive: { fontWeight: "700" },
    count: { fontSize: theme.textSizes.caption, fontWeight: "700" },
  });
