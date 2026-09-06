// src/app/dispatch.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "../constants/theme";
import {
  fetchAdminDispatches,
  getStatusColor,
} from "../services/dispatch";
import { supabase } from "../services/supabase";
import type { Dispatch, DispatchStatus } from "../types/dispatch";

import { Input } from "../components/ui/Input";

interface UserGroup {
  username: string;
  dispatches: Dispatch[];
  isExpanded: boolean;
}

export default function DispatchScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DispatchStatus | "all">("all");
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
  }, []);

  const loadDispatches = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchAdminDispatches();
      if (res.ok && res.data) {
        setDispatches(res.data);
      } else {
        const msg = res.error || "Failed to load dispatches.";
        if (Platform.OS === "web") {
          window.alert(msg);
        } else {
          Alert.alert("Error", msg);
        }
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to load dispatches.";
      if (Platform.OS === "web") {
        window.alert(msg);
      } else {
        Alert.alert("Error", msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

useFocusEffect(
  useCallback(() => {
    if (session) {
      void loadDispatches();
    }
  }, [session, loadDispatches])
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

  if (!session) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  const filterOptions: (DispatchStatus | "all")[] = [
    "all",
    "submitted",
    "reviewed",
    "approved",
    "rejected",
  ];

  const totalWorkers = groupedDispatches.length;
  const totalDispatches = filteredDispatches.length;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </Pressable>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Dispatch Management</Text>
            <Text style={styles.headerSubtitle}>
              {totalDispatches} dispatches • {totalWorkers} workers
            </Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        {/* SEARCH & FILTER */}
        <View style={styles.searchSection}>
          <Input
            placeholder="Search username or vehicle..."
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterRow}
            contentContainerStyle={styles.filterContent}
          >
            {filterOptions.map((f) => (
              <Pressable
                key={f}
                style={[
                  styles.filterBtn,
                  filter === f && styles.filterBtnActive,
                ]}
                onPress={() => setFilter(f)}
              >
                <Text
                  style={[
                    styles.filterText,
                    filter === f && styles.filterTextActive,
                  ]}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* DISPATCH LIST */}
        <View style={styles.listCard}>
          <View style={styles.listHeader}>
            <Text style={styles.cardTitle}>
              {filter !== "all" || search ? "Filtered Results" : "All Dispatches"}
            </Text>
            <Pressable onPress={onRefresh} disabled={refreshing}>
              <Text style={styles.refreshText}>
                {refreshing ? "Refreshing..." : "Refresh"}
              </Text>
            </Pressable>
          </View>

          {loading && dispatches.length === 0 ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : filteredDispatches.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>
                {search || filter !== "all"
                  ? "No dispatches match your search or filter."
                  : "No dispatches found."}
              </Text>
            </View>
          ) : (
            <View>
              {groupedDispatches.map((group) => {
                if (group.dispatches.length === 1) {
                  // Single dispatch - show as normal row
                  const dispatch = group.dispatches[0];
                  return (
                    <Pressable
                      key={dispatch.id}
                      style={styles.dispatchRow}
                      onPress={() => openDispatchDetails(dispatch.id)}
                    >
                      <View style={styles.dispatchInfo}>
                        <View style={styles.dispatchMainRow}>
                          <Text style={styles.dispatchUsername} numberOfLines={1}>
                            {dispatch.worker_username}
                          </Text>
                          <View
                            style={[
                              styles.statusBadge,
                              { backgroundColor: getStatusColor(dispatch.status) + "20" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusText,
                                { color: getStatusColor(dispatch.status) },
                              ]}
                              numberOfLines={1}
                            >
                              {dispatch.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.dispatchVehicle} numberOfLines={1}>
                          🚛 {dispatch.vehicle_number}
                        </Text>
                        <Text style={styles.dispatchDate}>
                          📅 {formatDate(dispatch.submitted_at)}
                        </Text>
                      </View>
                      <View style={styles.chevron}>
                        <Text style={styles.chevronText}>›</Text>
                      </View>
                    </Pressable>
                  );
                } else {
                  // Multiple dispatches - show as collapsible group
                  return (
                    <View key={group.username} style={styles.userGroup}>
                      <Pressable
                        style={styles.userGroupHeader}
                        onPress={() => toggleUserExpansion(group.username)}
                      >
                        <View style={styles.userGroupIcon}>
                          <Text style={styles.userGroupIconText}>
                            {group.isExpanded ? "📂" : "📁"}
                          </Text>
                        </View>
                        <View style={styles.userGroupInfo}>
                          <Text style={styles.userGroupName} numberOfLines={1}>
                            {group.username}
                          </Text>
                          <Text style={styles.userGroupCount}>
                            {group.dispatches.length} Dispatches
                          </Text>
                        </View>
                        <View style={styles.userGroupChevron}>
                          <Text style={styles.userGroupChevronText}>
                            {group.isExpanded ? "▲" : "▼"}
                          </Text>
                        </View>
                      </Pressable>

                      {group.isExpanded && (
                        <View style={styles.userGroupContent}>
                          {group.dispatches.map((dispatch, index) => (
                            <Pressable
                              key={dispatch.id}
                              style={[
                                styles.groupedDispatchRow,
                                index === group.dispatches.length - 1 &&
                                  styles.groupedDispatchRowLast,
                              ]}
                              onPress={() => openDispatchDetails(dispatch.id)}
                            >
                              <View style={styles.groupedDispatchInfo}>
                                <View style={styles.groupedDispatchMainRow}>
                                  <Text style={styles.dispatchVehicle} numberOfLines={1}>
                                    🚛 {dispatch.vehicle_number}
                                  </Text>
                                  <View
                                    style={[
                                      styles.statusBadge,
                                      { backgroundColor: getStatusColor(dispatch.status) + "20" },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.statusText,
                                        { color: getStatusColor(dispatch.status) },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {dispatch.status.toUpperCase()}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.dispatchDate}>
                                  📅 {formatDate(dispatch.submitted_at)}
                                </Text>
                              </View>
                              <View style={styles.chevron}>
                                <Text style={styles.chevronText}>›</Text>
                              </View>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                }
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.background,
  },
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },

  /* HEADER */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xl,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    color: theme.colors.primary,
    fontSize: 20,
    fontWeight: "600",
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginTop: 2,
  },
  headerSpacer: {
    width: 40,
  },

  /* SEARCH & FILTER */
  searchSection: {
    marginBottom: theme.spacing.lg,
  },
  filterRow: {
    marginTop: theme.spacing.md,
  },
  filterContent: {
    paddingRight: theme.spacing.sm,
  },
  filterBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.sm,
  },
  filterBtnActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  filterText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  filterTextActive: { color: "#FFFFFF" },

  /* LIST CARD */
  listCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  refreshText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  emptyState: {
    paddingVertical: theme.spacing.xl,
    alignItems: "center",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.md,
    opacity: 0.5,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
  },

  /* DISPATCH ROW */
  dispatchRow: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  dispatchInfo: {
    flex: 1,
  },
  dispatchMainRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.xs,
  },
  dispatchUsername: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  dispatchVehicle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    marginBottom: 2,
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  dispatchDate: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
  },
  chevron: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary + "15",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing.sm,
  },
  chevronText: {
    color: theme.colors.primary,
    fontSize: 20,
    fontWeight: "700",
  },

  /* STATUS BADGE */
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: 100,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  /* USER GROUP */
  userGroup: {
    marginBottom: theme.spacing.md,
  },
  userGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing.md,
    backgroundColor: theme.colors.primary + "10",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary + "30",
  },
  userGroupIcon: {
    fontSize: 24,
    marginRight: theme.spacing.md,
  },
  userGroupIconText: {
    fontSize: 24,
  },
  userGroupInfo: {
    flex: 1,
  },
  userGroupName: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  userGroupCount: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginTop: 2,
  },
  userGroupChevron: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  userGroupChevronText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  userGroupContent: {
    marginTop: theme.spacing.sm,
    marginLeft: theme.spacing.md,
    paddingLeft: theme.spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border,
  },

  /* GROUPED DISPATCH ROW */
  groupedDispatchRow: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  groupedDispatchRowLast: {
    borderBottomWidth: 0,
  },
  groupedDispatchInfo: {
    flex: 1,
  },
  groupedDispatchMainRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.xs,
  },
});