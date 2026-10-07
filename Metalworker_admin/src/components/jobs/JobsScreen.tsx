// src/components/jobs/JobsScreen.tsx
//
// Single shared implementation for the two job list routes
// (`/jobs-labour` and `/jobs-with-material`). They previously duplicated
// ~350 lines each and filtered the full table on the client; this one owns:
//   - server-side pagination (bounded pages via PostgREST range),
//   - debounced server-side search (no fetching every job to search),
//   - load-more at the end of the list,
//   - refresh-on-focus + pull-to-refresh,
//   - the keyed Edit / Drawing modals (one bug fix → one implementation).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useAdminGate } from "../../hooks/useAdminGate";
import { fetchJobsPage } from "../../services/jobs";
import type { Job, JobType } from "../../types/job";
import { Input } from "../ui/Input";
import { JobEditModal } from "./JobEditModal";
import { JobDrawingModal } from "./JobDrawingModal";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 400;

interface JobsScreenProps {
  jobType: JobType;
}

export function JobsScreen({ jobType }: JobsScreenProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { checking: authChecking } = useAdminGate();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [editOpenSeq, setEditOpenSeq] = useState(0);
  const [drawingModalJob, setDrawingModalJob] = useState<Job | null>(null);

  // Guards against out-of-order responses (search changes, focus reloads,
  // double pull-to-refresh) applying stale pages over newer ones.
  const requestIdRef = useRef(0);

  /* ── Debounce the search box so every keystroke does not hit the DB ── */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const loadFirstPage = useCallback(
    async (query: string, refreshOnly = false) => {
      const requestId = ++requestIdRef.current;
      try {
        const page = await fetchJobsPage(jobType, {
          page: 0,
          pageSize: PAGE_SIZE,
          search: query,
        });
        if (requestId !== requestIdRef.current) return;
        setError(null);
        setJobs(page.items);
        setTotal(page.total);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load jobs."
        );
      } finally {
        if (requestId === requestIdRef.current) {
          // `loading` only covers the very first fetch; later focus reloads
          // keep showing the previous list until the fresh page arrives.
          if (!refreshOnly) setLoading(false);
        }
      }
    },
    [jobType]
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || jobs.length === 0) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchJobsPage(jobType, {
        page: Math.floor(jobs.length / PAGE_SIZE),
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
      });
      if (requestId !== requestIdRef.current) return;
      setJobs((prev) => {
        const seen = new Set(prev.map((j) => j.id));
        return [...prev, ...page.items.filter((j) => !seen.has(j.id))];
      });
      setTotal(page.total);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(
        err instanceof Error ? err.message : "Failed to load more jobs."
      );
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [debouncedSearch, jobType, jobs.length, loadingMore]);

  // Refetch on focus and whenever the debounced search settles. Because
  // useFocusEffect re-runs its callback when the callback's deps change while
  // the screen is focused, both cases share one path (a separate effect here
  // would double-fetch: two in-flight requests for the same debounced query).
  useFocusEffect(
    useCallback(() => {
      void loadFirstPage(debouncedSearch);
    }, [loadFirstPage, debouncedSearch])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFirstPage(debouncedSearch, true);
    setRefreshing(false);
  }, [debouncedSearch, loadFirstPage]);

  const hasMore = jobs.length < total;

  const listHeader = (
    <View>
      <Text style={styles.headerSubtitle}>
        {total} {total === 1 ? "Job" : "Jobs"}
      </Text>

      <Input
        placeholder="Search jobs..."
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        accessibilityLabel="Search jobs"
      />

      <View style={styles.spacer} />
    </View>
  );

  const listEmpty = () => {
    if (authChecking || loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Failed to load jobs: {error}</Text>
          <Pressable
            onPress={() => void loadFirstPage(debouncedSearch)}
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>🧰</Text>
        <Text style={styles.emptyTitle}>
          {debouncedSearch
            ? "No Results"
            : jobType === "labour"
              ? "No Labour Jobs"
              : "No Jobs"}
        </Text>
        <Text style={styles.emptyText}>
          {debouncedSearch
            ? "Try a different search term."
            : jobType === "labour"
              ? "No labour jobs available."
              : "No jobs available."}
        </Text>
      </View>
    );
  };

  const listFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footerLoader}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      );
    }
    if (hasMore && !error) {
      return (
        <Pressable
          style={styles.loadMoreBtn}
          onPress={() => void loadMore()}
          accessibilityRole="button"
          accessibilityLabel="Load more jobs"
        >
          <Text style={styles.loadMoreText}>Load more</Text>
        </Pressable>
      );
    }
    return null;
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.jobCard, pressed && styles.jobCardPressed]}
            onPress={() => {
              setEditingJob(item);
              setEditOpenSeq((s) => s + 1);
            }}
            accessibilityHint="Opens the edit form for this job"
          >
            {/*
              The card press opens the edit modal, but the DRG row below is its
              own button. RNW renders `accessibilityRole="button"` as a real
              <button>, so marking this element a button too would create an
              invalid <button> inside <button>. The card stays keyboard
              focusable/tappable (Pressable is tabIndex 0), and the DRG control
              keeps the only semantic button role.
            */}
            <View style={styles.jobCardHeader}>
              <Text style={styles.jobNo}>{item.job_no || "No Job #"}</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusText}>{item.status || "Pending"}</Text>
              </View>
            </View>

            <Text style={styles.jobTitle}>
              {item.tool_description || "Unknown Tool"} {item.tool_part ? ` / ${item.tool_part}` : ""}
            </Text>

            <View style={styles.jobDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Qty:</Text>
                <Text style={styles.detailValue}>{item.quantity != null ? item.quantity : "—"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>PO Status:</Text>
                <Text style={styles.detailValue}>{item.po_status || "—"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Given:</Text>
                <Text style={styles.detailValue}>{item.job_given_date || "—"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Exp. Comp:</Text>
                <Text style={styles.detailValue}>{item.expected_completion_date || item.expected_completion_note || "—"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Machining:</Text>
                <Text style={styles.detailValue}>{item.current_machining_status || "—"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>DRG:</Text>
                <Pressable
                  style={({ pressed }) => [styles.drgBtn, pressed && styles.drgBtnPressed]}
                  onPress={(e) => {
                    e.stopPropagation();
                    setDrawingModalJob(item);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open drawings for job ${item.job_no || item.id}`}
                >
                  <Text style={styles.drgBtnText}>{item.drawing_status || "—"}</Text>
                </Pressable>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Model:</Text>
                <Text style={styles.detailValue}>{item.model_status || "—"}</Text>
              </View>
            </View>
          </Pressable>
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.6}
        showsVerticalScrollIndicator={false}
      />

      <JobEditModal
        key={editingJob ? `${editingJob.id}-${editOpenSeq}` : "edit-none"}
        visible={!!editingJob}
        onClose={() => setEditingJob(null)}
        job={editingJob}
        onSaved={() => {
          setEditingJob(null);
          void loadFirstPage(debouncedSearch, true);
        }}
      />

      <JobDrawingModal
        key={drawingModalJob?.id ?? "drawing-none"}
        visible={!!drawingModalJob}
        onClose={() => setDrawingModalJob(null)}
        job={drawingModalJob}
      />
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },
    header: {
      marginBottom: theme.spacing.lg,
    },
    backBtn: {
      marginBottom: theme.spacing.sm,
      alignSelf: "flex-start",
    },
    backBtnText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    headerInfo: {
      marginBottom: theme.spacing.md,
    },
    headerTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xl,
      fontWeight: "800",
    },
    headerSubtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      marginTop: 2,
    },
    spacer: { height: theme.spacing.lg },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.colors.danger + "15",
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger + "40",
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    errorBannerText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.sm,
      flex: 1,
      marginRight: theme.spacing.sm,
    },
    retryText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    loadingContainer: {
      paddingVertical: theme.spacing.xl * 2,
      alignItems: "center",
    },
    emptyState: {
      alignItems: "center",
      paddingVertical: theme.spacing.xl * 2,
    },
    emptyIcon: { fontSize: 40, marginBottom: theme.spacing.md },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      marginBottom: 4,
    },
    emptyText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
    },
    jobCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    jobCardPressed: {
      opacity: 0.7,
      backgroundColor: theme.colors.border,
    },
    jobCardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: theme.spacing.sm,
    },
    jobNo: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
    },
    statusBadge: {
      backgroundColor: theme.colors.primary + "15",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
    },
    statusText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    jobTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "600",
      marginBottom: theme.spacing.md,
    },
    jobDetails: {
      gap: 4,
    },
    detailRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    detailLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      width: 100,
    },
    detailValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      flex: 1,
      textAlign: "right",
    },
    drgBtn: {
      backgroundColor: theme.colors.background,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    drgBtnPressed: {
      backgroundColor: theme.colors.primary + "20",
      borderColor: theme.colors.primary,
    },
    drgBtnText: {
      fontSize: theme.textSizes.sm,
      color: theme.colors.text,
      fontWeight: "600",
    },
    footerLoader: {
      paddingVertical: theme.spacing.lg,
      alignItems: "center",
    },
    loadMoreBtn: {
      marginTop: theme.spacing.sm,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.primary + "15",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
    },
    loadMoreText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
  });