import { useEffect, useRef } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";
import { Button } from "./Button";

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  /** Must state the real consequence, not just "Are you sure?". */
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  /** Shows a spinner on the confirm button and blocks further presses. */
  busy?: boolean;
}

/**
 * Replaces `Alert.alert` for anything destructive.
 *
 * The native alert cannot be styled, cannot explain a consequence, and on
 * Android a worker who taps the wrong edge of the dialog loses work without
 * being told what they just threw away.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
  busy = false,
}: ConfirmDialogProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android hardware back and an outside tap both mean "no".
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={busy ? undefined : onCancel}
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
      >
        {/* Swallow taps inside the card so they do not dismiss the dialog. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.body}>{body}</Text>

          <View style={styles.actions}>
            <Button
              title={cancelLabel}
              onPress={onCancel}
              variant="outline"
              disabled={busy}
              style={styles.action}
            />
            <Button
              title={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? "danger" : "primary"}
              loading={busy}
              disabled={busy}
              style={styles.action}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  title: {
    fontSize: theme.textSizes.lg,
    fontWeight: "800",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  body: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.text,
    lineHeight: 21,
    marginBottom: theme.spacing.lg,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  action: { flex: 1 },
});
