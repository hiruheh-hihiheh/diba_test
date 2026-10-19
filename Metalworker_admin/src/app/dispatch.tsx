// src/app/dispatch.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
import { fetchAdminDispatches, getMaterialLabel } from "../services/dispatch";
import type { Dispatch, DispatchStatus } from "../types/dispatch";

import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/IconButton";
import { PressableScale } from "../components/ui/PressableScale";
import { Reveal } from "../components/ui/Reveal";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SearchBar } from "../components/ui/SearchBar";
import { SkeletonCard } from "../components/ui/Skeleton";

interface UserGroup {
  username: string;
  dispatches: Dispatch[];
  isExpanded: boolean;
}

export default function DispatchScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const { checking: authChecking } = useAdminGate();
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DispatchStatus | "all">("all");
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const loadDispatches = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchAdminDispatches();
      if (res.ok && res.data) {
        setDispatches(res.data);
      } else {
        const msg = res.error || "Failed to load dispatches.";
        setError(msg);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load dispatches.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!authChecking) {
        void loadDispatches();
      }
    }, [authChecking, loadDispatches])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDispatches();
    setRefreshing(false);
  }, [loadDispatches]);

  const filteredDispatches = useMemo(() => {
    let result = dispatches;
    if (filter !== "all") {
      result = result.filter((d) => d.status === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.worker_username.toLowerCase().includes(q) ||
          d.vehicle_number.toLowerCase().includes(q)
      );
    }
    return result;
  }, [dispatches, filter, search]);

  const groupedDispatches = useMemo(() => {
    const groups = new Map<string, Dispatch[]>();
    
    filteredDispatches.forEach((dispatch) => {
      const username = dispatch.worker_username;
      if (!groups.has(username)) {
        groups.set(username, []);
      }
      groups.get(username)!.push(dispatch);
    });

    const userGroups: UserGroup[] = [];
    groups.forEach((dispatches, username) => {
      userGroups.push({
        username,
        dispatches,
        isExpanded: expandedUsers.has(username),
      });
    });

    return userGroups;
  }, [filteredDispatches, expandedUsers]);

  const toggleUserExpansion = (username: string) => {
    setExpandedUsers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(username)) {
        newSet.delete(username);
      } else {
        newSet.add(username);
      }
      return newSet;
    });
  };

  const openDispatchDetails = (dispatchId: string) => {
    router.push({
      pathname: "/dispatch-details",
      params: { id: dispatchId },
    });
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  if (authChecking) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const statusCounts: Record<DispatchStatus | "all", number> = {
    all: dispatches.length,
    submitted: dispatches.filter((d) => d.status === "submitted").length,
    reviewed: dispatches.filter((d) => d.status === "reviewed").length,
    approved: dispatches.filter((d) => d.status === "approved").length,
    rejected: dispatches.filter((d) => d.status === "rejected").length,
  };

  const totalWorkers = groupedDispatches.length;
  const totalDispatches = filteredDispatches.length;
  const filterOptions: (DispatchStatus | "all")[] = [
    "all",
    "submitted",
    "reviewed",
    "approved",
    "rejected",
  ];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
          />
        }
      >
        <ScreenHeader
          eyebrow="Operations"
          title="Dispatches"
          subtitle={`${totalDispatches} of ${dispatches.length} shown · ${totalWorkers} ${
            totalWorkers === 1 ? "worker" : "workers"
          }`}
          right={
            <IconButton
              icon="refresh"
              accessibilityLabel="Refresh dispatches"
              onPress={onRefresh}
              variant="soft"
              size={36}
              iconSize={16}
              disabled={refreshing}
            />
          }
        />

        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search worker or vehicle"
          accessibilityLabel="Search dispatches by worker or vehicle"
          autoCapitalize="none"
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          style={styles.filterScroll}
        >
          {filterOptions.map((option) => {
            const active = filter === option;
            const label = option === "all" ? "All" : option[0].toUpperCase() + option.slice(1);
            return (
              <Pressable
                key={option}
                onPress={() => setFilter(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.filterChip,
                  active && styles.filterChipActive,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    active && styles.filterChipTextActive,
                  ]}
                >
                  {label}
                </Text>
                <View
                  style={[
                    styles.filterCount,
                    active && styles.filterCountActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterCountText,
                      active && styles.filterCountTextActive,
                    ]}
                  >
                    {statusCounts[option]}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {error && !loading ? (
          <View style={styles.errorBanner}>
            <Icon name="alert" size={16} color={theme.colors.danger} />
            <Text style={styles.errorBannerText}>
              Could not load dispatches: {error}
            </Text>
            <Pressable onPress={onRefresh} accessibilityRole="button">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {loading && dispatches.length === 0 ? (
          <View style={styles.skeletons}>
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
          </View>
        ) : filteredDispatches.length === 0 ? (
          <EmptyState
            icon="truck"
            title={search || filter !== "all" ? "No matching dispatches" : "No dispatches yet"}
            message={
              search || filter !== "all"
                ? "Try a different search term or status filter."
                : "Worker submissions will appear here once they are sent from the field app."
            }
          />
        ) : (
          <View style={styles.list}>
            {groupedDispatches.map((group) => {
              if (group.dispatches.length === 1) {
                const dispatch = group.dispatches[0];
                return (
                  <PressableScale
                    key={dispatch.id}
                    onPress={() => openDispatchDetails(dispatch.id)}
                    accessibilityLabel={`Dispatch by ${dispatch.worker_username}, ${dispatch.status}`}
                  >
                    <View style={styles.rowCard}>
                      <View style={styles.rowIcon}>
                        <Icon name="truck" size={18} color={theme.colors.primary} />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {dispatch.worker_username}
                        </Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {dispatch.vehicle_number} · {getMaterialLabel(dispatch.material_type, dispatch.custom_material)}
                        </Text>
                        <Text style={styles.rowDate}>{formatDate(dispatch.submitted_at)}</Text>
                      </View>
                      <View style={styles.rowTrailing}>
                        <Badge
                          label={dispatch.status.toUpperCase()}
                          tone={statusToneFor(dispatch.status)}
                        />
                        <Icon
                          name="chevronRight"
                          size={15}
                          color={theme.colors.textMuted}
                        />
                      </View>
                    </View>
                  </PressableScale>
                );
              }

              return (
                <View key={group.username} style={styles.groupCard}>
                  <Pressable
                    style={styles.groupHeader}
                    onPress={() => toggleUserExpansion(group.username)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: group.isExpanded }}
                    accessibilityLabel={`${group.username}, ${group.dispatches.length} dispatches. ${
                      group.isExpanded ? "Collapse" : "Expand"
                    }`}
                  >
                    <View style={styles.groupAvatar}>
                      <Text style={styles.groupAvatarText}>
                        {group.username.slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.groupInfo}>
                      <Text style={styles.groupName} numberOfLines={1}>
                        {group.username}
                      </Text>
                      <Text style={styles.groupCount}>
                        {group.dispatches.length} dispatches
                      </Text>
                    </View>
                    <View
                      style={{
                        transform: [
                          { rotate: group.isExpanded ? "90deg" : "0deg" },
                        ],
                      }}
                    >
                      <Icon
                        name="chevronRight"
                        size={16}
                        color={theme.colors.textMuted}
                      />
                    </View>
                  </Pressable>

                  {group.isExpanded ? (
                    <Reveal>
                      <View style={styles.groupBody}>
                        {group.dispatches.map((dispatch, index) => (
                          <Pressable
                            key={dispatch.id}
                            onPress={() => openDispatchDetails(dispatch.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`Dispatch ${dispatch.vehicle_number}, ${dispatch.status}`}
                            style={({ pressed }) => [
                              styles.groupRow,
                              index !== group.dispatches.length - 1 &&
                                styles.groupRowDivider,
                              pressed && { backgroundColor: theme.colors.surfaceHover },
                            ]}
                          >
                            <View style={styles.groupRowInfo}>
                              <Text style={styles.groupRowTitle} numberOfLines={1}>
                                {dispatch.vehicle_number}
                              </Text>
                              <Text style={styles.rowMeta} numberOfLines={1}>
                                {getMaterialLabel(dispatch.material_type, dispatch.custom_material)}
                              </Text>
                              <Text style={styles.rowDate}>
                                {formatDate(dispatch.submitted_at)}
                              </Text>
                            </View>
                            <Badge
                              label={dispatch.status.toUpperCase()}
                              tone={statusToneFor(dispatch.status)}
                            />
                            <Icon
                              name="chevronRight"
                              size={14}
                              color={theme.colors.textMuted}
                            />
                          </Pressable>
                        ))}
                      </View>
                    </Reveal>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function statusToneFor(status: DispatchStatus): "warning" | "info" | "success" | "danger" | "neutral" {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    case "reviewed":
      return "info";
    case "submitted":
      return "warning";
    default:
      return "neutral";
  }
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.colors.background,
    },
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    filterScroll: { marginTop: theme.spacing.sm + 2, marginHorizontal: -theme.spacing.md },
    filterRow: {
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 2,
    },
    filterChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    filterChipActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    filterChipText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
    },
    filterChipTextActive: { color: theme.colors.primaryButtonText },
    filterCount: {
      minWidth: 20,
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceHover,
      alignItems: "center",
    },
    filterCountActive: { backgroundColor: "rgba(0,0,0,0.16)" },
    filterCountText: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    filterCountTextActive: { color: theme.colors.primaryButtonText },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.colors.dangerMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger + "45",
      padding: 12,
      marginTop: theme.spacing.md,
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
    skeletons: { marginTop: theme.spacing.md, gap: 0 },
    list: { marginTop: theme.spacing.md, gap: theme.spacing.sm },
    rowCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      ...theme.elevation.card,
    },
    rowIcon: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    rowMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },
    rowDate: {
      color: theme.colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    rowTrailing: { alignItems: "flex-end", gap: 6 },
    groupCard: {
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      overflow: "hidden",
      ...theme.elevation.card,
    },
    groupHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 12,
      minHeight: 62,
    },
    groupAvatar: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    groupAvatarText: {
      color: theme.colors.primary,
      fontSize: 12,
      fontWeight: "800",
    },
    groupInfo: { flex: 1, minWidth: 0 },
    groupName: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    groupCount: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 2,
    },
    groupBody: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingHorizontal: 12,
    },
    groupRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 11,
      paddingHorizontal: 2,
      borderRadius: theme.radius.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "transparent",
    },
    groupRowDivider: { borderBottomColor: theme.colors.border },
    groupRowInfo: { flex: 1, minWidth: 0 },
    groupRowTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
  });
