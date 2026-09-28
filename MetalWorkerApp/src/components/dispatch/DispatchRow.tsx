import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import { theme } from "../../constants/theme";
import type { TranslationDictionary } from "../../constants/translations";
import {
  getMaterialLabelKey,
  getStatusLabelKey,
  type Dispatch,
} from "../../services/dispatch";
import { stampLabel } from "../../utils/dateFormat";
import { StatusPill } from "../ui/StatusPill";

interface DispatchRowProps {
  dispatch: Dispatch;
  t: TranslationDictionary;
  now: Date;
  onPress?: (dispatch: Dispatch) => void;
}

/**
 * One row, used by both the dashboard's recent list and the full history list.
 * The dashboard's rows used to be inert `View`s, so a worker had no way to
 * check a status, a photo or a location.
 *
 * `memo` matters here: the history list re-renders on every keystroke in the
 * search box, and re-decoding every thumbnail while typing is what makes a
 * long list feel broken.
 */
export const DispatchRow = memo(function DispatchRow({
  dispatch,
  t,
  now,
  onPress,
}: DispatchRowProps) {
  const labels = {
    submitted: t.status_submitted,
    reviewed: t.status_reviewed,
    approved: t.status_approved,
    rejected: t.status_rejected,
  } as const;

  const material = t[getMaterialLabelKey(dispatch.material_type)];
  const vehicle = dispatch.vehicle_number;
  const stamp = stampLabel(dispatch.submitted_at, now, { today: t.today, yesterday: t.yesterday });

  const body = (
    <>
      <Image
        source={{ uri: dispatch.photo_url }}
        style={styles.thumb}
        // A 56pt thumbnail must not decode a 12MP photo. expo-image handles
        // downsampling for us; the explicit size keeps the cache key stable.
        contentFit="cover"
        transition={120}
        cachePolicy="memory-disk"
        accessibilityLabel={t.photo_label}
      />

      <View style={styles.middle}>
        <Text style={styles.vehicle} numberOfLines={1}>
          {vehicle}
        </Text>
        <Text style={styles.material} numberOfLines={1}>
          {material}
        </Text>
        <Text style={styles.stamp} numberOfLines={1}>
          {stamp}
        </Text>
      </View>

      <View style={styles.right}>
        <StatusPill status={dispatch.status} labels={labels} />
      </View>
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;

  return (
    <Pressable
      onPress={() => onPress(dispatch)}
      accessibilityRole="button"
      accessibilityLabel={t.open_dispatch.replace("{vehicle}", vehicle)}
      accessibilityHint={material}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {body}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm + 2,
    // Guarantees a comfortable target even for a single short line.
    minHeight: 78,
  },
  rowPressed: { backgroundColor: theme.colors.primaryLight, borderColor: theme.colors.primary },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.border,
  },
  middle: { flex: 1, minWidth: 0 },
  vehicle: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
  },
  material: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.text,
    marginTop: 1,
  },
  stamp: {
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  right: { alignItems: "flex-end", justifyContent: "center" },
});
