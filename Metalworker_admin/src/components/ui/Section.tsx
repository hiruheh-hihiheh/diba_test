// src/components/ui/Section.tsx
//
// Section heading used to group content within a screen: an optional overline,
// a title, a supporting line and one quiet text action on the right. It is the
// content-level counterpart to the shell's app bar.
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Icon } from "./Icon";

interface SectionProps {
  title: string;
  overline?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function Section({
  title,
  overline,
  subtitle,
  actionLabel,
  onAction,
  right,
  style,
  children,
}: SectionProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.head}>
        <View style={styles.headText}>
          {overline ? <Text style={styles.overline}>{overline.toUpperCase()}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ??
          (actionLabel && onAction ? (
            <Pressable
              onPress={onAction}
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              hitSlop={8}
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.actionText}>{actionLabel}</Text>
              <Icon name="chevronRight" size={14} color={theme.colors.primary} strokeWidth={2} />
            </Pressable>
          ) : null)}
      </View>
      {children}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: {},
    head: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: theme.spacing.md,
      marginBottom: theme.spacing.sm + 2,
    },
    headText: { flex: 1 },
    overline: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      fontWeight: "700",
      letterSpacing: 1.2,
      marginBottom: 3,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      letterSpacing: -0.3,
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },
    action: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4 },
    actionText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
  });
