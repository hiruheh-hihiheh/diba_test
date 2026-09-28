import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";
import { useLanguage } from "../../contexts/LanguageContext";
import { LanguageSwitch } from "./LanguageSwitch";

interface AppHeaderProps {
  /** Required unless `name` is given, e.g. on the greeting-style dashboards. */
  title?: string;
  subtitle?: string;
  /** Renders a 48dp back control on the left. */
  onBack?: () => void;
  backLabel?: string;
  /** Rendered on the right, usually the language switch. */
  right?: ReactNode;
  /** Large greeting block used on the two dashboards. */
  greeting?: string;
  name?: string;
}

export function AppHeader({
  title,
  subtitle,
  onBack,
  backLabel,
  right,
  greeting,
  name,
}: AppHeaderProps) {
  const { t } = useLanguage();
  const back = backLabel ?? t.back;

  return (
    <View style={styles.wrap}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={back}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <Text style={styles.backText} numberOfLines={1}>
            ← {back}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.main}>
        {greeting ? <Text style={styles.greeting}>{greeting},</Text> : null}
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {name ?? title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right === undefined ? <LanguageSwitch /> : right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  back: {
    // Was `padding: 8` -> 68x37. Now a real 48dp target.
    minHeight: 48,
    minWidth: 48,
    paddingRight: theme.spacing.sm,
    justifyContent: "center",
  },
  backPressed: { opacity: 0.6 },
  backText: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  main: { flex: 1, minWidth: 0 },
  greeting: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    marginBottom: 2,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginTop: 2,
    lineHeight: 18,
  },
});
