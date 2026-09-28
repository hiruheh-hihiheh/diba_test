import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";

import { AppHeader } from "../../components/ui/AppHeader";
import { Card, Section } from "../../components/ui/Card";
import { NetworkBanner } from "../../components/ui/NetworkBanner";
import { Screen } from "../../components/ui/Screen";
import { StatusPill } from "../../components/ui/StatusPill";
import { ErrorState, LoadingState } from "../../components/ui/States";
import { useToast } from "../../components/ui/Toast";
import { SessionGate } from "../../components/SessionGate";
import { theme } from "../../constants/theme";
import { useLanguage } from "../../contexts/LanguageContext";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { fetchDispatchById, getMaterialLabelKey, type Dispatch } from "../../services/dispatch";
import { fullStamp } from "../../utils/dateFormat";
import { readableError } from "../../utils/readableError";

/**
 * Review a single dispatch.
 *
 * This route did not exist at all. Every row on the dashboard was an inert
 * `View`, so a worker who wanted to check a photo, a location or a status after
 * the fact simply could not — the data was uploaded and then unreachable.
 */
export default function DispatchDetailRoute() {
  return (
    <SessionGate>
      <DispatchDetail />
    </SessionGate>
  );
}

function DispatchDetail() {
  const { t } = useLanguage();
  const { isOffline } = useNetworkStatus();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();

  const dispatchId = Array.isArray(id) ? id[0] : id;

  const [row, setRow] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!dispatchId) {
      setMissing(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setMissing(false);

    const result = await fetchDispatchById(dispatchId);

    // Backing out mid-request must not set state on an unmounted screen.
    if (!mounted.current) return;

    setLoading(false);
    if (!result.ok) {
      setError(readableError(result.error).message);
      return;
    }
    if (!result.data) {
      // Either it does not exist or it belongs to another worker — the query
      // is scoped by `worker_id`, so we cannot and should not say which.
      setMissing(true);
      return;
    }
    setRow(result.data);
  }, [dispatchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusLabels = {
    submitted: t.status_submitted,
    reviewed: t.status_reviewed,
    approved: t.status_approved,
    rejected: t.status_rejected,
  } as const;

  if (loading) {
    return (
      <Screen scroll={false} center>
        <AppHeader title={t.dispatch_details} onBack={() => router.back()} />
        <LoadingState label={t.loading} compact />
      </Screen>
    );
  }

  if (missing) {
    return (
      <Screen scroll>
        <AppHeader title={t.dispatch_details} onBack={() => router.back()} />
        <ErrorState
          title={t.dispatch_not_found}
          body={t.dispatch_not_found_body}
          onRetry={undefined}
          secondaryLabel={t.back}
          onSecondary={() => router.back()}
        />
      </Screen>
    );
  }

  if (error || !row) {
    return (
      <Screen scroll>
        <AppHeader title={t.dispatch_details} onBack={() => router.back()} />
        <ErrorState
          body={error ?? t.something_went_wrong}
          onRetry={load}
          retryLabel={t.retry}
          secondaryLabel={t.back}
          onSecondary={() => router.back()}
        />
      </Screen>
    );
  }

  const hasCoordinates = row.latitude !== null && row.longitude !== null;

  return (
    <Screen scroll>
      <AppHeader title={t.dispatch_details} onBack={() => router.back()} />

      {isOffline ? <NetworkBanner t={t} /> : null}

      <Card flush style={styles.photoCard}>
        <Image
          source={{ uri: row.photo_url }}
          style={styles.photo}
          contentFit="contain"
          transition={150}
          cachePolicy="memory-disk"
          accessibilityLabel={t.photo_label}
        />
      </Card>

      <View style={styles.statusRow}>
        <StatusPill status={row.status} size="full" labels={statusLabels} />
      </View>

      <Section title={t.vehicle_number}>
        <Card>
          <DetailRow label={t.vehicle_number} value={row.vehicle_number} />
          <DetailRow label={t.material_type} value={t[getMaterialLabelKey(row.material_type)]} />
          <DetailRow label={t.submitted_at_label} value={fullStamp(row.submitted_at)} />
        </Card>
      </Section>

      <Section title={t.location_label} hint={t.current_location}>
        <Card>
          {row.location_name ? (
            <DetailRow label={t.current_location} value={row.location_name} />
          ) : null}

          {hasCoordinates ? (
            <DetailRow
              label={t.location_label}
              value={`${row.latitude!.toFixed(5)}, ${row.longitude!.toFixed(5)}`}
              // Tapping coordinates opening a map is the single most useful
              // thing to do with a location; `geo:` is the Android-safe scheme
              // and `https://maps.google.com` covers desktop web and iOS.
              onPress={async () => {
                const target = `geo:${row.latitude},${row.longitude}?q=${row.latitude},${row.longitude}`;
                try {
                  const supported = await Linking.canOpenURL(target);
                  if (supported) {
                    await Linking.openURL(target);
                    return;
                  }
                  await Linking.openURL(
                    `https://maps.google.com/?q=${row.latitude},${row.longitude}`,
                  );
                } catch {
                  toast.show(t.something_went_wrong, "error");
                }
              }}
            />
          ) : (
            <Text style={styles.muted}>{t.not_recorded}</Text>
          )}
        </Card>
      </Section>
    </Screen>
  );
}

function DetailRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {onPress ? (
        <Text style={styles.rowValueLink} onPress={onPress} accessibilityRole="link">
          {value}
        </Text>
      ) : (
        <Text style={styles.rowValue}>{value}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photoCard: { overflow: "hidden", marginBottom: theme.spacing.md },
  photo: { width: "100%", height: 240, backgroundColor: theme.colors.border },
  statusRow: { marginBottom: theme.spacing.lg },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowLabel: { fontSize: theme.textSizes.xs, color: theme.colors.textMuted, fontWeight: "700" },
  rowValue: {
    flex: 1,
    fontSize: theme.textSizes.sm,
    color: theme.colors.text,
    fontWeight: "700",
    textAlign: "right",
  },
  rowValueLink: {
    flex: 1,
    fontSize: theme.textSizes.sm,
    color: theme.colors.primary,
    fontWeight: "700",
    textAlign: "right",
    textDecorationLine: "underline",
  },
  muted: { fontSize: theme.textSizes.sm, color: theme.colors.textMuted },
});
