import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";

interface ActionCardProps {
  title: string;
  subtitle: string;
  icon: string;
  primary?: boolean;
  onPress?: () => void;
  /**
   * A card for a feature that is not built yet. It stays visible so the app
   * does not hide its shape from the user, but it is announced as unavailable
   * and cannot be pressed — previously these opened a "Coming Soon" alert,
   * which is three taps to learn nothing.
   */
  comingSoon?: boolean;
  comingSoonLabel?: string;
}

export function ActionCard({
  title,
  subtitle,
  icon,
  primary = false,
  onPress,
  comingSoon = false,
  comingSoonLabel,
}: ActionCardProps) {
  const disabled = comingSoon || !onPress;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={disabled ? comingSoonLabel ?? subtitle : subtitle}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.card,
        primary && styles.primaryCard,
        disabled && styles.disabledCard,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={[styles.iconContainer, primary && styles.primaryIconContainer]}>
        <Text style={[styles.icon, primary && styles.primaryIcon]}>{icon}</Text>
      </View>

      <View style={styles.textContainer}>
        <Text style={[styles.title, primary && styles.primaryTitle]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.subtitle, primary && styles.primarySubtitle]} numberOfLines={2}>
          {comingSoon && comingSoonLabel ? comingSoonLabel : subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    // A flexible basis rather than a fixed percentage: `width: "48%"` with three
    // children in a row made flexbox shrink all three to 33% each, which
    // crushed the Hindi labels. This keeps two comfortable columns at 360dp and
    // lets a lone trailing card fill the row.
    flexGrow: 1,
    flexBasis: 148,
    minWidth: 0,
    minHeight: 132,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  primaryCard: {
    flexBasis: "100%",
    width: "100%",
    minHeight: 116,
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  disabledCard: { opacity: 0.55, backgroundColor: theme.colors.surface },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.sm,
  },
  primaryIconContainer: { backgroundColor: "#FFFFFF33" },
  icon: { fontSize: 22 },
  primaryIcon: {},
  textContainer: { flex: 1 },
  title: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
  },
  primaryTitle: { color: "#FFFFFF" },
  subtitle: {
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
    marginTop: 3,
    lineHeight: 15,
  },
  primarySubtitle: { color: "#FFFFFFDD" },
});
