// src/components/ui/EmptyState.tsx
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Reveal } from "./Reveal";
import { Icon, type IconName } from "./Icon";

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: string;
  /** Optional action node (e.g. a Button) rendered under the message. */
  action?: React.ReactNode;
  /** `compact` fits inside a card; the default is a full-screen placeholder. */
  compact?: boolean;
}

/** Consistent "nothing here yet" placeholder used across list screens. */
export function EmptyState({
  icon = "layers",
  title,
  message,
  action,
  compact = false,
}: EmptyStateProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Reveal style={[styles.wrap, compact && styles.compact]}>
      <View style={styles.iconRing}>
        <View style={styles.iconBubble}>
          <Icon name={icon} size={26} color={theme.colors.primary} strokeWidth={1.6} />
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </Reveal>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: {
      alignItems: "center",
      paddingVertical: theme.spacing.xl + 4,
      paddingHorizontal: theme.spacing.lg,
    },
    compact: { paddingVertical: theme.spacing.xl },
    iconRing: {
      padding: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing.md,
    },
    iconBubble: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      marginBottom: 5,
      textAlign: "center",
    },
    message: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
      lineHeight: 19,
      maxWidth: 320,
    },
    action: { marginTop: theme.spacing.lg, alignSelf: "stretch" },
  });
