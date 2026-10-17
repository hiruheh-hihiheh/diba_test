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
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Icon } from "../ui/Icon";
import { PressableScale } from "../ui/PressableScale";
import { Reveal } from "../ui/Reveal";
import { ScreenHeader } from "../ui/ScreenHeader";
import { SearchBar } from "../ui/SearchBar";
import { SkeletonCard } from "../ui/Skeleton";
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

  const statusTone = (value: string | null): BadgeTone => {
    const normalized = (value ?? "").toLowerCase();
    if (normalized.includes("complete") || normalized.includes("done")) return "success";
    if (normalized.includes("hold") || normalized.includes("cancel")) return "danger";
    if (normalized.includes("progress") || normalized.includes("wip")) return "info";
    return "warning";
  };

  const listHeader = (
    <View>
      <ScreenHeader
        eyebrow="Work orders"
        title={jobType === "labour" ? "Labour jobs" : "Material jobs"}
        subtitle={`${total} ${total === 1 ? "job" : "jobs"}${
          debouncedSearch ? " matching your search" : " in this category"
        }`}
      />

      <SearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search job number, tool or part"
        accessibilityLabel="Search jobs"
        autoCapitalize="none"
        style={styles.search}
      />
    </View>
  );

  const listEmpty = () => {
    if (authChecking || loading) {
      return (
        <View style={styles.skeletons}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.errorBanner}>
          <Icon name="alert" size={16} color={theme.colors.danger} />
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
      <EmptyState
        icon={jobType === "labour" ? "hammer" : "box"}
        title={
          debouncedSearch
            ? "No matching jobs"
            : jobType === "labour"
            ? "No labour jobs yet"
            : "No material jobs yet"
        }
        message={
          debouncedSearch
            ? "Try a different job number, tool or part."
            : "Jobs created in the field app will appear here."
        }
      />
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
        <Button
          title={`Load more (${total - jobs.length} left)`}
          variant="secondary"
          onPress={() => void loadMore()}
          style={styles.loadMore}
        />
      );
    }
    return null;
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Reveal delay={Math.min(index, 6) * 16}>
            {/* The pressable covers the card body only: the Drawings row is a
                separate button, and nesting one button inside another is invalid
                on web (and confuses screen readers on native). */}
            <View style={styles.jobCard}>
              <PressableScale
                onPress={() => {
                  setEditingJob(item);
                  setEditOpenSeq((s) => s + 1);
                }}
                accessibilityLabel={`Edit job ${item.job_no || item.id}`}
                accessibilityHint="Opens the edit form for this job"
              >
                <View style={styles.jobCardHeader}>
                  <View style={styles.jobNoWrap}>
                    <View style={styles.jobIcon}>
                      <Icon
                        name={jobType === "labour" ? "hammer" : "box"}
                        size={17}
                        color={theme.colors.primary}
                      />
                    </View>
                    <View style={styles.jobNoText}>
                      <Text style={styles.jobNo} numberOfLines={1}>
                        {item.job_no || "No job number"}
                      </Text>
                      <Text style={styles.jobType}>
                        {jobType === "labour" ? "Labour job" : "With material"}
                      </Text>
                    </View>
                  </View>
                  <Badge
                    label={(item.status || "Pending").toUpperCase()}
                    tone={statusTone(item.status)}
                  />
                </View>

                <Text style={styles.jobTitle} numberOfLines={2}>
                  {item.tool_description || "Unknown tool"}
                  {item.tool_part ? ` · ${item.tool_part}` : ""}
                </Text>

                <View style={styles.chipRow}>
                  <View style={styles.metaChip}>
                    <Text style={styles.metaChipLabel}>QTY</Text>
                    <Text style={styles.metaChipValue}>
                      {item.quantity != null ? item.quantity : "—"}
                    </Text>
                  </View>
                  <View style={styles.metaChip}>
                    <Text style={styles.metaChipLabel}>PO</Text>
                    <Text style={styles.metaChipValue} numberOfLines={1}>
                      {item.po_status || "—"}
                    </Text>
                  </View>
                </View>

                <View style={styles.detailsGrid}>
                  <JobDetail
                    label="Given"
                    value={item.job_given_date || "—"}
                  />
                  <JobDetail
                    label="Expected"
                    value={
                      item.expected_completion_date ||
                      item.expected_completion_note ||
                      "—"
                    }
                  />
                  <JobDetail
                    label="Machining"
                    value={item.current_machining_status || "—"}
                  />
                  <JobDetail label="Model" value={item.model_status || "—"} />
                </View>
              </PressableScale>

              <Pressable
                style={({ pressed }) => [
                  styles.drgRow,
                  pressed && styles.drgRowPressed,
                ]}
                onPress={() => setDrawingModalJob(item)}
                accessibilityRole="button"
                accessibilityLabel={`Open drawings for job ${item.job_no || item.id}`}
              >
                <View style={styles.drgIcon}>
                  <Icon name="image" size={15} color={theme.colors.textSecondary} />
                </View>
                <Text style={styles.drgLabel}>Drawings</Text>
                <Text style={styles.drgValue} numberOfLines={1}>
                  {item.drawing_status || "Not set"}
                </Text>
                <Icon
                  name="chevronRight"
                  size={14}
                  color={theme.colors.textMuted}
                />
              </Pressable>
            </View>
          </Reveal>
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
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

function JobDetail({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.detailCell}>
      <Text style={styles.detailLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    search: { marginBottom: theme.spacing.md },
    skeletons: { gap: 8 },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.colors.dangerMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger + "45",
      padding: 12,
    },
    errorBannerText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      flex: 1,
    },
    retryText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    jobCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 12,
      marginBottom: theme.spacing.sm,
      ...theme.elevation.card,
    },
    jobCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    jobNoWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      minWidth: 0,
    },
    jobIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    jobNoText: { flex: 1, minWidth: 0 },
    jobNo: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    jobType: {
      color: theme.colors.textMuted,
      fontSize: 11,
      marginTop: 1,
    },
    jobTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "600",
      marginTop: 10,
      letterSpacing: -0.2,
    },
    chipRow: {
      flexDirection: "row",
      gap: 6,
      marginTop: 10,
    },
    metaChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.colors.border,
      maxWidth: "60%",
    },
    metaChipLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 0.6,
    },
    metaChipValue: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
      flexShrink: 1,
    },
    detailsGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: 10,
      marginTop: 12,
    },
    detailCell: { width: "50%", paddingRight: 8 },
    detailLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 0.7,
      marginBottom: 2,
    },
    detailValue: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "500",
    },
    drgRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 12,
      paddingTop: 10,
      paddingBottom: 2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    drgRowPressed: { opacity: 0.6 },
    drgIcon: {
      width: 26,
      height: 26,
      borderRadius: 8,
      backgroundColor: theme.colors.surfaceHover,
      alignItems: "center",
      justifyContent: "center",
    },
    drgLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
    },
    drgValue: {
      flex: 1,
      textAlign: "right",
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
    },
    footerLoader: { paddingVertical: theme.spacing.lg, alignItems: "center" },
    loadMore: { marginTop: theme.spacing.sm },
  });
