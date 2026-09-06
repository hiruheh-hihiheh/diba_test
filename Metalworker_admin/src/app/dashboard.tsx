import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "../constants/theme";
import {
  createWorkerUser,
  deleteWorker,
  fetchWorkers,
  updateWorkerProfile,
  updateWorkerUsername,
} from "../services/admin";
import { supabase } from "../services/supabase";
import type { Profile } from "../types/profile";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

/*
  ============================
  HELPERS
  ============================
*/

function formatLastLogin(dateStr?: string | null): string {
  if (!dateStr) return "Never logged in";

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Never logged in";

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday) return `Today at ${timeStr}`;
  if (isYesterday) return `Yesterday at ${timeStr}`;

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/*
  ============================
  SUB-COMPONENTS
  ============================
*/

function StatCard({
  title,
  value,
  color,
  icon,
}: {
  title: string;
  value: number;
  color: string;
  icon: string;
}) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <View style={[styles.statIcon, { backgroundColor: color + "15" }]}>
        <Text style={[styles.statIconText, { color }]}>{icon}</Text>
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );
}

function WorkerRow({
  worker,
  onEdit,
  onDelete,
}: {
  worker: Profile;
  onEdit: (w: Profile) => void;
  onDelete: (w: Profile) => void;
}) {
  return (
    <View style={styles.workerRow}>
      <View style={styles.workerRowMain}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {worker.username.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={styles.workerInfo}>
          <View style={styles.workerNameRow}>
            <Text style={styles.workerName} numberOfLines={1}>
              {worker.username}
            </Text>
            <View
              style={[
                styles.statusBadge,
                worker.is_active ? styles.statusActive : styles.statusInactive,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  worker.is_active ? styles.statusTextActive : styles.statusTextInactive,
                ]}
              >
                {worker.is_active ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>

          {worker.full_name ? (
            <Text style={styles.muted} numberOfLines={1}>
              {worker.full_name}
            </Text>
          ) : null}

          <Text style={styles.mutedSmall}>
            Created {new Date(worker.created_at).toLocaleDateString()} •{" "}
            {formatLastLogin(worker.last_login_at)}
          </Text>
        </View>
      </View>

      <View style={styles.workerActions}>
        <Pressable
          onPress={() => onEdit(worker)}
          style={styles.actionBtn}
        >
          <Text style={styles.actionText}>Edit</Text>
        </Pressable>
        <Pressable
          onPress={() => onDelete(worker)}
          style={styles.actionBtnDanger}
        >
          <Text style={styles.actionTextDanger}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DispatchNavCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.dispatchCard}>
      <View style={styles.dispatchCardContent}>
        <View style={styles.dispatchCardIcon}>
          <Text style={styles.dispatchCardIconText}>📦</Text>
        </View>
        <View style={styles.dispatchCardText}>
          <Text style={styles.dispatchCardTitle}>Dispatch Management</Text>
          <Text style={styles.dispatchCardSubtitle}>
            View and manage submitted dispatches
          </Text>
        </View>
        <View style={styles.dispatchCardArrow}>
          <Text style={styles.dispatchCardArrowText}>→</Text>
        </View>
      </View>
    </Pressable>
  );
}

/*
  ============================
  MAIN SCREEN
  ============================
*/

export default function DashboardScreen() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [workers, setWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  // Add Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addMessage, setAddMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Profile | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editLoading, setEditLoading] = useState(false);
  const [editMessage, setEditMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const adminUsername = session?.user.email?.split("@")[0] ?? "admin";

  /*
    ============================
    SESSION & DATA LOADING
    ============================
  */

  useEffect(() => {
    let mounted = true;

    const initializeSession = async () => {
      const { data } = await supabase.auth.getSession();

      if (mounted) {
        setSession(data.session);
        setSessionLoading(false);
      }
    };

    initializeSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) {
        setSession(newSession);
        setSessionLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadWorkers = useCallback(async () => {
    try {
      setLoading(true);
      const list = await fetchWorkers();
      setWorkers(list);
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to load workers."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) loadWorkers();
  }, [session, loadWorkers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadWorkers();
    setRefreshing(false);
  }, [loadWorkers]);

  /*
    ============================
    COMPUTED DATA
    ============================
  */

  const stats = useMemo(() => {
    const total = workers.length;
    const active = workers.filter((w) => w.is_active).length;
    return { total, active, inactive: total - active };
  }, [workers]);

  const filteredWorkers = useMemo(() => {
    let result = workers;
    if (filter === "active") result = result.filter((w) => w.is_active);
    if (filter === "inactive") result = result.filter((w) => !w.is_active);

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (w) =>
          w.username.toLowerCase().includes(q) ||
          (w.full_name ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [workers, filter, search]);

  /*
    ============================
    ADD WORKER LOGIC
    ============================
  */

  async function handleCreate() {
    setAddMessage(null);
    const cleanUsername = addUsername.trim().toLowerCase();

    if (!cleanUsername || !addPassword) {
      setAddMessage({ type: "error", text: "Please enter username and password." });
      return;
    }

    if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
      setAddMessage({
        type: "error",
        text: "Username must be 3-30 characters (letters, numbers, dots, underscores, hyphens).",
      });
      return;
    }

    if (cleanUsername === "admin") {
      setAddMessage({ type: "error", text: "The username 'admin' is reserved." });
      return;
    }

    if (addPassword.length < 6) {
      setAddMessage({
        type: "error",
        text: "Password must contain at least 6 characters.",
      });
      return;
    }

    try {
      setAddLoading(true);
      const result = await createWorkerUser(cleanUsername, addPassword);

      if (!result.ok) {
        setAddMessage({
          type: "error",
          text: result.error ?? "Failed to create worker login.",
        });
        return;
      }

      setAddMessage({
        type: "success",
        text: `Worker "${cleanUsername}" created successfully.`,
      });
      setAddUsername("");
      setAddPassword("");
      await loadWorkers();
    } catch (error) {
      setAddMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setAddLoading(false);
    }
  }

  /*
    ============================
    EDIT WORKER LOGIC
    ============================
  */

  function openEdit(worker: Profile) {
    setEditingWorker(worker);
    setEditFullName(worker.full_name ?? "");
    setEditUsername(worker.username);
    setEditIsActive(worker.is_active);
    setEditMessage(null);
    setShowEditModal(true);
  }

  async function handleEditSave() {
    if (!editingWorker) return;
    setEditMessage(null);
    setEditLoading(true);

    try {
      const profileRes = await updateWorkerProfile(editingWorker.id, {
        full_name: editFullName.trim(),
        is_active: editIsActive,
      });

      if (!profileRes.ok) {
        setEditMessage({
          type: "error",
          text: profileRes.error || "Failed to update profile.",
        });
        setEditLoading(false);
        return;
      }

      const cleanUsername = editUsername.trim().toLowerCase();
      if (cleanUsername !== editingWorker.username.toLowerCase()) {
        const usernameRes = await updateWorkerUsername(
          editingWorker.id,
          cleanUsername
        );
        if (!usernameRes.ok) {
          setEditMessage({
            type: "error",
            text: usernameRes.error || "Failed to update username.",
          });
          setEditLoading(false);
          return;
        }
      }

      setEditMessage({ type: "success", text: "Worker updated successfully." });
      await loadWorkers();

      setTimeout(() => {
        setShowEditModal(false);
        setEditMessage(null);
      }, 1000);
    } catch (error) {
      setEditMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setEditLoading(false);
    }
  }

  /*
    ============================
    DELETE WORKER LOGIC
    ============================
  */

  function handleDelete(worker: Profile) {
    const performDelete = async () => {
      try {
        const res = await deleteWorker(worker.id);

        if (res.ok) {
          await loadWorkers();
        } else {
          if (Platform.OS === "web") {
            window.alert(res.error || "Failed to delete worker.");
          } else {
            Alert.alert("Error", res.error || "Failed to delete worker.");
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to delete worker.";

        if (Platform.OS === "web") {
          window.alert(message);
        } else {
          Alert.alert("Error", message);
        }
      }
    };

    if (Platform.OS === "web") {
      const confirmed = window.confirm(
        `Are you sure you want to delete "${worker.username}"?\n\nThis will permanently remove their account and authentication credentials.`
      );

      if (confirmed) {
        performDelete();
      }

      return;
    }

    Alert.alert(
      "Delete Worker",
      `Are you sure you want to delete "${worker.username}"? This will permanently remove their account and authentication credentials.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: performDelete,
        },
      ]
    );
  }

  /*
    ============================
    LOGOUT
    ============================
  */
  async function handleLogout() {
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        Alert.alert("Logout Failed", error.message);
        return;
      }

      setSession(null);
      setWorkers([]);

      router.dismissAll();
      router.replace("/login");
    } catch (error) {
      Alert.alert(
        "Logout Failed",
        error instanceof Error
          ? error.message
          : "Unable to logout. Please try again."
      );
    }
  }

  /*
    ============================
    RENDER
    ============================
  */
  useEffect(() => {
    if (!sessionLoading && !session) {
      router.replace("/login");
    }
  }, [session, sessionLoading, router]);

  if (sessionLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>Worker Management</Text>
            <Text style={styles.headerSub}>
              Signed in as{" "}
              <Text style={styles.headerSubBold}>{adminUsername}</Text>
            </Text>
          </View>
          <Pressable onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>

        {/* DISPATCH NAVIGATION CARD */}
        <DispatchNavCard onPress={() => router.push("/dispatch")} />

        {/* STATS */}
        <View style={styles.statsRow}>
          <StatCard
            title="Total"
            value={stats.total}
            color={theme.colors.primary}
            icon="👥"
          />
          <StatCard
            title="Active"
            value={stats.active}
            color={theme.colors.success}
            icon="✓"
          />
          <StatCard
            title="Inactive"
            value={stats.inactive}
            color={theme.colors.danger}
            icon="✕"
          />
        </View>

        {/* SEARCH & FILTER */}
        <View style={styles.searchSection}>
          <Input
            placeholder="Search workers..."
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />

          <View style={styles.filterRow}>
            {(["all", "active", "inactive"] as const).map((f) => (
              <Pressable
                key={f}
                style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
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
          </View>

          <Button
            title="+ Add New Worker"
            onPress={() => {
              setAddMessage(null);
              setAddUsername("");
              setAddPassword("");
              setShowAddModal(true);
            }}
          />
        </View>

        {/* WORKER LIST */}
        <View style={styles.listCard}>
          <View style={styles.workerHeader}>
            <Text style={styles.cardTitle}>
              Workers ({filteredWorkers.length})
            </Text>
            <Pressable onPress={onRefresh} disabled={refreshing}>
              <Text style={styles.refreshText}>
                {refreshing ? "Refreshing..." : "Refresh"}
              </Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : filteredWorkers.length === 0 ? (
            <Text style={styles.emptyText}>
              {search || filter !== "all"
                ? "No workers match your search or filter."
                : "No workers yet. Add your first worker above."}
            </Text>
          ) : (
            <FlatList
              data={filteredWorkers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <WorkerRow
                  worker={item}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              )}
              scrollEnabled={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            />
          )}
        </View>
      </ScrollView>

      {/* ADD MODAL */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalScreen} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            style={styles.modalKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.modalTitle}>Add Worker</Text>
              <Text style={styles.modalDesc}>
                Create a new username and password for a worker.
              </Text>

              <Input
                label="USERNAME"
                autoCapitalize="none"
                autoCorrect={false}
                value={addUsername}
                onChangeText={setAddUsername}
                placeholder="e.g. raju"
              />
              <Input
                label="PASSWORD"
                secureTextEntry
                value={addPassword}
                onChangeText={setAddPassword}
                placeholder="Minimum 6 characters"
              />

              {addMessage && (
                <Text
                  style={
                    addMessage.type === "success" ? styles.success : styles.error
                  }
                >
                  {addMessage.text}
                </Text>
              )}

              <Button
                title="Create Worker"
                loading={addLoading}
                onPress={handleCreate}
              />
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setShowAddModal(false)}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* EDIT MODAL */}
      <Modal
        visible={showEditModal}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.modalScreen} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            style={styles.modalKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.modalTitle}>Edit Worker</Text>

              <Input
                label="FULL NAME"
                value={editFullName}
                onChangeText={setEditFullName}
                placeholder="e.g. Raju Sharma"
              />
              <Input
                label="USERNAME"
                autoCapitalize="none"
                autoCorrect={false}
                value={editUsername}
                onChangeText={setEditUsername}
                placeholder="e.g. raju"
              />

              <View style={styles.toggleContainer}>
                <Text style={styles.label}>STATUS</Text>
                <Pressable
                  style={[
                    styles.toggleBtn,
                    editIsActive ? styles.toggleActive : styles.toggleInactive,
                  ]}
                  onPress={() => setEditIsActive(!editIsActive)}
                >
                  <Text style={styles.toggleText}>
                    {editIsActive ? "Active" : "Inactive"}
                  </Text>
                </Pressable>
              </View>

              {editMessage && (
                <Text
                  style={
                    editMessage.type === "success" ? styles.success : styles.error
                  }
                >
                  {editMessage.text}
                </Text>
              )}

              <Button
                title="Save Changes"
                loading={editLoading}
                onPress={handleEditSave}
              />
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setShowEditModal(false)}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/*
  ============================
  STYLES
  ============================
*/

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
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xl,
  },
  headerInfo: { flex: 1, marginRight: theme.spacing.md },
  headerTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    marginBottom: 4,
  },
  headerSub: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },
  headerSubBold: {
    fontWeight: "700",
    color: theme.colors.text,
  },
  logoutBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  logoutText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },

  /* DISPATCH NAV CARD */
  dispatchCard: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  dispatchCardContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  dispatchCardIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFFFFF30",
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing.md,
  },
  dispatchCardIconText: {
    fontSize: 28,
  },
  dispatchCardText: {
    flex: 1,
  },
  dispatchCardTitle: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: 2,
  },
  dispatchCardSubtitle: {
    color: "#FFFFFFCC",
    fontSize: theme.textSizes.sm,
  },
  dispatchCardArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF30",
    alignItems: "center",
    justifyContent: "center",
  },
  dispatchCardArrowText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },

  /* STATS */
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: 4,
    padding: theme.spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.sm,
  },
  statIconText: {
    fontSize: 16,
    fontWeight: "700",
  },
  statValue: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    marginBottom: 2,
  },
  statTitle: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    textTransform: "uppercase",
  },

  /* SEARCH & FILTER */
  searchSection: {
    marginBottom: theme.spacing.xl,
  },
  searchRow: { marginBottom: theme.spacing.md },
  filterRow: {
    flexDirection: "row",
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
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
  workerHeader: {
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

  /* WORKER ROW */
  workerRow: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  workerRowMain: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing.md,
  },
  avatarText: { color: "#FFFFFF", fontWeight: "700", fontSize: 18 },
  workerInfo: { flex: 1 },
  workerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  workerName: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusActive: { backgroundColor: theme.colors.success + "20" },
  statusInactive: { backgroundColor: theme.colors.danger + "20" },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  statusTextActive: { color: theme.colors.success },
  statusTextInactive: { color: theme.colors.danger },
  muted: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginBottom: 2,
  },
  mutedSmall: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
  },
  workerActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "flex-end",
  },
  actionBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary + "15",
    minWidth: 70,
    alignItems: "center",
  },
  actionText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  actionBtnDanger: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger + "15",
    minWidth: 70,
    alignItems: "center",
  },
  actionTextDanger: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },

  /* MODALS */
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
  modalTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    marginBottom: 4,
  },
  modalDesc: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginBottom: theme.spacing.lg,
  },
  toggleContainer: { marginBottom: theme.spacing.md },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  toggleBtn: {
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    alignItems: "center",
    borderWidth: 1,
  },
  toggleActive: {
    backgroundColor: theme.colors.success + "20",
    borderColor: theme.colors.success,
  },
  toggleInactive: {
    backgroundColor: theme.colors.danger + "20",
    borderColor: theme.colors.danger,
  },
  toggleText: { fontSize: theme.textSizes.sm, fontWeight: "700" },

  /* MESSAGES */
  success: {
    marginTop: theme.spacing.sm,
    color: theme.colors.success,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    marginBottom: theme.spacing.md,
  },
  error: {
    marginTop: theme.spacing.sm,
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    marginBottom: theme.spacing.md,
  },
});