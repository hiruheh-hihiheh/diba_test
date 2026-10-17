// src/components/dashboard/WorkerSection.tsx
//
// Team management on the dashboard. Behaviour is unchanged — search, filter,
// two collapsible role groups, add/edit/delete — but rows now read as people
// rather than as database records: initials avatar, name first, role and
// status as badges, and the destructive action visually separated.
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { Profile } from "../../types/profile";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { Reveal } from "../ui/Reveal";
import { SearchBar } from "../ui/SearchBar";
import { Section } from "../ui/Section";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SkeletonCard } from "../ui/Skeleton";

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

function initialsFor(worker: Profile): string {
  const source = (worker.full_name ?? "").trim() || worker.username;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
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
  const styles = useMemo(() => createStyles(theme), [theme]);
  const roleLabel = worker.role === "processor" ? "Processor" : "Labour";

  return (
    <View style={[styles.row, !isLast && styles.rowDivider]}>
      <View
        style={[
          styles.avatar,
          {
            backgroundColor:
              worker.role === "processor"
                ? theme.colors.primarySoft
                : theme.colors.infoMuted,
          },
        ]}
      >
        <Text
          style={[
            styles.avatarText,
            {
              color:
                worker.role === "processor"
                  ? theme.colors.primary
                  : theme.colors.info,
            },
          ]}
        >
          {initialsFor(worker)}
        </Text>
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <View style={styles.rowNameWrap}>
            <Text style={styles.name} numberOfLines={1}>
              {worker.full_name?.trim() || worker.username}
            </Text>
            <Text style={styles.username} numberOfLines={1}>
              @{worker.username}
            </Text>
          </View>
          <View style={styles.rowActions}>
            <IconButton
              icon="pencil"
              accessibilityLabel={`Edit ${worker.username}`}
              onPress={() => onEdit(worker)}
              variant="soft"
              size={32}
              iconSize={15}
            />
            <IconButton
              icon="trash"
              accessibilityLabel={`Delete ${worker.username}`}
              onPress={() => onDelete(worker)}
              variant="soft"
              size={32}
              iconSize={15}
              color={theme.colors.danger}
            />
          </View>
        </View>

        <View style={styles.rowMeta}>
          <Badge
            label={roleLabel}
            tone={worker.role === "processor" ? "primary" : "info"}
          />
          <Badge
            label={worker.is_active ? "Active" : "Inactive"}
            tone={worker.is_active ? "success" : "danger"}
            dot
          />
          <Text style={styles.lastLogin} numberOfLines={1}>
            {formatLastLogin(worker.last_login_at)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function RoleGroup({
  title,
  icon,
  users,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  last,
}: {
  title: string;
  icon: "hammer" | "settings";
  users: Profile[];
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: (w: Profile) => void;
  onDelete: (w: Profile) => void;
  last?: boolean;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={!last && styles.groupDivider}>
      <Pressable
        style={styles.groupHeader}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={`${title} users, ${users.length}. ${
          isExpanded ? "Collapse" : "Expand"
        }`}
      >
        <View style={styles.groupIcon}>
          <Icon
            name={icon}
            size={16}
            color={title === "Labour" ? theme.colors.info : theme.colors.primary}
          />
        </View>
        <Text style={styles.groupTitle}>{title}</Text>
        <View style={styles.groupCount}>
          <Text style={styles.groupCountText}>{users.length}</Text>
        </View>
        <View
          style={{
            transform: [{ rotate: isExpanded ? "90deg" : "0deg" }],
          }}
        >
          <Icon name="chevronRight" size={16} color={theme.colors.textMuted} />
        </View>
      </Pressable>

      {isExpanded ? (
        <Reveal>
          <View style={styles.groupBody}>
            {users.length === 0 ? (
              <Text style={styles.groupEmpty}>
                No {title.toLowerCase()} users yet.
              </Text>
            ) : (
              users.map((worker, index) => (
                <WorkerRow
                  key={worker.id}
                  worker={worker}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  isLast={index === users.length - 1}
                />
              ))
            )}
          </View>
        </Reveal>
      ) : null}
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
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View>
      <Section
        title="Team"
        subtitle={`${userTotal} ${userTotal === 1 ? "account" : "accounts"} · ${filteredCount} shown`}
        actionLabel="Add user"
        onAction={onAddUser}
      />

      <SearchBar
        value={search}
        onChangeText={onSearchChange}
        placeholder="Search name or username"
        accessibilityLabel="Search team members"
        autoCapitalize="none"
        accessory={
          <IconButton
            icon="refresh"
            accessibilityLabel="Refresh team"
            onPress={onRefresh}
            variant="ghost"
            size={30}
            iconSize={16}
            disabled={refreshing}
            style={{ opacity: refreshing ? 0.5 : 1 }}
          />
        }
      />

      <SegmentedControl
        accessibilityLabel="Filter team by status"
        value={filter}
        onChange={onFilterChange}
        options={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ]}
        style={styles.filter}
      />

      {flashMessage ? (
        <View
          style={[
            styles.flash,
            {
              backgroundColor:
                flashMessage.type === "error"
                  ? theme.colors.dangerMuted
                  : theme.colors.successMuted,
            },
          ]}
        >
          <Icon
            name={flashMessage.type === "error" ? "alert" : "checkCircle"}
            size={15}
            color={
              flashMessage.type === "error" ? theme.colors.danger : theme.colors.success
            }
          />
          <Text
            style={[
              styles.flashText,
              {
                color:
                  flashMessage.type === "error"
                    ? theme.colors.danger
                    : theme.colors.success,
              },
            ]}
          >
            {flashMessage.text}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.skeletons}>
          <SkeletonCard lines={1} />
          <SkeletonCard lines={1} />
        </View>
      ) : workerError ? (
        <View style={styles.errorBanner}>
          <Icon name="alert" size={16} color={theme.colors.danger} />
          <Text style={styles.errorText}>Failed to load users: {workerError}</Text>
          <Pressable onPress={onRetryWorkers} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : filteredCount === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Icon name="users" size={20} color={theme.colors.textMuted} />
          </View>
          <Text style={styles.emptyTitle}>No users match</Text>
          <Text style={styles.emptyText}>
            {search || filter !== "all"
              ? "Try a different search or status filter."
              : "Add the first team account to get started."}
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <RoleGroup
            title="Labour"
            icon="hammer"
            users={labourUsers}
            isExpanded={labourExpanded}
            onToggle={onToggleLabour}
            onEdit={onEdit}
            onDelete={onDelete}
          />
          <RoleGroup
            title="Processor"
            icon="settings"
            users={processorUsers}
            isExpanded={processorExpanded}
            onToggle={onToggleProcessor}
            onEdit={onEdit}
            onDelete={onDelete}
            last
          />
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    filter: { marginTop: theme.spacing.sm },
    skeletons: { marginTop: theme.spacing.md, gap: 0 },
    flash: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 11,
      borderRadius: theme.radius.md,
      marginTop: theme.spacing.sm,
    },
    flashText: { flex: 1, fontSize: theme.textSizes.xs, fontWeight: "600" },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.colors.dangerMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger + "55",
      padding: 12,
      marginTop: theme.spacing.md,
    },
    errorText: { flex: 1, color: theme.colors.danger, fontSize: theme.textSizes.xs },
    retryText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    empty: {
      alignItems: "center",
      paddingVertical: theme.spacing.xl,
      marginTop: theme.spacing.sm,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.border,
      gap: 3,
    },
    emptyIcon: {
      width: 40,
      height: 40,
      borderRadius: 13,
      backgroundColor: theme.colors.surfaceHover,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    emptyText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      textAlign: "center",
      maxWidth: 260,
    },
    card: {
      marginTop: theme.spacing.sm + 2,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
      ...theme.elevation.card,
    },
    groupDivider: {
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    groupHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 54,
    },
    groupIcon: {
      width: 30,
      height: 30,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceHover,
    },
    groupTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    groupCount: {
      minWidth: 24,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceHover,
      alignItems: "center",
    },
    groupCountText: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    groupBody: { paddingHorizontal: 12 },
    groupEmpty: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      paddingVertical: theme.spacing.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingVertical: 12,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontSize: 13, fontWeight: "800", letterSpacing: 0.2 },
    rowBody: { flex: 1, minWidth: 0 },
    rowTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 4,
    },
    rowNameWrap: { flex: 1, minWidth: 0 },
    name: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    username: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 1,
    },
    rowActions: { flexDirection: "row", gap: 4, marginTop: -4 },
    rowMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexWrap: "wrap",
      marginTop: 7,
    },
    lastLogin: {
      color: theme.colors.textMuted,
      fontSize: 11,
      flexShrink: 1,
    },
  });
