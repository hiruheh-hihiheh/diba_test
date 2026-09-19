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
import {
  fetchAdminDispatches,
  getMaterialLabel,
  getStatusColor,
} from "../services/dispatch";
import { supabase } from "../services/supabase";
import type { Profile } from "../types/profile";
import type { Dispatch } from "../types/dispatch";

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

function formatDispatchDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "—";

  const timeStr = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const dateFormatted = date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `${dateFormatted}, ${timeStr}`;
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

function DispatchRow({
  dispatch,
  onPress,
}: {
  dispatch: Dispatch;
  onPress: (d: Dispatch) => void;
}) {
  const statusColor = getStatusColor(dispatch.status);
  return (
    <Pressable onPress={() => onPress(dispatch)} style={styles.dispatchRow}>
      <View style={styles.dispatchRowTop}>
        <View style={styles.dispatchRowInfo}>
          <Text style={styles.dispatchWorkerName} numberOfLines={1}>
            {dispatch.worker_username}
          </Text>
          <Text style={styles.dispatchMeta} numberOfLines={1}>
            {dispatch.vehicle_number} • {getMaterialLabel(dispatch.material_type)}
          </Text>
        </View>
        <View
          style={[
            styles.dispatchStatusBadge,
            { backgroundColor: statusColor + "20" },
          ]}
        >
          <Text style={[styles.dispatchStatusText, { color: statusColor }]}>
            {dispatch.status.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={styles.dispatchDate}>
        {formatDispatchDate(dispatch.submitted_at)}
      </Text>
    </Pressable>
  );
}

function WorkerRow({
  worker,
  onEdit,
  onDelete,
  isLast,
}: {
  worker: Profile;
  onEdit: (w: Profile) => void;
  onDelete: (w: Profile) => void;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.workerRow, isLast && styles.lastWorkerRow]}>
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
                worker.role === "processor" ? { backgroundColor: theme.colors.primary + "20" } : { backgroundColor: "#8B5CF620" }
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  worker.role === "processor" ? { color: theme.colors.primary } : { color: "#8B5CF6" }
                ]}
              >
                {worker.role === "processor" ? "PROCESSOR" : "LABOUR"}
              </Text>
            </View>
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

function SectionHeader({
  title,
  subtitle,
  rightElement,
}: {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      {rightElement}
    </View>
  );
}

function FolderSection({
  title,
  users,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  title: string;
  users: Profile[];
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: (w: Profile) => void;
  onDelete: (w: Profile) => void;
}) {
  return (
    <View style={styles.folderContainer}>
      <Pressable style={styles.folderHeader} onPress={onToggle}>
        <View style={styles.folderHeaderLeft}>
          <Text style={styles.folderIcon}>📁</Text>
          <Text style={styles.folderTitle}>{title}</Text>
          <View style={styles.folderCountBadge}>
            <Text style={styles.folderCountText}>{users.length}</Text>
          </View>
        </View>
        <Text style={styles.folderToggleIcon}>
          {isExpanded ? "▲" : "▼"}
        </Text>
      </Pressable>

      {isExpanded && (
        <View style={styles.folderContent}>
          {users.length === 0 ? (
            <View style={styles.emptyFolder}>
              <Text style={styles.emptyFolderText}>No {title.toLowerCase()} users yet.</Text>
            </View>
          ) : (
            users.map((item, index) => (
              <WorkerRow
                key={item.id}
                worker={item}
                onEdit={onEdit}
                onDelete={onDelete}
                isLast={index === users.length - 1}
              />
            ))
          )}
        </View>
      )}
    </View>
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

  // Dispatch data
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [dispatchLoading, setDispatchLoading] = useState(true);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

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

  const loadDispatches = useCallback(async () => {
    try {
      setDispatchLoading(true);
      setDispatchError(null);
      const res = await fetchAdminDispatches();
      if (res.ok && res.data) {
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

  useEffect(() => {
    if (session) {
      loadWorkers();
      loadDispatches();
    }
  }, [session, loadWorkers, loadDispatches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadWorkers(), loadDispatches()]);
    setRefreshing(false);
  }, [loadWorkers, loadDispatches]);

  /*
    ============================
    COMPUTED DATA
    ============================
  */

  const workerStats = useMemo(() => {
    const total = workers.length;
    const active = workers.filter((w) => w.is_active).length;
    return { total, active, inactive: total - active };
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

  const labourUsers = useMemo(() => filteredWorkers.filter(w => w.role === "worker"), [filteredWorkers]);
  const processorUsers = useMemo(() => filteredWorkers.filter(w => w.role === "processor"), [filteredWorkers]);

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
        if (editingWorker.role === "processor" && !cleanUsername.endsWith("_processor")) {
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

      setEditMessage({ type: "success", text: "User updated successfully." });
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* ==============================
            SECTION 1 — HEADER
            ============================== */}
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>MetalWorker Admin</Text>
            <Text style={styles.headerSubtitleLine}>
              Dispatch & Workforce Overview
            </Text>
            <Text style={styles.headerSub}>
              Signed in as{" "}
              <Text style={styles.headerSubBold}>{adminUsername}</Text>
            </Text>
          </View>
          <Pressable onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>

        {/* ==============================
            SECTION 2 — OVERVIEW STATISTICS
            ============================== */}
        <SectionHeader title="Overview" />

        <View style={styles.overviewGrid}>
          <StatCard
            title="Total Workers"
            value={workerStats.total}
            color={theme.colors.primary}
            icon="👥"
          />
          <StatCard
            title="Active Workers"
            value={workerStats.active}
            color={theme.colors.success}
            icon="✓"
          />
          <StatCard
            title="Total Dispatches"
            value={dispatchStats.total}
            color={theme.colors.primary}
            icon="📦"
          />
          <StatCard
            title="Needs Review"
            value={dispatchStats.submitted}
            color="#F59E0B"
            icon="⏳"
          />
          <StatCard
            title="Approved"
            value={dispatchStats.approved}
            color={theme.colors.success}
            icon="✓"
          />
          <StatCard
            title="Rejected"
            value={dispatchStats.rejected}
            color={theme.colors.danger}
            icon="✕"
          />
        </View>

        {dispatchLoading && (
          <View style={styles.inlineLoader}>
            <ActivityIndicator
              size="small"
              color={theme.colors.primary}
            />
            <Text style={styles.inlineLoaderText}>
              Loading dispatch data...
            </Text>
          </View>
        )}

        {dispatchError && !dispatchLoading && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>
              ⚠ {dispatchError}
            </Text>
            <Pressable onPress={loadDispatches}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* ==============================
            SECTION 3 — NEEDS ATTENTION
            ============================== */}
        <SectionHeader
          title="Needs Attention"
          subtitle="Dispatches awaiting review"
        />

        <View style={styles.sectionCard}>
          {dispatchLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : needsAttention.length === 0 ? (
            <View style={styles.emptyStateCard}>
              <Text style={styles.emptyStateIcon}>✓</Text>
              <Text style={styles.emptyStateTitle}>All Clear</Text>
              <Text style={styles.emptyStateText}>
                No dispatches require attention.
              </Text>
            </View>
          ) : (
            <>
              {needsAttention.map((d) => (
                <DispatchRow
                  key={d.id}
                  dispatch={d}
                  onPress={handleDispatchPress}
                />
              ))}
            </>
          )}

          <Pressable
            style={styles.viewAllBtn}
            onPress={() => router.push("/dispatch")}
          >
            <Text style={styles.viewAllText}>View All Dispatches →</Text>
          </Pressable>
        </View>

        {/* ==============================
            SECTION 4 — RECENT DISPATCHES
            ============================== */}
        <SectionHeader
          title="Recent Dispatches"
          subtitle="Latest activity"
        />

        <View style={styles.sectionCard}>
          {dispatchLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : recentDispatches.length === 0 ? (
            <View style={styles.emptyStateCard}>
              <Text style={styles.emptyStateIcon}>📦</Text>
              <Text style={styles.emptyStateTitle}>No Dispatches Yet</Text>
              <Text style={styles.emptyStateText}>
                Dispatch records will appear here once workers submit them.
              </Text>
            </View>
          ) : (
            <>
              {recentDispatches.map((d) => (
                <DispatchRow
                  key={d.id}
                  dispatch={d}
                  onPress={handleDispatchPress}
                />
              ))}
            </>
          )}

          <Pressable
            style={styles.viewAllBtn}
            onPress={() => router.push("/dispatch")}
          >
            <Text style={styles.viewAllText}>View All Dispatches →</Text>
          </Pressable>
        </View>

        {/* ==============================
            SECTION 5 — QUICK ACTIONS
            ============================== */}
        <SectionHeader title="Quick Actions" />

        <View style={styles.quickActionsRow}>
          <Pressable
            style={styles.quickActionCard}
            onPress={() => router.push("/dispatch")}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: theme.colors.primary + "20" },
              ]}
            >
              <Text style={styles.quickActionIconText}>📦</Text>
            </View>
            <Text style={styles.quickActionLabel}>View Dispatches</Text>
          </Pressable>

          <Pressable
            style={styles.quickActionCard}
            onPress={() => {
              setAddMessage(null);
              setAddUsername("");
              setAddPassword("");
              setShowAddModal(true);
            }}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: theme.colors.success + "20" },
              ]}
            >
              <Text style={styles.quickActionIconText}>+</Text>
            </View>
            <Text style={styles.quickActionLabel}>Add Worker</Text>
          </Pressable>

          <Pressable
            style={styles.quickActionCard}
            onPress={onRefresh}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: "#F59E0B" + "20" },
              ]}
            >
              <Text style={styles.quickActionIconText}>↻</Text>
            </View>
            <Text style={styles.quickActionLabel}>Refresh All</Text>
          </Pressable>
        </View>

        {/* ==============================
            SECTION 5B — ADMIN NAVIGATION
            ============================== */}
        <View style={styles.divider} />

        <SectionHeader
          title="Stock"
          subtitle="Manage stock records"
        />
        <View style={styles.quickActionsRow}>
          <Pressable
            style={styles.quickActionCard}
            onPress={() => router.push("/stock-owner")}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: "#3B82F6" + "20" },
              ]}
            >
              <Text style={styles.quickActionIconText}>🏠</Text>
            </View>
            <Text style={styles.quickActionLabel}>Stock by Owner</Text>
          </Pressable>

          <Pressable
            style={styles.quickActionCard}
            onPress={() => router.push("/stock-company")}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: "#8B5CF6" + "20" },
              ]}
            >
              <Text style={styles.quickActionIconText}>🏭</Text>
            </View>
            <Text style={styles.quickActionLabel}>Stock by Company</Text>
          </Pressable>
        </View>

        <SectionHeader
          title="Documents"
          subtitle="Bills & drawings"
        />
        <View style={styles.quickActionsRow}>
          <Pressable
            style={styles.quickActionCard}
            onPress={() => router.push("/group-bills")}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: "#F59E0B" + "20" },
              ]}
            >
              <Text style={styles.quickActionIconText}>📄</Text>
            </View>
            <Text style={styles.quickActionLabel}>Group Bill</Text>
          </Pressable>

          <Pressable
            style={styles.quickActionCard}
            onPress={() => router.push("/group-drawings")}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: theme.colors.success + "20" },
              ]}
            >
              <Text style={styles.quickActionIconText}>✏️</Text>
            </View>
            <Text style={styles.quickActionLabel}>Group Drawing</Text>
          </Pressable>
        </View>

        <SectionHeader
          title="Folders"
          subtitle="Organize items"
        />
        <View style={styles.quickActionsRow}>
          <Pressable
            style={styles.quickActionCard}
            onPress={() => router.push("/folders")}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: theme.colors.primary + "20" },
              ]}
            >
              <Text style={styles.quickActionIconText}>📁</Text>
            </View>
            <Text style={styles.quickActionLabel}>Manage Folders</Text>
          </Pressable>
        </View>

        {/* ==============================
            SECTION 6 — WORKER MANAGEMENT
            ============================== */}
        <View style={styles.divider} />

        <SectionHeader
          title="Worker Management"
          subtitle={`${workerStats.total} Workers`}
        />

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
          ) : (
            <View style={styles.foldersWrapper}>
              <FolderSection
                title="LABOUR"
                users={labourUsers}
                isExpanded={labourExpanded}
                onToggle={() => setLabourExpanded(!labourExpanded)}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
              <FolderSection
                title="PROCESSOR"
                users={processorUsers}
                isExpanded={processorExpanded}
                onToggle={() => setProcessorExpanded(!processorExpanded)}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            </View>
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
    marginBottom: 2,
  },
  headerSubtitleLine: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    marginBottom: 6,
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
    paddingVertical: theme.spacing.xs + 4,
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

  /* SECTION HEADERS */
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  sectionHeaderLeft: {
    flex: 1,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
  },
  sectionSubtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    marginTop: 2,
  },

  /* OVERVIEW GRID */
  overviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },

  /* STATS */
  statCard: {
    width: "48%" as unknown as number,
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: "47%" as unknown as number,
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

  /* INLINE LOADER */
  inlineLoader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  inlineLoaderText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },

  /* ERROR BANNER */
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.danger + "15",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.danger + "40",
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
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

  /* SECTION CARD */
  sectionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.xl,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  /* DISPATCH ROW */
  dispatchRow: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  dispatchRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  dispatchRowInfo: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  dispatchWorkerName: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: 2,
  },
  dispatchMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },
  dispatchStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  dispatchStatusText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  dispatchDate: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    marginTop: 2,
  },

  /* EMPTY STATES */
  emptyState: { paddingVertical: theme.spacing.xl, alignItems: "center" },
  emptyStateCard: {
    alignItems: "center",
    paddingVertical: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
  },
  emptyStateIcon: {
    fontSize: 32,
    marginBottom: theme.spacing.sm,
  },
  emptyStateTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: 4,
  },
  emptyStateText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    paddingVertical: theme.spacing.lg,
  },

  /* VIEW ALL BTN */
  viewAllBtn: {
    marginTop: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary + "15",
    alignItems: "center",
  },
  viewAllText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },

  /* QUICK ACTIONS */
  quickActionsRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  quickActionCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.sm,
  },
  quickActionIconText: {
    fontSize: 20,
    fontWeight: "700",
  },
  quickActionLabel: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    textAlign: "center",
  },

  /* DIVIDER */
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginBottom: theme.spacing.lg,
  },

  /* SEARCH & FILTER */
  searchSection: {
    marginBottom: theme.spacing.xl,
  },
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

  /* FOLDER STYLES */
  foldersWrapper: {
    gap: theme.spacing.md,
  },
  folderContainer: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  folderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  folderHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  folderIcon: {
    fontSize: 20,
  },
  folderTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  folderCountBadge: {
    backgroundColor: theme.colors.primary + "15",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: theme.spacing.xs,
  },
  folderCountText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.xs,
    fontWeight: "700",
  },
  folderToggleIcon: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
  },
  folderContent: {
    paddingHorizontal: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  emptyFolder: {
    paddingVertical: theme.spacing.lg,
    alignItems: "center",
  },
  emptyFolderText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },
  lastWorkerRow: {
    borderBottomWidth: 0,
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