// src/components/dashboard/WorkerSection.tsx
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useTheme } from "../../context/ThemeContext";
import type { Profile } from "../../types/profile";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { createDashboardStyles } from "./styles";
import { SectionHeader } from "./SectionHeader";

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

export function WorkerRow({
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
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

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
                worker.role === "processor"
                  ? { backgroundColor: theme.colors.primary + "20" }
                  : { backgroundColor: "#8B5CF620" },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  worker.role === "processor"
                    ? { color: theme.colors.primary }
                    : { color: "#8B5CF6" },
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
                  worker.is_active
                    ? styles.statusTextActive
                    : styles.statusTextInactive,
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
          accessibilityRole="button"
          accessibilityLabel={`Edit ${worker.username}`}
        >
          <Text style={styles.actionText}>Edit</Text>
        </Pressable>
        <Pressable
          onPress={() => onDelete(worker)}
          style={styles.actionBtnDanger}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${worker.username}`}
        >
          <Text style={styles.actionTextDanger}>Delete</Text>
        </Pressable>
      </View>
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
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  return (
    <View style={styles.folderContainer}>
      <Pressable
        style={styles.folderHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${title} users, ${users.length}. ${isExpanded ? "Collapse" : "Expand"}`}
      >
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
              <Text style={styles.emptyFolderText}>
                No {title.toLowerCase()} users yet.
              </Text>
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

export function WorkerSection({
  userTotal,
  filteredCount,
  loading,
  workerError,
  refreshing,
  search,
  filter,
  labourExpanded,
  processorExpanded,
  labourUsers,
  processorUsers,
  flashMessage,
  onSearchChange,
  onFilterChange,
  onToggleLabour,
  onToggleProcessor,
  onAddUser,
  onRefresh,
  onRetryWorkers,
  onEdit,
  onDelete,
}: {
  userTotal: number;
  filteredCount: number;
  loading: boolean;
  workerError: string | null;
  refreshing: boolean;
  search: string;
  filter: "all" | "active" | "inactive";
  labourExpanded: boolean;
  processorExpanded: boolean;
  labourUsers: Profile[];
  processorUsers: Profile[];
  flashMessage: { type: "success" | "error"; text: string } | null;
  onSearchChange: (value: string) => void;
  onFilterChange: (filter: "all" | "active" | "inactive") => void;
  onToggleLabour: () => void;
  onToggleProcessor: () => void;
  onAddUser: () => void;
  onRefresh: () => void;
  onRetryWorkers: () => void;
  onEdit: (w: Profile) => void;
  onDelete: (w: Profile) => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  return (
    <>
      <View style={styles.divider} />

      <SectionHeader
        title="User Management"
        subtitle={`${userTotal} Users`}
      />

      {/* Transient action feedback */}
      {flashMessage ? (
        <View
          style={[
            styles.flashBanner,
            flashMessage.type === "error" && styles.flashBannerError,
          ]}
        >
          <Text
            style={[
              styles.flashText,
              flashMessage.type === "error" && styles.flashTextError,
            ]}
          >
            {flashMessage.type === "error" ? "⚠ " : "✓ "}
            {flashMessage.text}
          </Text>
        </View>
      ) : null}

      {/* Search & filter */}
      <View style={styles.searchSection}>
        <Input
          placeholder="Search users..."
          value={search}
          onChangeText={onSearchChange}
          autoCapitalize="none"
          accessibilityLabel="Search users"
        />

        <View style={styles.filterRow}>
          {(["all", "active", "inactive"] as const).map((f) => (
            <Pressable
              key={f}
              style={[
                styles.filterBtn,
                filter === f && styles.filterBtnActive,
              ]}
              onPress={() => onFilterChange(f)}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${f}`}
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

        <Button title="+ Add New User" onPress={onAddUser} />
      </View>

      {/* Worker list */}
      <View style={styles.listCard}>
        <View style={styles.workerHeader}>
          <Text style={styles.cardTitle}>Users ({filteredCount})</Text>
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
        ) : workerError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>
              Failed to load users: {workerError}
            </Text>
            <Pressable onPress={onRetryWorkers}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.foldersWrapper}>
            <FolderSection
              title="LABOUR"
              users={labourUsers}
              isExpanded={labourExpanded}
              onToggle={onToggleLabour}
              onEdit={onEdit}
              onDelete={onDelete}
            />
            <FolderSection
              title="PROCESSOR"
              users={processorUsers}
              isExpanded={processorExpanded}
              onToggle={onToggleProcessor}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </View>
        )}
      </View>
    </>
  );
}