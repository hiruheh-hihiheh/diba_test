// src/components/ui/ScreenHeader.tsx
//
// Content-level page intro. The shell app bar names the section; this block
// adds the useful part — context ("12 bills · 3 workbooks"), a short
// explanation when a screen needs one, and the primary action.
import React, { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface ScreenHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** Right-aligned action node (usually a button). */
  right?: React.ReactNode;
  /** Rendered under the title row, full width. */
  below?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  right,
  below,
  style,
}: ScreenHeaderProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <View style={styles.text}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {below ? <View style={styles.below}>{below}</View> : null}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: { marginBottom: theme.spacing.lg },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing.md,
    },
    text: { flex: 1, minWidth: 0 },
    eyebrow: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.caption,
      fontWeight: "700",
      letterSpacing: 1.3,
      marginBottom: 5,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xl,
      fontWeight: "800",
      letterSpacing: -0.6,
      lineHeight: 31,
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 19,
      marginTop: 5,
    },
    right: { paddingTop: 2 },
    below: { marginTop: theme.spacing.md },
  });
