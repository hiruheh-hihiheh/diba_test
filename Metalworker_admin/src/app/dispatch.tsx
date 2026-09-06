import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "../constants/theme";
import {
  fetchAdminDispatches,
  getMaterialLabel,
  getStatusColor,
} from "../services/dispatch";
import { supabase } from "../services/supabase";
import type { Dispatch, DispatchStatus } from "../types/dispatch";

import { Input } from "../components/ui/Input";

export default function DispatchScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DispatchStatus | "all">("all");
  const [selectedDispatch, setSelectedDispatch] = useState<Dispatch | null>(null);

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

  useEffect(() => {
    if (session) loadDispatches();
  }, [session, loadDispatches]);

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
              {filteredDispatches.length} dispatches
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
            <Text style={styles.cardTitle}>Recent Dispatches</Text>
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
            <Text style={styles.emptyText}>
              {search || filter !== "all"
                ? "No dispatches match your search or filter."
                : "No dispatches found."}
            </Text>
          ) : (
            filteredDispatches.map((dispatch, index) => (
              <Pressable
                key={dispatch.id}
                style={[
                  styles.dispatchRow,
                  index === filteredDispatches.length - 1 && styles.dispatchRowLast,
                ]}
                onPress={() => setSelectedDispatch(dispatch)}
              >
                <View style={styles.dispatchInfo}>
                  <View style={styles.dispatchMainRow}>
                    <Text style={styles.dispatchUsername}>
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
                      >
                        {dispatch.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.dispatchVehicle}>
                    🚛 {dispatch.vehicle_number}
                  </Text>
                  <Text style={styles.dispatchDate}>
                    📅 {new Date(dispatch.submitted_at).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.chevron}>
                  <Text style={styles.chevronText}>›</Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      {/* DISPATCH DETAIL MODAL */}
      <Modal
        visible={!!selectedDispatch}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalScreen} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            style={styles.modalKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView contentContainerStyle={styles.modalContent}>
              {selectedDispatch && (
                <>
                  <View style={styles.modalHeader}>
                    <View style={styles.modalHeaderSpacer} />
                    <Text style={styles.modalTitle}>Dispatch Details</Text>
                    <Pressable
                      onPress={() => setSelectedDispatch(null)}
                      style={styles.closeBtn}
                    >
                      <Text style={styles.closeBtnText}>✕</Text>
                    </Pressable>
                  </View>

                  <Image
                    source={{ uri: selectedDispatch.photo_url }}
                    style={styles.dispatchPhoto}
                    resizeMode="cover"
                  />

                  <View style={styles.detailCard}>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>
                        Dispatch Information
                      </Text>

                      <View style={styles.detailRow}>
                        <View style={styles.detailLabelContainer}>
                          <Text style={styles.detailIcon}>👤</Text>
                          <Text style={styles.detailLabel}>Worker</Text>
                        </View>
                        <Text style={styles.detailValue}>
                          {selectedDispatch.worker_username}
                        </Text>
                      </View>

                      <View style={styles.detailRow}>
                        <View style={styles.detailLabelContainer}>
                          <Text style={styles.detailIcon}>🚛</Text>
                          <Text style={styles.detailLabel}>Vehicle Number</Text>
                        </View>
                        <Text style={styles.detailValue}>
                          {selectedDispatch.vehicle_number}
                        </Text>
                      </View>

                      <View style={styles.detailRow}>
                        <View style={styles.detailLabelContainer}>
                          <Text style={styles.detailIcon}>📦</Text>
                          <Text style={styles.detailLabel}>Material</Text>
                        </View>
                        <Text style={styles.detailValue}>
                          {getMaterialLabel(selectedDispatch.material_type)}
                        </Text>
                      </View>

                      <View style={styles.detailRow}>
                        <View style={styles.detailLabelContainer}>
                          <Text style={styles.detailIcon}>📍</Text>
                          <Text style={styles.detailLabel}>Location</Text>
                        </View>
                        <View style={styles.detailValueContainer}>
                          <Text style={styles.detailValue}>
                            {selectedDispatch.location_name || "Unknown"}
                          </Text>
                          {selectedDispatch.latitude &&
                            selectedDispatch.longitude && (
                              <Text style={styles.detailSubValue}>
                                {selectedDispatch.latitude.toFixed(4)},{" "}
                                {selectedDispatch.longitude.toFixed(4)}
                              </Text>
                            )}
                        </View>
                      </View>

                      <View style={styles.detailRow}>
                        <View style={styles.detailLabelContainer}>
                          <Text style={styles.detailIcon}>🕒</Text>
                          <Text style={styles.detailLabel}>Submitted At</Text>
                        </View>
                        <Text style={styles.detailValue}>
                          {new Date(selectedDispatch.submitted_at).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.statusCard}>
                    <View style={styles.detailLabelContainer}>
                      <Text style={styles.detailIcon}>✓</Text>
                      <Text style={styles.detailLabel}>Status</Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadgeLarge,
                        {
                          backgroundColor:
                            getStatusColor(selectedDispatch.status) + "20",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusTextLarge,
                          { color: getStatusColor(selectedDispatch.status) },
                        ]}
                      >
                        {selectedDispatch.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
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
  emptyState: { paddingVertical: theme.spacing.xl, alignItems: "center" },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    paddingVertical: theme.spacing.lg,
  },

  /* DISPATCH ROW */
  dispatchRow: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  dispatchRowLast: {
    borderBottomWidth: 0,
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
  },
  dispatchVehicle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    marginBottom: 2,
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
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  /* MODAL */
  modalScreen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  modalKeyboard: {
    flex: 1,
  },
  modalContent: {
    padding: theme.spacing.lg,
    flexGrow: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.lg,
  },
  modalHeaderSpacer: {
    width: 40,
  },
  modalTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    flex: 1,
    textAlign: "center",
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "600",
  },

  /* DISPATCH PHOTO */
  dispatchPhoto: {
    width: "100%",
    height: 250,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.border,
    marginBottom: theme.spacing.lg,
  },

  /* DETAIL CARD */
  detailCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  detailSection: {
    marginBottom: 0,
  },
  detailSectionTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: theme.spacing.md,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: theme.spacing.md,
  },
  detailLabelContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  detailIcon: {
    fontSize: 16,
    marginRight: theme.spacing.xs,
  },
  detailLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  detailValue: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },
  detailValueContainer: {
    flex: 1,
    alignItems: "flex-end",
  },
  detailSubValue: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    marginTop: 2,
  },

  /* STATUS CARD */
  statusCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusBadgeLarge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  statusTextLarge: {
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase",
  },
});