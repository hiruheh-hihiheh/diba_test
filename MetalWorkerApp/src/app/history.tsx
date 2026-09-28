import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { DispatchRow } from "../components/dispatch/DispatchRow";
import { AppHeader } from "../components/ui/AppHeader";
import { NetworkBanner } from "../components/ui/NetworkBanner";
import { Screen } from "../components/ui/Screen";
import { SearchInput } from "../components/ui/SearchInput";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/States";
import { SessionGate } from "../components/SessionGate";
import { theme } from "../constants/theme";
import { format } from "../constants/translations";
import { useLanguage } from "../contexts/LanguageContext";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useDispatchList } from "../hooks/useDispatchList";
import { ALL_STATUSES, type Dispatch, type DispatchStatus } from "../services/dispatch";

const PAGE_SIZE = 20;

export default function HistoryScreen() {
  return (
    <SessionGate>
      <History />
    </SessionGate>
  );
}

function History() {
  const { t } = useLanguage();
  const { isOffline } = useNetworkStatus();

  // Kept local so typing stays instant; the hook debounces before it queries.
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<DispatchStatus | "all">("all");
  const [now, setNow] = useState(() => new Date());

  const { rows, total, loading, refreshing, loadingMore, hasMore, error, refresh, loadMore } =
    useDispatchList({ limit: PAGE_SIZE, search, status });

  const filters = useMemo(() => ["all" as const, ...ALL_STATUSES], []);

  const onRefresh = useCallback(() => {
    setNow(new Date());
    refresh();
  }, [refresh]);

  const isFiltered = search.trim().length > 0 || status !== "all";
  const openDispatch = useCallback((d: Dispatch) => {
    router.push({ pathname: "/dispatch/[id]", params: { id: d.id } });
  }, []);

  const header = (
    <View>
      <AppHeader title={t.history_title} onBack={() => router.back()} />

      {isOffline ? <NetworkBanner t={t} /> : null}

      <SearchInput
        value={search}
        onChangeText={setSearch}
        placeholder={t.search_dispatches}
        label={t.search_dispatches}
        clearLabel={t.clear_search}
        onSubmit={refresh}
        testID="history-search"
      />

      {/* Horizontal, because on a 360dp screen five status chips do not fit
          side by side and used to be squeezed into unreadable slivers. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        {filters.map((option) => {
          const selected = status === option;
          const label = option === "all" ? t.filter_all : t[STATUS_KEY[option]];
          return (
            <Pressable
              key={option}
              onPress={() => setStatus(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && !selected && styles.chipPressed,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.countRow}>
        <Text style={styles.count} accessibilityLiveRegion="polite">
          {loading && total === null && rows.length === 0
            ? t.loading
            : format(t.showing_count, { shown: rows.length, total: total ?? rows.length })}
        </Text>
      </View>
    </View>
  );

  return (
    <Screen scroll={false} keyboardAware>
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
          ListHeaderComponent={header}
          ListEmptyComponent={
            error ? (
              <ErrorState
                body={error.message}
                onRetry={error.retryable ? refresh : undefined}
                retryLabel={t.retry}
                retrying={refreshing}
              />
            ) : isFiltered ? (
              // "No matches" must be visibly different from "you have nothing".
              <EmptyState
                icon="🔍"
                title={t.no_matches}
                body={t.no_matches_body}
                actionLabel={t.filter_all}
                onAction={() => {
                  setSearch("");
                  setStatus("all");
                }}
              />
            ) : (
              <EmptyState
                icon="📋"
                title={t.no_dispatches_yet}
                body={t.no_dispatches_yet_body}
                actionLabel={t.new_dispatch}
                onAction={() => router.replace("/dispatch")}
              />
            )
          }
          ListFooterComponent={
            <>
              {loadingMore ? <LoadingState label={t.loading} compact /> : null}
              {!loadingMore && hasMore && rows.length > 0 ? (
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
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
          onEndReachedThreshold={0.5}
          // Only auto-page when the user is actually near the end; otherwise the
          // initial short list fires a second request on mount.
          onEndReached={rows.length > 0 ? loadMore : undefined}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}
    </Screen>
  );
}

function Separator() {
  return <View style={styles.gap} />;
}

const STATUS_KEY = {
  submitted: "status_submitted",
  reviewed: "status_reviewed",
  approved: "status_approved",
  rejected: "status_rejected",
} as const;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { height: theme.spacing.sm },
  pressed: { opacity: 0.7 },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
    flexGrow: 1,
  },
  chipRow: { gap: theme.spacing.sm, paddingBottom: theme.spacing.md, paddingRight: theme.spacing.lg },
  chip: {
    // Was a 32px-tall pill; now a comfortable 44dp target.
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipPressed: { backgroundColor: theme.colors.primaryLight },
  chipText: { fontSize: theme.textSizes.xs, fontWeight: "700", color: theme.colors.text },
  chipTextSelected: { color: "#FFFFFF" },
  countRow: { marginBottom: theme.spacing.md },
  count: { fontSize: theme.textSizes.xs, color: theme.colors.textMuted, fontWeight: "600" },
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
