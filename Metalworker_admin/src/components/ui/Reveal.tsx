// src/components/ui/Reveal.tsx
//
// A tiny entrance animation for content that appears after a load or a screen
// focus: a short fade plus a 10pt lift. Deliberately fast (under 300ms) and
// native-driven so it never competes with scrolling. Reduced-motion users see
// the content immediately.
import React, { useEffect, useMemo, useState } from "react";
import { Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

import { useReducedMotion } from "../../hooks/useReducedMotion";

interface RevealProps {
  children: React.ReactNode;
  /** Delay in ms — stagger list items by a few dozen ms at most. */
  delay?: number;
  /** Distance in points the content travels upwards. */
  offset?: number;
  style?: StyleProp<ViewStyle>;
}

export function Reveal({ children, delay = 0, offset = 10, style }: RevealProps) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced]);

  const animatedStyle = useMemo(
    () => ({
      opacity: progress,
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [offset, 0],
          }),
        },
      ],
    }),
    [offset, progress]
  );

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
