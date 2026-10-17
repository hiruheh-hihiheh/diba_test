// src/components/ui/PressableScale.tsx
//
// Press feedback with a real spring instead of a hard opacity jump. Used on
// cards, tiles and rows where a physical "press" reinforces tappability.
//
// Important: the pressable element itself stays on top and owns
// accessibility/role/focus behaviour, so screen readers and web keyboard focus
// are unaffected by the animation wrapper.
import React, { useMemo, useState } from "react";
import {
  Animated,
  Pressable,
  type AccessibilityRole,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useReducedMotion } from "../../hooks/useReducedMotion";

interface PressableScaleProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Final scale while pressed. Keep subtle: 0.96–0.98. */
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  hitSlop?: number | { top?: number; left?: number; right?: number; bottom?: number };
}

export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled = false,
  scaleTo = 0.975,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));

  const springTo = (value: number, opacityValue: number) => {
    if (reduced) return;
    Animated.parallel([
      Animated.spring(scale, {
        toValue: value,
        useNativeDriver: true,
        friction: 9,
        tension: 260,
      }),
      Animated.timing(opacity, {
        toValue: opacityValue,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const animatedStyle = useMemo(
    () => ({ transform: [{ scale }], opacity }),
    [opacity, scale]
  );

  return (
    <Animated.View style={[style, animatedStyle]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={() => springTo(scaleTo, 0.92)}
        onPressOut={() => springTo(1, 1)}
        disabled={disabled}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled, ...accessibilityState }}
        hitSlop={hitSlop}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
