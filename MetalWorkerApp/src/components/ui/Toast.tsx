import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "../../constants/theme";

type Tone = "success" | "error" | "info";

interface ToastPayload {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastContextValue {
  show: (message: string, tone?: Tone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VISIBLE_MS = 3200;

const ICONS: Record<Tone, string> = { success: "✓", error: "!", info: "i" };

/**
 * One toast for the whole app so confirmations read the same everywhere, and
 * so a success message is never just a screen swap the worker may not notice.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const counter = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      setToast(null);
    });
  }, [anim, clearTimer]);

  const show = useCallback(
    (message: string, tone: Tone = "info") => {
      if (!message) return;
      clearTimer();
      counter.current += 1;
      setToast({ id: counter.current, message, tone });
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, VISIBLE_MS);
    },
    [anim, clearTimer, hide],
  );

  // Never leave a timer running after the provider unmounts.
  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m: string) => show(m, "success"),
      error: (m: string) => show(m, "error"),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastView toast={toast} anim={anim} onHide={hide} />
    </ToastContext.Provider>
  );
}

function ToastView({
  toast,
  anim,
  onHide,
}: {
  toast: ToastPayload | null;
  anim: Animated.Value;
  onHide: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!toast) return null;

  return (
    <Animated.View
      // Sits below the status bar, above the gesture bar, and never blocks taps.
      style={[
        styles.wrap,
        {
          top: insets.top + theme.spacing.sm,
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }),
            },
          ],
        },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onHide}
        accessibilityRole="alert"
        accessibilityLabel={toast.message}
        style={[
          styles.toast,
          toast.tone === "success"
            ? styles.success
            : toast.tone === "error"
              ? styles.error
              : styles.info,
        ]}
      >
        <Text style={styles.icon}>{ICONS[toast.tone]}</Text>
        <Text style={styles.text} accessibilityLiveRegion="polite">
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: theme.spacing.md,
    right: theme.spacing.md,
    zIndex: 100,
    elevation: 24,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  info: { backgroundColor: theme.colors.text },
  success: { backgroundColor: theme.colors.primary },
  error: { backgroundColor: theme.colors.danger },
  icon: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    width: 18,
    textAlign: "center",
  },
  text: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    lineHeight: 19,
  },
});
