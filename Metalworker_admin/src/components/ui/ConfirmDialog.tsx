// src/components/ui/ConfirmDialog.tsx
import React, { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // Subtle scale-in so the dialog feels sprung rather than snapped.
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      scale.setValue(0.92);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          friction: 8,
          tension: 80,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: theme.motion.fast,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, scale, opacity, theme.motion.fast]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[styles.card, { opacity, transform: [{ scale }] }]}
        >
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              disabled={busy}
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                styles.cancelBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              style={({ pressed }) => [
                styles.button,
                destructive ? styles.dangerBtn : styles.confirmBtn,
                pressed && styles.pressed,
                busy && styles.busyBtn,
              ]}
            >
              <Text style={styles.confirmText}>
                {busy ? "Working…" : confirmLabel}
              </Text>
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
      maxWidth: 420,
      backgroundColor: theme.colors.surfaceRaised,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      ...theme.elevation.raised,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      marginBottom: theme.spacing.xs,
    },
    message: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
      marginBottom: theme.spacing.lg,
    },
    actions: {
      flexDirection: "row",
      gap: theme.spacing.sm,
    },
    button: {
      flex: 1,
      minHeight: 48,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.spacing.md,
    },
    cancelBtn: {
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    cancelText: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "600",
    },
    dangerBtn: {
      backgroundColor: theme.colors.danger,
    },
    confirmBtn: {
      backgroundColor: theme.colors.primary,
    },
    confirmText: {
      color: theme.colors.primaryButtonText,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
    },
    busyBtn: {
      opacity: 0.6,
    },
    pressed: {
      opacity: 0.85,
    },
  });