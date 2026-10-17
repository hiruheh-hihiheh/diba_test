// src/hooks/useReducedMotion.ts
//
// Respect the OS "reduce motion" preference. Animation-heavy surfaces read this
// once and either skip or shorten their transitions, so the redesign never
// fights an accessibility setting.
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduced(value);
      })
      .catch(() => {
        /* Older platforms may not implement it; motion stays enabled. */
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => setReduced(value)
    );

    return () => {
      alive = false;
      subscription?.remove();
    };
  }, []);

  return reduced;
}
