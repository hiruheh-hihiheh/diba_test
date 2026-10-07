// src/app/dashboard.tsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
import {
  createWorkerUser,
  deleteWorker,
  fetchWorkers,
  updateWorkerProfile,
  updateWorkerUsername,
} from "../services/admin";
import { fetchSystemCounts, type SystemCounts } from "../services/counts";
import { fetchAdminDispatches } from "../services/dispatch";
import type { Profile } from "../types/profile";
import type { Dispatch } from "../types/dispatch";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { notify } from "../utils/notify";
import {
  StatGrid,
  DispatchSection,
  WorkerSection,
  QuickActions,
} from "../components/dashboard";

export default function DashboardScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const router = useRouter();
  const { session, checking: sessionLoading } = useAdminGate();

  const [workers, setWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Transient banner for completed user actions (success / errors).
  const [flashMessage, setFlashMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = useCallback(
    (type: "success" | "error", text: string) => {
      setFlashMessage({ type, text });
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashMessage(null), 3500);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // Dispatch data
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [dispatchLoading, setDispatchLoading] = useState(true);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  // System overview counts (jobs / folders / stock / documents)
  const [systemCounts, setSystemCounts] = useState<SystemCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  const [labourExpanded, setLabourExpanded] = useState(true);
  const [processorExpanded, setProcessorExpanded] = useState(false);

  // Add Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRole, setAddRole] = useState<"worker" | "processor">("worker");
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

  // Worker delete confirmation. `Alert.alert` is a no-op on react-native-web
  // and `window.confirm` is unthemed/blocking, so both platforms use the
  // shared ConfirmDialog modal.
  const [pendingDeleteWorker, setPendingDeleteWorker] = useState<Profile | null>(
    null
  );
  const [deletingWorkerId, setDeletingWorkerId] = useState<string | null>(null);

  /*
    ============================
    SESSION & DATA LOADING
    ============================
  */

  const loadCounts = useCallback(async () => {
    try {
      const counts = await fetchSystemCounts();
      setCountsError(null);
      setSystemCounts(counts);
    } catch (error) {
      setCountsError(
        error instanceof Error ? error.message : "Failed to load system counts."
      );
    } finally {
      setCountsLoading(false);
    }
  }, []);

  const loadWorkers = useCallback(async () => {
    try {
      const list = await fetchWorkers();
      setWorkerError(null);
      setWorkers(list);
    } catch (error) {
      setWorkerError(
        error instanceof Error ? error.message : "Failed to load workers."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDispatches = useCallback(async () => {
    try {
      const res = await fetchAdminDispatches();
      if (res.ok && res.data) {
        setDispatchError(null);
        setDispatches(res.data);
      } else {
        setDispatchError(res.error || "Failed to load dispatches.");
      }
    } catch (error) {
      setDispatchError(
        error instanceof Error ? error.message : "Failed to load dispatches."
      );
    } finally {
      setDispatchLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (session) {
        void loadWorkers();
        void loadDispatches();
        void loadCounts();
      }
    }, [session, loadWorkers, loadDispatches, loadCounts])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadWorkers(), loadDispatches(), loadCounts()]);
    setRefreshing(false);
  }, [loadWorkers, loadDispatches, loadCounts]);

  const onNavigate = useCallback(
    (route: string) => {
      router.push(route as never);
    },
    [router]
  );

  const openAddModal = useCallback(() => {
    setAddMessage(null);
    setAddUsername("");
    setAddPassword("");
    setShowAddModal(true);
  }, []);

  /*
    ============================
    COMPUTED DATA
    ============================
  */

  const userStats = useMemo(() => {
    const total = workers.length;
    const labour = workers.filter((w) => w.role === "worker").length;
    const processor = workers.filter((w) => w.role === "processor").length;
    const active = workers.filter((w) => w.is_active).length;
    const inactive = total - active;
    return { total, labour, processor, active, inactive };
  }, [workers]);

  const dispatchStats = useMemo(() => {
    const total = dispatches.length;
    const submitted = dispatches.filter((d) => d.status === "submitted").length;
    const reviewed = dispatches.filter((d) => d.status === "reviewed").length;
    const approved = dispatches.filter((d) => d.status === "approved").length;
    const rejected = dispatches.filter((d) => d.status === "rejected").length;
    return { total, submitted, reviewed, approved, rejected };
  }, [dispatches]);

  const needsAttention = useMemo(() => {
    return dispatches
      .filter((d) => d.status === "submitted")
      .sort(
        (a, b) =>
          new Date(b.submitted_at).getTime() -
          new Date(a.submitted_at).getTime()
      )
      .slice(0, 5);
  }, [dispatches]);

  const recentDispatches = useMemo(() => {
    return [...dispatches]
      .sort(
        (a, b) =>
          new Date(b.submitted_at).getTime() -
          new Date(a.submitted_at).getTime()
      )
      .slice(0, 5);
  }, [dispatches]);

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

  const labourUsers = useMemo(
    () => filteredWorkers.filter((w) => w.role === "worker"),
    [filteredWorkers]
  );
  const processorUsers = useMemo(
    () => filteredWorkers.filter((w) => w.role === "processor"),
    [filteredWorkers]
  );

  /*
    ============================
    DISPATCH ROW NAVIGATION
    ============================
  */

  function handleDispatchPress(dispatch: Dispatch) {
    router.push({ pathname: "/dispatch-details", params: { id: dispatch.id } });
  }

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

    if (addRole === "processor" && !cleanUsername.endsWith("_processor")) {
      setAddMessage({
        type: "error",
        text: "Processor usernames must end with _processor.",
      });
      return;
    }

    if (addRole === "worker" && cleanUsername.endsWith("_processor")) {
      setAddMessage({
        type: "error",
        text: "Worker usernames cannot end with _processor.",
      });
      return;
    }

    try {
      setAddLoading(true);
      const result = await createWorkerUser(cleanUsername, addPassword, addRole);

      if (!result.ok) {
        setAddMessage({
          type: "error",
          text: result.error ?? "Failed to create worker login.",
        });
        return;
      }

      setAddMessage({
        type: "success",
        text: `User "${cleanUsername}" created successfully.`,
      });
      setAddUsername("");
      setAddPassword("");
      setAddRole("worker");
      await loadWorkers();
      showFlash("success", `User "${cleanUsername}" created successfully.`);
      setShowAddModal(false);
      setAddMessage(null);
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

    const cleanUsername = editUsername.trim().toLowerCase();

    // Validate the username up-front. This check previously ran AFTER the
    // profile write had already been committed — an invalid suffix reported a
    // failure while full_name/is_active silently persisted anyway.
    const usernameChanging = cleanUsername !== editingWorker.username.toLowerCase();
    if (usernameChanging) {
      if (
        editingWorker.role === "processor" &&
        !cleanUsername.endsWith("_processor")
      ) {
        setEditMessage({
          type: "error",
          text: "Processor usernames must end with _processor.",
        });
        setEditLoading(false);
        return;
      }

      if (editingWorker.role === "worker" && cleanUsername.endsWith("_processor")) {
        setEditMessage({
          type: "error",
          text: "Worker usernames cannot end with _processor.",
        });
        setEditLoading(false);
        return;
      }
    }

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

      if (usernameChanging) {
        const usernameRes = await updateWorkerUsername(
          editingWorker.id,
          cleanUsername
        );
        if (!usernameRes.ok) {
          // The profile write already committed. Be explicit about the partial
          // state and refresh the list so it shows the true persisted values —
          // otherwise the admin sees stale data and may re-submit.
          await loadWorkers();
          setEditMessage({
            type: "error",
            text:
              (usernameRes.error || "Failed to update username.") +
              " Name/status were saved, but the username was not changed.",
          });
          showFlash(
            "error",
            `Name/status saved, but username change failed: ${
              usernameRes.error ?? "unknown error"
            }`
          );
          return;
        }
      }

      setEditMessage({ type: "success", text: "User updated successfully." });
      await loadWorkers();

      showFlash("success", `User "${cleanUsername}" updated successfully.`);
      setShowEditModal(false);
      setEditMessage(null);
    } catch (error) {
      // Refresh from the backend so the list reflects whichever step(s)
      // committed even if the sequence threw part-way through.
      await loadWorkers();
      setEditMessage({
        type: "error",
        text:
          (error instanceof Error ? error.message : "Something went wrong.") +
          (usernameChanging
            ? " Some changes may have been saved before the failure."
            : ""),
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
    setPendingDeleteWorker(worker);
  }

  /** Perform the worker delete; shared by the ConfirmDialog. */
  async function performDelete() {
    const worker = pendingDeleteWorker;
    if (!worker) return;

    setDeletingWorkerId(worker.id);
    try {
      const res = await deleteWorker(worker.id);

      if (res.ok) {
        await loadWorkers();
        showFlash("success", `User "${worker.username}" deleted.`);

        // The edge function can complete the auth-account deletion while some
        // related rows fail. That is a real partial failure and must not be
        // swallowed — the profile is already gone, so the user would have no
        // way of knowing their access is not fully removed.
        if (res.warning) {
          showFlash("error", `User "${worker.username}" was deleted, but: ${res.warning}`);
        }
      } else {
        notify("Error", res.error || "Failed to delete worker.");
      }
    } catch (error) {
      notify(
        "Error",
        error instanceof Error ? error.message : "Failed to delete worker."
      );
    } finally {
      setDeletingWorkerId(null);
      setPendingDeleteWorker(null);
    }
  }

  /*
    ============================
    RENDER
    ============================
  */
  if (sessionLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <StatGrid
          userStats={userStats}
          dispatchStats={dispatchStats}
          systemCounts={systemCounts}
          countsLoading={countsLoading}
          countsError={countsError}
          onRetryCounts={loadCounts}
          onNavigate={onNavigate}
        />

        <DispatchSection
          dispatchLoading={dispatchLoading}
          dispatchError={dispatchError}
          needsAttention={needsAttention}
          recentDispatches={recentDispatches}
          onPressDispatch={handleDispatchPress}
          onRetryDispatches={loadDispatches}
          onViewAll={() => router.push("/dispatch")}
        />

        <QuickActions onNavigate={onNavigate} />

        <WorkerSection
          userTotal={userStats.total}
          filteredCount={filteredWorkers.length}
          loading={loading}
          workerError={workerError}
          refreshing={refreshing}
          search={search}
          filter={filter}
          labourExpanded={labourExpanded}
          processorExpanded={processorExpanded}
          labourUsers={labourUsers}
          processorUsers={processorUsers}
          flashMessage={flashMessage}
          onSearchChange={setSearch}
          onFilterChange={setFilter}
          onToggleLabour={() => setLabourExpanded(!labourExpanded)}
          onToggleProcessor={() => setProcessorExpanded(!processorExpanded)}
          onAddUser={openAddModal}
          onRefresh={onRefresh}
          onRetryWorkers={loadWorkers}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </ScrollView>

      {/* DELETE CONFIRM (web + native) */}
      <ConfirmDialog
        visible={pendingDeleteWorker !== null}
        title={pendingDeleteWorker ? `Delete "${pendingDeleteWorker.username}"?` : "Delete user"}
        message="This will permanently remove the user's account and authentication credentials."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        busy={deletingWorkerId !== null}
        onConfirm={() => {
          void performDelete();
        }}
        onCancel={() => {
          if (deletingWorkerId === null) setPendingDeleteWorker(null);
        }}
      />

      {/* ADD MODAL */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        <SafeAreaView style={styles.modalScreen} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            style={styles.modalKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.modalTitle}>Add User</Text>
              <Text style={styles.modalDesc}>
                Create a new username and password for a Labour or Processor.
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

              <View style={styles.toggleContainer}>
                <Text style={styles.label}>ROLE</Text>
                <View style={{ flexDirection: "row", marginTop: 8 }}>
                  <Pressable
                    style={[
                      styles.toggleBtn,
                      addRole === "worker" ? styles.toggleActive : styles.toggleInactive,
                      { flex: 1, marginRight: 8 },
                    ]}
                    onPress={() => setAddRole("worker")}
                    accessibilityRole="button"
                    accessibilityLabel="Labour role"
                  >
                    <Text style={styles.toggleText}>Labour</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.toggleBtn,
                      addRole === "processor" ? styles.toggleActive : styles.toggleInactive,
                      { flex: 1 },
                    ]}
                    onPress={() => setAddRole("processor")}
                    accessibilityRole="button"
                    accessibilityLabel="Processor role"
                  >
                    <Text style={styles.toggleText}>Processor</Text>
                  </Pressable>
                </View>
              </View>

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
                title={addRole === "processor" ? "Create Processor" : "Create Labour"}
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
        onRequestClose={() => setShowEditModal(false)}
      >
        <SafeAreaView style={styles.modalScreen} edges={["top", "bottom"]}>
          <KeyboardAvoidingView
            style={styles.modalKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView contentContainerStyle={styles.modalContent}>
              <Text style={styles.modalTitle}>
                Edit {editingWorker?.role === "processor" ? "Processor" : "Labour"}
              </Text>

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
                  accessibilityRole="button"
                  accessibilityLabel="Toggle active status"
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
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
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

    /* ADD / EDIT MODAL SHELLS */
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