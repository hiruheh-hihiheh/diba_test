// src/app/dashboard.tsx

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";

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
import { BottomSheet } from "../components/ui/BottomSheet";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/IconButton";
import { PressableScale } from "../components/ui/PressableScale";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { notify } from "../utils/notify";
import {
  StatGrid,
  DispatchSection,
  WorkerSection,
  QuickActions,
} from "../components/dashboard";
import { createDashboardStyles } from "../components/dashboard/styles";

/** Presentation-only greeting; it never depends on business data. */
function greetingForHour(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

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
        <View style={styles.loadingMark}>
          <Icon name="hammer" size={24} color={theme.colors.primary} />
        </View>
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      </View>
    );
  }

  const pendingReviews = dispatchStats.submitted;
  const dateLabel = new Date().toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const summary = dispatchLoading
    ? "Syncing your workspace…"
    : `${
        pendingReviews > 0
          ? `${pendingReviews} dispatch${pendingReviews === 1 ? "" : "es"} awaiting review`
          : "Dispatch queue is clear"
      } · ${userStats.active} active team member${userStats.active === 1 ? "" : "s"}`;

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
        {/* ── Greeting + attention ─────────────────────────── */}
        <View>
          <View style={styles.heroTopRow}>
            <Text style={styles.eyebrow}>ADMIN CONSOLE</Text>
            <View style={styles.heroRight}>
              <Text style={styles.dateText}>{dateLabel}</Text>
              <IconButton
                icon="refresh"
                accessibilityLabel="Refresh dashboard"
                onPress={onRefresh}
                variant="soft"
                size={30}
                iconSize={15}
                disabled={refreshing}
              />
            </View>
          </View>
          <Text style={styles.greeting}>{greetingForHour()}</Text>
          <Text style={styles.heroSubtitle}>{summary}</Text>

          <PressableScale
            onPress={() => router.push("/dispatch")}
            accessibilityLabel={
              pendingReviews > 0
                ? `${pendingReviews} dispatches awaiting review. Open dispatches.`
                : "No dispatches waiting. Open dispatches."
            }
            style={[
              styles.attentionCard,
              {
                borderColor:
                  pendingReviews > 0
                    ? theme.colors.primary + "55"
                    : theme.colors.success + "45",
                backgroundColor:
                  pendingReviews > 0
                    ? theme.colors.primarySoft
                    : theme.colors.successMuted,
              },
            ]}
          >
            <View
              style={[
                styles.attentionIcon,
                {
                  backgroundColor:
                    pendingReviews > 0
                      ? theme.colors.primaryMuted
                      : theme.colors.successMuted,
                },
              ]}
            >
              <Icon
                name={pendingReviews > 0 ? "alert" : "checkCircle"}
                size={21}
                color={
                  pendingReviews > 0 ? theme.colors.primary : theme.colors.success
                }
              />
            </View>
            <View style={styles.attentionText}>
              <Text
                style={[
                  styles.attentionEyebrow,
                  {
                    color:
                      pendingReviews > 0
                        ? theme.colors.primary
                        : theme.colors.success,
                  },
                ]}
              >
                {pendingReviews > 0 ? "NEEDS REVIEW" : "ALL CLEAR"}
              </Text>
              <Text style={styles.attentionTitle}>
                {pendingReviews > 0
                  ? `${pendingReviews} dispatch${pendingReviews === 1 ? "" : "es"} waiting`
                  : "No dispatches waiting"}
              </Text>
              <Text style={styles.attentionBody}>
                {pendingReviews > 0
                  ? "Approve or respond to keep work moving."
                  : "New worker submissions will appear here."}
              </Text>
            </View>
            <Icon name="chevronRight" size={16} color={theme.colors.textMuted} />
          </PressableScale>
        </View>

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

        <QuickActions
          onNavigate={onNavigate}
          onAddUser={openAddModal}
          onRefresh={onRefresh}
        />

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
        title={
          pendingDeleteWorker
            ? `Delete "${pendingDeleteWorker.username}"?`
            : "Delete user"
        }
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

      {/* ADD USER */}
      <BottomSheet
        visible={showAddModal}
        onClose={() => {
          if (!addLoading) setShowAddModal(false);
        }}
        title="Add user"
        subtitle="Create a login for a labourer or processor."
        footer={
          <>
            <Button
              title={addRole === "processor" ? "Create processor" : "Create labour"}
              loading={addLoading}
              onPress={handleCreate}
              fullWidth
            />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setShowAddModal(false)}
              fullWidth
            />
          </>
        }
      >
        <Input
          label="Username"
          icon="users"
          autoCapitalize="none"
          autoCorrect={false}
          value={addUsername}
          onChangeText={setAddUsername}
          placeholder="e.g. raju"
        />
        <Input
          label="Password"
          secureTextEntry
          value={addPassword}
          onChangeText={setAddPassword}
          placeholder="Minimum 6 characters"
        />

        <Text style={styles.formLabel}>Role</Text>
        <SegmentedControl
          accessibilityLabel="Account role"
          value={addRole}
          onChange={setAddRole}
          options={[
            { value: "worker", label: "Labour" },
            { value: "processor", label: "Processor" },
          ]}
        />

        {addMessage ? (
          <View
            style={[
              styles.formMessage,
              {
                marginTop: 12,
                backgroundColor:
                  addMessage.type === "error"
                    ? theme.colors.dangerMuted
                    : theme.colors.successMuted,
              },
            ]}
          >
            <Icon
              name={addMessage.type === "error" ? "alert" : "checkCircle"}
              size={15}
              color={
                addMessage.type === "error"
                  ? theme.colors.danger
                  : theme.colors.success
              }
            />
            <Text
              style={[
                styles.formMessageText,
                {
                  color:
                    addMessage.type === "error"
                      ? theme.colors.danger
                      : theme.colors.success,
                },
              ]}
            >
              {addMessage.text}
            </Text>
          </View>
        ) : null}
      </BottomSheet>

      {/* EDIT USER */}
      <BottomSheet
        visible={showEditModal}
        onClose={() => {
          if (!editLoading) setShowEditModal(false);
        }}
        title={`Edit ${editingWorker?.role === "processor" ? "processor" : "labour"}`}
        subtitle={editingWorker ? `@${editingWorker.username}` : undefined}
        footer={
          <>
            <Button
              title="Save changes"
              loading={editLoading}
              onPress={handleEditSave}
              fullWidth
            />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => setShowEditModal(false)}
              fullWidth
            />
          </>
        }
      >
        <Input
          label="Full name"
          value={editFullName}
          onChangeText={setEditFullName}
          placeholder="e.g. Raju Sharma"
        />
        <Input
          label="Username"
          icon="users"
          autoCapitalize="none"
          autoCorrect={false}
          value={editUsername}
          onChangeText={setEditUsername}
          placeholder="e.g. raju"
        />

        <Text style={styles.formLabel}>Status</Text>
        <SegmentedControl
          accessibilityLabel="Account status"
          value={editIsActive ? "active" : "inactive"}
          onChange={(value) => setEditIsActive(value === "active")}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />

        {editMessage ? (
          <View
            style={[
              styles.formMessage,
              {
                marginTop: 12,
                backgroundColor:
                  editMessage.type === "error"
                    ? theme.colors.dangerMuted
                    : theme.colors.successMuted,
              },
            ]}
          >
            <Icon
              name={editMessage.type === "error" ? "alert" : "checkCircle"}
              size={15}
              color={
                editMessage.type === "error"
                  ? theme.colors.danger
                  : theme.colors.success
              }
            />
            <Text
              style={[
                styles.formMessageText,
                {
                  color:
                    editMessage.type === "error"
                      ? theme.colors.danger
                      : theme.colors.success,
                },
              ]}
            >
              {editMessage.text}
            </Text>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}
