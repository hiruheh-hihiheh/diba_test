import { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { theme } from "../../constants/theme";

interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Removes the inner padding for edge-to-edge content such as a photo. */
  flush?: boolean;
}

export function Card({ children, style, flush = false }: CardProps) {
  return <View style={[styles.card, !flush && styles.padded, style]}>{children}</View>;
}

interface SectionProps {
  title?: string;
  /** Small muted line under the title, e.g. "Added automatically when you submit". */
  hint?: string;
  /** Badge shown next to the title, e.g. "Required". */
  badge?: { label: string; tone: "required" | "optional" };
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Section({ title, hint, badge, children, style }: SectionProps) {
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {badge ? (
            <View
              style={[
                styles.badge,
                badge.tone === "required" ? styles.badgeRequired : styles.badgeOptional,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  badge.tone === "required" ? styles.badgeTextRequired : styles.badgeTextOptional,
                ]}
              >
                {badge.label}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  padded: {
    padding: theme.spacing.md,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  sectionTitle: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
  },
  sectionHint: {
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
    lineHeight: 16,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeRequired: {
    backgroundColor: theme.colors.danger + "18",
  },
  badgeOptional: {
    backgroundColor: theme.colors.textMuted + "1F",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  badgeTextRequired: { color: theme.colors.danger },
  badgeTextOptional: { color: theme.colors.textMuted },
});
