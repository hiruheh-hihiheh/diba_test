import { StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";
import type { TranslationDictionary } from "../../constants/translations";

/**
 * A persistent bar, not a toast: while the connection is down the worker needs
 * to keep reading it, because it changes what they can do.
 */
export function NetworkBanner({ t }: { t: TranslationDictionary }) {
  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={styles.dot} />
      <Text style={styles.text}>{t.offline_banner}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.sm + 2,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#B45309",
  },
  text: {
    flex: 1,
    color: "#92400E",
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    lineHeight: 16,
  },
});
