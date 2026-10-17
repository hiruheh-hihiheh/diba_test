// src/components/ui/ListRow.tsx
//
// A dense, scannable row: icon bubble, title + optional meta, a trailing value
// and chevron. Used for overview counts, settings shortcuts and menus where a
// full card would be too heavy.
import React, { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Icon, type IconName } from "./Icon";
import { PressableScale } from "./PressableScale";

interface ListRowProps {
  title: string;
  icon?: IconName;
  subtitle?: string;
  value?: string;
  iconColor?: string;
  /** Shows a chevron on the right when tappable. */
  onPress?: () => void;
  accessibilityLabel?: string;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Hairline under the row; on by default for stacked rows. */
  divider?: boolean;
}

export function ListRow({
  title,
  icon,
  subtitle,
  value,
  iconColor,
  onPress,
  accessibilityLabel,
  trailing,
  style,
  divider = false,
}: ListRowProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tint = iconColor ?? theme.colors.primary;

  const content = (
    <View style={styles.row}>
      {icon ? (
        <View style={[styles.iconBubble, { backgroundColor: theme.colors.surfaceHover }]}>
          <Icon name={icon} size={17} color={tint} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {trailing}
      {onPress && !trailing ? (
        <Icon name="chevronRight" size={15} color={theme.colors.textMuted} />
      ) : null}
    </View>
  );

  return (
    <View
      style={[
        styles.wrap,
        divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
        style,
      ]}
    >
      {onPress ? (
        <PressableScale
          onPress={onPress}
          accessibilityLabel={accessibilityLabel ?? title}
          style={styles.press}
        >
          {content}
        </PressableScale>
      ) : (
        content
      )}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: {},
    press: { borderRadius: theme.radius.md },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm + 2,
      paddingVertical: 10,
      minHeight: 52,
    },
    iconBubble: {
      width: 34,
      height: 34,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    text: { flex: 1, minWidth: 0 },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 1,
    },
    value: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
  });
