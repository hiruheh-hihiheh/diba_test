import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { theme } from "../../constants/theme";
import { greetingKeyFor } from "../../constants/translations";
import { useLanguage } from "../../contexts/LanguageContext";
import { useSession } from "../../contexts/SessionContext";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";
import { useDispatchList } from "../../hooks/useDispatchList";
import type { Dispatch } from "../../services/dispatch";
import { ActionCard } from "./ActionCard";
import { DispatchRow } from "../dispatch/DispatchRow";
import { AppHeader } from "../ui/AppHeader";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { NetworkBanner } from "../ui/NetworkBanner";
import { Screen } from "../ui/Screen";
import { EmptyState, ErrorState, LoadingState } from "../ui/States";
import { useToast } from "../ui/Toast";

const RECENT_COUNT = 5;

interface DashboardScreenProps {
  /**
   * `/processor-dashboard` and `/dashboard` used to be two near-identical files
   * that had already drifted apart — the processor copy still labelled a
   * processor as "Worker". Both routes now render this one component, so the two
   * roles cannot diverge again.
   *
   * Set when the route itself pins the role, so a processor who somehow lands on
   * `/dashboard` is shown the processor experience.
   */
  expectRole?: "worker" | "processor";
}

export function DashboardScreen({ expectRole }: DashboardScreenProps = {}) {
  const { t } = useLanguage();
  const { role: sessionRole, username, fullName, signOut } = useSession();
  const { isOffline } = useNetworkStatus();
  const toast = useToast();

  const role = expectRole ?? (sessionRole === "processor" ? "processor" : "worker");
  const isProcessor = role === "processor";

  // A processor has no dispatches of their own, so the hook stays dormant and
  // costs zero requests instead of firing a query that always returns nothing.
  const { rows, total, loading, refreshing, loadingMore, error, refresh, loadMore, hasMore } =
    useDispatchList({
      limit: RECENT_COUNT,
      enabled: !isProcessor,
    });

  const [now, setNow] = useState(() => new Date());
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const onRefresh = useCallback(async () => {
    setNow(new Date());
    refresh();
  }, [refresh]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const result = await signOut();
      if (!result.ok) toast.show(t.unable_to_logout, "error");
    } finally {
      setLoggingOut(false);
      setConfirmLogout(false);
    }
  }

  const displayName = fullName || username || t.app_name;

  const openDispatch = useCallback((d: Dispatch) => {
    router.push({ pathname: "/dispatch/[id]", params: { id: d.id } });
  }, []);

  const header = (
    <View>
      <AppHeader
        greeting={t[greetingKeyFor(now)]}
        name={displayName}
        subtitle={isProcessor ? t.role_processor : t.role_worker}
        right={
          <Pressable
            onPress={() => setConfirmLogout(true)}
            disabled={loggingOut}
            accessibilityRole="button"
            accessibilityLabel={t.logout}
            accessibilityState={{ disabled: loggingOut }}
            hitSlop={10}
            style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
          >
            <Text style={styles.logoutText} numberOfLines={1}>
              {loggingOut ? t.logging_out : t.logout}
            </Text>
          </Pressable>
        }
      />

      {isOffline ? <NetworkBanner t={t} /> : null}

      {!isProcessor ? (
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.statusTitle}>{t.active_online}</Text>
          </View>
          <Text style={styles.statusBody}>{t.ready_to_log}</Text>
        </Card>
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">
        {t.quick_actions}
      </Text>

      {/* A gap, not margins: margins collapse unpredictably inside the wrap and
          left a ragged last row. */}
      <View style={styles.actionGrid}>
        {!isProcessor ? (
          <ActionCard
            primary
            title={t.new_dispatch}
            subtitle={t.log_new_sale}
            icon="🚛"
            onPress={() => router.push("/dispatch")}
          />
        ) : null}

        <ActionCard
          title={t.my_history}
          subtitle={t.view_past_logs}
          icon="📋"
          onPress={() => router.push("/history")}
        />

        <ActionCard
          title={t.profile}
          subtitle={t.settings_info}
          icon="👤"
          onPress={() => router.push("/profile")}
        />

        <ActionCard
          title={t.scan_qr}
          subtitle={t.scan_truck_item}
          icon="📷"
          // Labelled rather than an alert trap: the old card opened a
          // "Coming Soon" dialog, which cost three taps to learn nothing.
          comingSoon
          comingSoonLabel={t.coming_soon}
        />
      </View>

      {isProcessor ? (
        <Card style={styles.processorCard}>
          {/* Was `t.settings_info`, whose value is "Your account and language" -
              a leftover from the old settings screen that read as a stray,
              meaningless sentence at the bottom of the dashboard. */}
          <Text style={styles.processorText}>{t.processor_note}</Text>
        </Card>
      ) : null}
    </View>
  );

  const listFooter = (
    <>
      {loadingMore ? <LoadingState label={t.loading} compact /> : null}
      {!loadingMore && hasMore ? (
        <Pressable
          onPress={loadMore}
          accessibilityRole="button"
          accessibilityLabel={t.load_more}
          style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}
        >
          <Text style={styles.loadMoreText}>{t.load_more}</Text>
        </Pressable>
      ) : null}
    </>
  );

  // ---- processor: no dispatch data to show --------------------------------
  if (isProcessor) {
    return (
      <Screen scroll>
        {header}
      </Screen>
    );
  }

  // ---- labour ------------------------------------------------------------
  return (
    <Screen scroll={false}>
      {loading && rows.length === 0 ? (
        <View style={styles.flex}>
          {header}
          <LoadingState label={t.loading} compact />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DispatchRow dispatch={item} t={t} now={now} onPress={openDispatch} />
          )}
          ItemSeparatorComponent={Separator}
          ListHeaderComponent={
            <>
              {header}
              <TotalTile total={total} shown={rows.length} loading={loading} t={t} />
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  {t.recent_activity}
                </Text>
                <Pressable
                  onPress={() => router.push("/history")}
                  accessibilityRole="link"
                  accessibilityLabel={t.open_history}
                  hitSlop={8}
                  style={({ pressed }) => [styles.link, pressed && styles.pressed]}
                >
                  <Text style={styles.linkText}>{t.open_history} ›</Text>
                </Pressable>
              </View>
            </>
          }
          ListEmptyComponent={
            error ? (
              // A dead connection must never be presented as "no records".
              <ErrorState
                body={error.message}
                onRetry={error.retryable ? refresh : undefined}
                retryLabel={t.retry}
                retrying={refreshing}
              />
            ) : (
              <EmptyState
                icon="🚛"
                title={t.no_recent_dispatches}
                body={t.first_dispatch_hint}
                actionLabel={t.new_dispatch}
                onAction={() => router.push("/dispatch")}
              />
            )
          }
          ListFooterComponent={listFooter}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}

      <ConfirmDialog
        visible={confirmLogout}
        title={t.logout_confirm_title}
        body={t.logout_confirm_body}
        confirmLabel={t.logout}
        cancelLabel={t.cancel}
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
        busy={loggingOut}
        destructive
      />
    </Screen>
  );
}

function Separator() {
  return <View style={styles.gap} />;
}

/**
 * One tile, deliberately.
 *
 * A four-tile breakdown looked richer but every number except "Total" was
 * computed from the five most recent rows, so a worker with 40 approved loads
 * was told they had 0. `total` comes from the server's exact count and is the
 * only status-agnostic number we can state honestly without four extra queries.
 * The per-status breakdown lives in History, where selecting a filter chip makes
 * the server's own count visible.
 */
function TotalTile({
  total,
  shown,
  loading,
  t,
}: {
  total: number | null;
  shown: number;
  loading: boolean;
  t: ReturnType<typeof useLanguage>["t"];
}) {
  return (
    <Card style={styles.totalCard}>
      <Text style={styles.totalValue}>
        {loading && total === null ? "—" : (total ?? shown)}
      </Text>
      <Text style={styles.totalLabel}>{t.total_dispatches}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { height: theme.spacing.sm },
  pressed: { opacity: 0.6 },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    flexGrow: 1,
  },
  logout: {
    // Was a bare 30px-tall text label.
    minHeight: 48,
    minWidth: 76,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },
  statusCard: { marginBottom: theme.spacing.lg },
  statusRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.primary },
  statusTitle: { fontSize: theme.textSizes.md, fontWeight: "700", color: theme.colors.text },
  statusBody: { fontSize: theme.textSizes.sm, color: theme.colors.textMuted, marginTop: 4, lineHeight: 19 },
  sectionTitle: {
    fontSize: theme.textSizes.lg,
    fontWeight: "800",
    color: theme.colors.text,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  processorCard: { marginTop: theme.spacing.sm },
  processorText: { fontSize: theme.textSizes.sm, color: theme.colors.textMuted, lineHeight: 20 },
  totalCard: { alignItems: "center", paddingVertical: theme.spacing.lg, marginBottom: theme.spacing.lg },
  totalValue: { fontSize: 34, fontWeight: "900", color: theme.colors.primary },
  totalLabel: {
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
    fontWeight: "700",
    marginTop: 2,
    textAlign: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { color: theme.colors.primary, fontSize: theme.textSizes.sm, fontWeight: "700" },
  loadMore: {
    marginTop: theme.spacing.md,
    minHeight: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreText: { color: theme.colors.primary, fontSize: theme.textSizes.sm, fontWeight: "800" },
});
