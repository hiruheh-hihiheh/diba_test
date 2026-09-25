// src/app/jobs-labour.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../constants/theme";
import { supabase } from "../services/supabase";
import { fetchJobsByType } from "../services/jobs";
import type { Job } from "../types/job";
import { Input } from "../components/ui/Input";
import { JobEditModal } from "../components/jobs/JobEditModal";
import { JobDrawingModal } from "../components/jobs/JobDrawingModal";

export default function JobsLabourScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [drawingModalJob, setDrawingModalJob] = useState<Job | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      const list = await fetchJobsByType("labour");
      setJobs(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load jobs.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadJobs();
    setRefreshing(false);
  }, [loadJobs]);

  const filteredJobs = useMemo(() => {
    if (!search.trim()) return jobs;
    const q = search.toLowerCase();
    return jobs.filter(
      (j) =>
        (j.job_no ?? "").toLowerCase().includes(q) ||
        (j.po_status ?? "").toLowerCase().includes(q) ||
        (j.tool_description ?? "").toLowerCase().includes(q) ||
        (j.tool_part ?? "").toLowerCase().includes(q) ||
        (j.quantity?.toString() ?? "").toLowerCase().includes(q) ||
        (j.current_machining_status ?? "").toLowerCase().includes(q) ||
        (j.status ?? "").toLowerCase().includes(q) ||
        (j.drawing_status ?? "").toLowerCase().includes(q) ||
        (j.model_status ?? "").toLowerCase().includes(q)
    );
  }, [jobs, search]);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>Labour Jobs</Text>
            <Text style={styles.headerSubtitle}>
              {filteredJobs.length} {filteredJobs.length === 1 ? "Job" : "Jobs"}
            </Text>
          </View>
        </View>

        {/* Search */}
        <Input
          placeholder="Search jobs..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />

        <View style={styles.spacer} />

        {/* List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : filteredJobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🧰</Text>
            <Text style={styles.emptyTitle}>
              {search ? "No Results" : "No Labour Jobs"}
            </Text>
            <Text style={styles.emptyText}>
              {search
                ? "Try a different search term."
                : "No labour jobs available."}
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {filteredJobs.map((item) => (
              <Pressable 
                key={item.id} 
                style={({ pressed }) => [styles.jobCard, pressed && styles.jobCardPressed]}
                onPress={() => setEditingJob(item)}
              >
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
                    <Text style={styles.detailValue}>{item.expected_completion_date || "—"}</Text>
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
            ))}
          </View>
        )}
      </ScrollView>

      <JobEditModal
        visible={!!editingJob}
        onClose={() => setEditingJob(null)}
        job={editingJob}
        onSaved={() => {
          setEditingJob(null);
          loadJobs();
        }}
      />

      <JobDrawingModal
        visible={!!drawingModalJob}
        onClose={() => setDrawingModalJob(null)}
        job={drawingModalJob}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  },
  backBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  headerInfo: {},
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
  listCard: {
    gap: theme.spacing.md,
  },
  jobCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
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
    paddingVertical: 2,
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
});
