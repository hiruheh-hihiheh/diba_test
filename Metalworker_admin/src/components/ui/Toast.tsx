// src/components/ui/Toast.tsx
//
// In-app feedback toasts. Screens already call `notify(title, message)`; that
// helper now routes into this host, so success and failure messages appear as
// a themed, non-blocking banner instead of a native alert (which is a no-op on
// web and interrupts the user on native).
//
// The host is mounted once in the root layout. If it is not mounted (e.g. a
// notify call during early boot), `notify` falls back to the platform alert.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { Icon, type IconName } from "./Icon";

export type ToastTone = "success" | "error" | "info";

export interface ToastInput {
  title: string;
  message?: string;
  tone?: ToastTone;
  /** Auto-dismiss delay in ms. Errors stay longer than confirmations. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

type Listener = (toast: ToastItem) => void;

let listener: Listener | null = null;
let nextId = 1;

/** True while the toast host is mounted (used by notify's fallback path). */
export function hasToastHost(): boolean {
  return listener !== null;
}

export function showToast(input: ToastInput): void {
  if (!listener) return;
  listener({
    ...input,
    id: nextId++,
  });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listener = (toast) => {
      setItems((prev) => [...prev.slice(-1), toast]);
    };
    return () => {
      listener = null;
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.passThrough]}>
      <ToastStack items={items} onDismiss={dismiss} />
    </View>
  );
}

function ToastStack({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.stack, { top: insets.top + 10 }]}>
      {items.map((item) => (
        <ToastCard
          key={item.id}
          item={item}
          onDismiss={() => onDismiss(item.id)}
        />
      ))}
    </View>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (reduced) {
      onDismiss();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(() => onDismiss());
  }, [onDismiss, progress, reduced]);

  useEffect(() => {
    if (!reduced) {
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    const timer = setTimeout(close, item.duration ?? (item.tone === "error" ? 4600 : 3000));
    return () => clearTimeout(timer);
  }, [close, item.duration, item.tone, progress, reduced]);

  const tone = item.tone ?? "info";
  const toneColor =
    tone === "success"
      ? theme.colors.success
      : tone === "error"
      ? theme.colors.danger
      : theme.colors.info;
  const toneBg =
    tone === "success"
      ? theme.colors.successMuted
      : tone === "error"
      ? theme.colors.dangerMuted
      : theme.colors.infoMuted;
  const iconName: IconName =
    tone === "success" ? "checkCircle" : tone === "error" ? "alert" : "info";

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-16, 0],
              }),
            },
          ],
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Pressable
        onPress={close}
        accessibilityLabel="Dismiss notification"
        style={styles.press}
      >
        <View style={[styles.iconBubble, { backgroundColor: toneBg }]}>
          <Icon name={iconName} size={17} color={toneColor} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          {item.message ? (
            <Text style={styles.message} numberOfLines={3}>
              {item.message}
            </Text>
          ) : null}
        </View>
        <Icon name="close" size={13} color={theme.colors.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: "absolute",
    left: 14,
    right: 14,
    gap: 8,
    // Let taps fall through the empty space around the cards. `pointerEvents`
    // is a style property now; the prop form warns on web.
    pointerEvents: "box-none",
  },
  passThrough: {
    pointerEvents: "box-none",
  },
});

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    card: {
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
      backgroundColor: theme.colors.surfaceRaised,
      ...theme.elevation.raised,
    },
    press: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm + 2,
      padding: 12,
    },
    iconBubble: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    text: { flex: 1, minWidth: 0 },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    message: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      lineHeight: 16,
      marginTop: 2,
    },
  });
