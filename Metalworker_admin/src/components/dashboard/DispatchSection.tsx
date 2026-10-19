// src/components/dashboard/DispatchSection.tsx
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { getMaterialLabel } from "../../services/dispatch";
import type { Dispatch } from "../../types/dispatch";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { Section } from "../ui/Section";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SkeletonCard } from "../ui/Skeleton";

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
  });

  return `${dateFormatted} · ${timeStr}`;
}

function statusTone(status: Dispatch["status"]): BadgeTone {
  switch (status) {
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    case "reviewed":
      return "info";
    default:
      return "warning";
  }
}

function DispatchRow({
  dispatch,
  onPress,
  divider,
}: {
  dispatch: Dispatch;
  onPress: (d: Dispatch) => void;
  divider: boolean;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const tone = statusTone(dispatch.status);

  return (
    <Pressable
      onPress={() => onPress(dispatch)}
      accessibilityRole="button"
      accessibilityLabel={`Dispatch by ${dispatch.worker_username}, ${dispatch.status}`}
      style={({ pressed }) => [
        styles.row,
        divider && styles.rowDivider,
        pressed && { backgroundColor: theme.colors.surfaceHover },
      ]}
    >
      <View style={styles.rowIcon}>
        <Icon name="truck" size={17} color={theme.colors.primary} />
      </View>

      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {dispatch.worker_username}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {dispatch.vehicle_number} · {getMaterialLabel(dispatch.material_type, dispatch.custom_material)}
        </Text>
        <Text style={styles.rowDate}>{formatDispatchDate(dispatch.submitted_at)}</Text>
      </View>

      <View style={styles.rowTrailing}>
        <Badge label={dispatch.status.toUpperCase()} tone={tone} />
        <Icon name="chevronRight" size={14} color={theme.colors.textMuted} />
      </View>
    </Pressable>
  );
}

export function DispatchSection({
  dispatchLoading,
  dispatchError,
  needsAttention,
  recentDispatches,
  onPressDispatch,
  onRetryDispatches,
  onViewAll,
}: {
  dispatchLoading: boolean;
  dispatchError: string | null;
  needsAttention: Dispatch[];
  recentDispatches: Dispatch[];
  onPressDispatch: (d: Dispatch) => void;
  onRetryDispatches: () => void;
  onViewAll: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [tab, setTab] = useState<"review" | "recent">("review");

  const rows = tab === "review" ? needsAttention : recentDispatches;

  return (
    <View>
      <Section
        title="Dispatches"
        subtitle="Approvals and recent activity"
        actionLabel="View all"
        onAction={onViewAll}
      />

      <View style={styles.card}>
        <SegmentedControl
          accessibilityLabel="Dispatch view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "review", label: "Needs review", count: needsAttention.length },
            { value: "recent", label: "Recent" },
          ]}
          style={styles.tabs}
        />

        {dispatchLoading ? (
          <>
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
          </>
        ) : dispatchError ? (
          <View style={styles.errorBanner}>
            <Icon name="alert" size={16} color={theme.colors.danger} />
            <Text style={styles.errorText}>{dispatchError}</Text>
            <Pressable onPress={onRetryDispatches} accessibilityRole="button">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Icon name="checkCircle" size={22} color={theme.colors.success} />
            </View>
            <Text style={styles.emptyTitle}>
              {tab === "review" ? "All caught up" : "No dispatches yet"}
            </Text>
            <Text style={styles.emptyText}>
              {tab === "review"
                ? "Nothing is waiting for review right now."
                : "Worker submissions will appear here once they are sent."}
            </Text>
          </View>
        ) : (
          rows.map((dispatch, index) => (
            <DispatchRow
              key={dispatch.id}
              dispatch={dispatch}
              onPress={onPressDispatch}
              divider={index !== rows.length - 1}
            />
          ))
        )}
      </View>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 10,
      ...theme.elevation.card,
    },
    tabs: { marginBottom: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 11,
      paddingHorizontal: 6,
      borderRadius: theme.radius.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: "transparent",
    },
    rowDivider: { borderBottomColor: theme.colors.border },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.primarySoft,
    },
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    rowMeta: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.caption,
      marginTop: 1,
    },
    rowDate: {
      color: theme.colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    rowTrailing: { alignItems: "flex-end", gap: 6 },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.colors.dangerMuted,
      borderRadius: theme.radius.md,
      padding: 12,
      margin: 6,
    },
    errorText: { flex: 1, color: theme.colors.danger, fontSize: theme.textSizes.xs },
    retryText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    empty: { alignItems: "center", paddingVertical: theme.spacing.lg, gap: 4 },
    emptyIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: theme.colors.successMuted,
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
  });
