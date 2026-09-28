import { StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";
import type { DispatchStatus } from "../../services/dispatch";

interface StatusPillProps {
  status: DispatchStatus;
  /** `compact` is the dashboard row badge; `full` is the detail screen. */
  size?: "compact" | "full";
  labels: Record<DispatchStatus, string>;
}

/** One status chip for the whole app. Colour is never the only signal. */
export function StatusPill({ status, size = "compact", labels }: StatusPillProps) {
  const tone = TONES[status];
  return (
    <View
      style={[
        styles.pill,
        size === "full" && styles.pillFull,
        { backgroundColor: tone.bg, borderColor: tone.border },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tone.fg }]} />
      <Text
        style={[styles.text, size === "full" && styles.textFull, { color: tone.fg }]}
        numberOfLines={1}
      >
        {labels[status]}
      </Text>
    </View>
  );
}

const TONES: Record<DispatchStatus, { bg: string; fg: string; border: string }> = {
  // Amber/blue rather than a flat grey so "in review" is distinguishable at a glance.
  submitted: { bg: "#FEF3C7", fg: "#92400E", border: "#FDE68A" },
  reviewed: { bg: "#DBEAFE", fg: "#1E40AF", border: "#BFDBFE" },
  approved: { bg: theme.colors.primaryLight, fg: "#065F46", border: "#A7F3D0" },
  rejected: { bg: "#FEE2E2", fg: "#991B1B", border: "#FECACA" },
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillFull: { paddingHorizontal: 12, paddingVertical: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  textFull: { fontSize: theme.textSizes.sm },
});
