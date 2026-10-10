// src/components/ui/EmptyState.tsx
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  /** Optional action node (e.g. a Button) rendered under the message. */
  action?: React.ReactNode;
}

/** Consistent "nothing here yet" placeholder used across list screens. */
export function EmptyState({ icon = "🗂️", title, message, action }: EmptyStateProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrap}>
      {icon ? (
        <View style={styles.iconBubble}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: {
      alignItems: "center",
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
    },
    iconBubble: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: theme.colors.surfaceHover,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing.md,
    },
    icon: {
      fontSize: 28,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      marginBottom: 4,
      textAlign: "center",
    },
    message: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
      lineHeight: 20,
    },
    action: {
      marginTop: theme.spacing.md,
    },
  });