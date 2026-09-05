import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";

interface ActionCardProps {
  title: string;
  subtitle: string;
  icon: string;
  primary?: boolean;
  onPress: () => void;
}

export function ActionCard({
  title,
  subtitle,
  icon,
  primary = false,
  onPress,
}: ActionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.card,
        primary && styles.primaryCard,
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.iconContainer,
          primary && styles.primaryIconContainer,
        ]}
      >
        <Text style={[styles.icon, primary && styles.primaryIcon]}>
          {icon}
        </Text>
      </View>

      <View style={styles.textContainer}>
        <Text style={[styles.title, primary && styles.primaryTitle]}>
          {title}
        </Text>

        <Text style={[styles.subtitle, primary && styles.primarySubtitle]}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "48%",
    minHeight: 135,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    alignItems: "flex-start",
    justifyContent: "center",
    marginBottom: theme.spacing.md,
  },

  primaryCard: {
    width: "100%",
    minHeight: 155,
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing.lg,
  },

  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },

  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: `${theme.colors.primary}20`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.sm,
  },

  primaryIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 0,
    marginRight: theme.spacing.md,
  },

  icon: {
    fontSize: 25,
  },

  primaryIcon: {
    fontSize: 30,
  },

  textContainer: {
    flex: 1,
  },

  title: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: 4,
  },

  primaryTitle: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.lg,
  },

  subtitle: {
    fontSize: theme.textSizes.sm,
    lineHeight: 20,
    color: theme.colors.textMuted,
  },

  primarySubtitle: {
    color: "rgba(255,255,255,0.85)",
  },
});

