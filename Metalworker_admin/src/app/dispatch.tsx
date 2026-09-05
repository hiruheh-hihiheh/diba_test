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

import { theme } from "../constants/theme";
import { fetchAdminDispatches, getMaterialLabel, getStatusColor } from "../services/dispatch";
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
      const msg = error instanceof Error ? error.message : "Failed to load dispatches.";
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const filterOptions: (DispatchStatus | "all")[] = ["all", "submitted", "reviewed", "approved", "rejected"];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back to Dashboard</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Dispatch Management</Text>
        </View>

        {/* SEARCH & FILTER */}
        <View style={styles.searchRow}>
          <Input
            placeholder="Search username or vehicle..."
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {filterOptions.map((f) => (
            <Pressable
              key={f}
              style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* DISPATCH LIST */}
        <View style={styles.listCard}>
          <View style={styles.listHeader}>
            <Text style={styles.cardTitle}>
              Dispatches ({filteredDispatches.length})
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
            <Text style={styles.emptyText}>
              {search || filter !== "all"
                ? "No dispatches match your search or filter."
                : "No dispatches found."}
            </Text>
          ) : (
            filteredDispatches.map((dispatch) => (
              <Pressable
                key={dispatch.id}
                style={styles.dispatchRow}
                onPress={() => setSelectedDispatch(dispatch)}
              >
                <View style={styles.dispatchInfo}>
                  <Text style={styles.dispatchUsername}>{dispatch.worker_username}</Text>
                  <Text style={styles.dispatchVehicle}>{dispatch.vehicle_number}</Text>
                  <Text style={styles.dispatchDate}>
                    {new Date(dispatch.submitted_at).toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(dispatch.status) + "20" }]}>
                  <Text style={[styles.statusText, { color: getStatusColor(dispatch.status) }]}>
                    {dispatch.status.toUpperCase()}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>

      {/* DISPATCH DETAIL MODAL */}
      <Modal visible={!!selectedDispatch} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView
          style={styles.modalScreen}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.modalContent}>
            {selectedDispatch && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Dispatch Details</Text>
                  <Pressable onPress={() => setSelectedDispatch(null)}>
                    <Text style={styles.closeBtn}>Close</Text>
                  </Pressable>
                </View>

                <Image
                  source={{ uri: selectedDispatch.photo_url }}
                  style={styles.dispatchPhoto}
                  resizeMode="cover"
                />

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Worker</Text>
                  <Text style={styles.detailValue}>{selectedDispatch.worker_username}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Vehicle Number</Text>
                  <Text style={styles.detailValue}>{selectedDispatch.vehicle_number}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Material</Text>
                  <Text style={styles.detailValue}>{getMaterialLabel(selectedDispatch.material_type)}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Location</Text>
                  <Text style={styles.detailValue}>{selectedDispatch.location_name || "Unknown"}</Text>
                  {selectedDispatch.latitude && selectedDispatch.longitude && (
                    <Text style={styles.detailSubValue}>
                      {selectedDispatch.latitude.toFixed(4)}, {selectedDispatch.longitude.toFixed(4)}
                    </Text>
                  )}
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Submitted At</Text>
                  <Text style={styles.detailValue}>{new Date(selectedDispatch.submitted_at).toLocaleString()}</Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Status</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedDispatch.status) + "20" }]}>
                    <Text style={[styles.statusText, { color: getStatusColor(selectedDispatch.status) }]}>
                      {selectedDispatch.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.background },
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xl },
  header: { marginBottom: theme.spacing.lg },
  backBtn: { marginBottom: theme.spacing.sm },
  backText: { color: theme.colors.primary, fontSize: theme.textSizes.md, fontWeight: "600" },
  headerTitle: { color: theme.colors.text, fontSize: theme.textSizes.xl, fontWeight: "700" },
  
  searchRow: { marginBottom: theme.spacing.md },
  filterRow: { marginBottom: theme.spacing.lg },
  filterBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", marginRight: theme.spacing.sm },
  filterBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  filterText: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm, fontWeight: "600" },
  filterTextActive: { color: "#FFFFFF" },

  listCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.md, marginTop: theme.spacing.md },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.md },
  cardTitle: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "700" },
  refreshText: { color: theme.colors.primary, fontSize: theme.textSizes.sm, fontWeight: "600" },
  emptyState: { paddingVertical: theme.spacing.xl, alignItems: "center" },
  emptyText: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm, textAlign: "center", paddingVertical: theme.spacing.lg },

  dispatchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  dispatchInfo: { flex: 1 },
  dispatchUsername: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "700" },
  dispatchVehicle: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "600", marginTop: 2 },
  dispatchDate: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, marginTop: 4 },
  
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },

  modalScreen: { flex: 1, backgroundColor: theme.colors.background },
  modalContent: { padding: theme.spacing.lg, flexGrow: 1 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.lg },
  modalTitle: { color: theme.colors.text, fontSize: theme.textSizes.lg, fontWeight: "700" },
  closeBtn: { color: theme.colors.primary, fontSize: theme.textSizes.md, fontWeight: "600" },
  
  dispatchPhoto: { width: "100%", height: 250, borderRadius: theme.radius.lg, backgroundColor: theme.colors.border, marginBottom: theme.spacing.lg },
  
  detailRow: { marginBottom: theme.spacing.md },
  detailLabel: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, fontWeight: "600", textTransform: "uppercase", marginBottom: 4 },
  detailValue: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "600" },
  detailSubValue: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm, marginTop: 2 },
});