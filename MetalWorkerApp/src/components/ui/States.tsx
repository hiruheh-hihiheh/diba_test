import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";
import { Button } from "./Button";

/** Full-area spinner with a label, for a whole screen that has nothing yet. */
export function LoadingState({ label, compact = false }: { label?: string; compact?: boolean }) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]} accessibilityRole="progressbar">
      <ActivityIndicator size={compact ? "small" : "large"} color={theme.colors.primary} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

interface EmptyStateProps {
  icon?: string;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      {icon ? <Text style={styles.emptyIcon}>{icon}</Text> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} variant="outline" style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

interface ErrorStateProps {
  title?: string;
  body: string;
  /** Omitted when retrying could not possibly help (404 / permission). */
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel,
  retrying = false,
  secondaryLabel,
  onSecondary,
}: ErrorStateProps) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.errorIcon}>⚠️</Text>
      {title ? <Text style={styles.errorTitle}>{title}</Text> : null}
      <Text style={styles.errorBody}>{body}</Text>
      {onRetry || onSecondary ? (
        <View style={styles.errorActions}>
          {onRetry ? (
            <Button
              title={retryLabel ?? "Try again"}
              onPress={onRetry}
              loading={retrying}
              disabled={retrying}
              style={styles.errorButton}
            />
          ) : null}
          {onSecondary && secondaryLabel ? (
            <Button
              title={secondaryLabel}
              onPress={onSecondary}
              variant="outline"
              style={styles.errorButton}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.background,
  },
  wrapCompact: { flex: 0, paddingVertical: theme.spacing.lg, paddingHorizontal: 0 },
  label: {
    marginTop: theme.spacing.md,
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
  },
  empty: {
    alignItems: "center",
    paddingVertical: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: theme.spacing.sm,
  },
  emptyTitle: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
    textAlign: "center",
  },
  emptyBody: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    textAlign: "center",
    marginTop: theme.spacing.xs,
    lineHeight: 20,
  },
  emptyAction: {
    marginTop: theme.spacing.lg,
    alignSelf: "center",
    paddingHorizontal: theme.spacing.xl,
  },
  error: {
    backgroundColor: theme.colors.danger + "12",
    borderWidth: 1,
    borderColor: theme.colors.danger + "33",
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    alignItems: "center",
  },
  errorIcon: { fontSize: 26, marginBottom: theme.spacing.xs },
  errorTitle: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 4,
  },
  errorBody: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.text,
    textAlign: "center",
    lineHeight: 20,
  },
  errorActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  errorButton: { minWidth: 132 },
});
