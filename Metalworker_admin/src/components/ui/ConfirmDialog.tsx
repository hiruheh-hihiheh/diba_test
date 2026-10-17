// src/components/ui/ConfirmDialog.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { Icon, type IconName } from "./Icon";

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** Defaults to a warning triangle for destructive, an info mark otherwise. */
  icon?: IconName;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Cross-platform confirmation dialog.
 *
 * `Alert.alert` is not implemented on web, so destructive confirmations must
 * be a Modal shared by web and native. Android hardware-back is handled via
 * `onRequestClose` (cancels the dialog unless an operation is in flight).
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  busy = false,
  icon,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const reduced = useReducedMotion();

  // Subtle scale-in so the dialog feels sprung rather than snapped.
  const [scale] = useState(() => new Animated.Value(0.94));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    if (reduced) {
      scale.setValue(1);
      opacity.setValue(1);
      return;
    }
    scale.setValue(0.94);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 9,
        tension: 180,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: theme.motion.fast,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, scale, opacity, theme.motion.fast, reduced]);

  const tone = destructive ? theme.colors.danger : theme.colors.primary;
  const iconName: IconName = icon ?? (destructive ? "alert" : "info");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
    >
      <View style={styles.backdrop}>
        {/* Tapping the scrim cancels, unless a destructive operation is in
            flight and accidental dismissal would hide the outcome. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={busy ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
        />
        <Animated.View
          style={[styles.card, { opacity, transform: [{ scale }] }]}
          accessibilityViewIsModal
        >
          <View style={[styles.iconBubble, { backgroundColor: destructive ? theme.colors.dangerMuted : theme.colors.primaryMuted }]}>
            <Icon name={iconName} size={22} color={tone} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              disabled={busy}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.button,
                styles.cancelBtn,
                pressed && styles.pressed,
                busy && styles.dimmed,
              ]}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              accessibilityState={{ disabled: busy, busy }}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: destructive ? theme.colors.danger : theme.colors.primary },
                pressed && styles.pressed,
                busy && styles.dimmed,
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 400,
      backgroundColor: theme.colors.surfaceRaised,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 22,
      ...theme.elevation.overlay,
    },
    iconBubble: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing.md,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      letterSpacing: -0.3,
      marginBottom: 6,
    },
    message: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
      marginBottom: 22,
    },
    actions: { flexDirection: "row", gap: theme.spacing.sm },
    button: {
      flex: 1,
      minHeight: 48,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing.md,
    },
    cancelBtn: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: theme.colors.borderStrong,
    },
    cancelText: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "600",
    },
    confirmText: {
      color: "#FFFFFF",
      fontSize: theme.textSizes.md,
      fontWeight: "700",
    },
    dimmed: { opacity: 0.7 },
    pressed: { opacity: 0.82 },
  });
