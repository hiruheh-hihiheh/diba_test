// src/components/dashboard/StatGrid.tsx
//
// The dashboard overview: three high-signal KPIs, then the workspace totals as
// compact tappable tiles. Previously this was fifteen large stat cards, which
// pushed the actual work (dispatch review and team management) far below the
// fold. Counts and destinations are unchanged.
import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { SystemCounts } from "../../services/counts";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { PressableScale } from "../ui/PressableScale";
import { Section } from "../ui/Section";
import { SkeletonCard } from "../ui/Skeleton";

export interface DashboardUserStats {
  total: number;
  labour: number;
  processor: number;
  active: number;
  inactive: number;
}

export interface DashboardDispatchStats {
  total: number;
  submitted: number;
  reviewed: number;
  approved: number;
  rejected: number;
}

function KpiTile({
  label,
  value,
  caption,
  icon,
  iconColor,
  onPress,
}: {
  label: string;
  value: number;
  caption: string;
  icon: IconName;
  iconColor: string;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const body = (
    <View style={styles.kpi}>
      <View style={styles.kpiTop}>
        <View style={[styles.kpiIcon, { backgroundColor: iconColor + "1F" }]}>
          <Icon name={icon} size={15} color={iconColor} />
        </View>
        <Text style={styles.kpiLabel} numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiCaption} numberOfLines={1}>
        {caption}
      </Text>
    </View>
  );

  if (!onPress) return <View style={styles.kpiWrap}>{body}</View>;

  return (
    <PressableScale
      onPress={onPress}
      style={styles.kpiWrap}
      accessibilityLabel={`${label}: ${value}. ${caption}`}
    >
      {body}
    </PressableScale>
  );
}

function WorkspaceTile({
  label,
  value,
  icon,
  color,
  wide = false,
  loading = false,
  onPress,
}: {
  label: string;
  value: number;
  icon: IconName;
  color: string;
  wide?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <PressableScale
      onPress={onPress}
      style={[styles.tile, wide && styles.tileWide]}
      accessibilityLabel={`${label}: ${value}. Open ${label}`}
    >
      <View style={styles.tileRow}>
        <View style={[styles.tileIcon, { backgroundColor: color + "1F" }]}>
          <Icon name={icon} size={15} color={color} />
        </View>
        <Text style={styles.tileValue}>{loading ? "—" : value}</Text>
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

export function StatGrid({
  userStats,
  dispatchStats,
  systemCounts,
  countsLoading,
  countsError,
  onRetryCounts,
  onNavigate,
}: {
  userStats: DashboardUserStats;
  dispatchStats: DashboardDispatchStats;
  systemCounts: SystemCounts | null;
  countsLoading: boolean;
  countsError: string | null;
  onRetryCounts: () => void;
  onNavigate: (route: string) => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.wrap}>
      <Section overline="Overview" title="At a glance" />

      <View style={styles.kpiRow}>
        <KpiTile
          label="Team"
          value={userStats.total}
          caption={`${userStats.active} active`}
          icon="users"
          iconColor={theme.colors.info}
        />
        <KpiTile
          label="Dispatches"
          value={dispatchStats.total}
          caption={
            dispatchStats.submitted > 0
              ? `${dispatchStats.submitted} to review`
              : "All reviewed"
          }
          icon="truck"
          iconColor={
            dispatchStats.submitted > 0 ? theme.colors.warning : theme.colors.success
          }
          onPress={() => onNavigate("/dispatch")}
        />
        <KpiTile
          label="Folders"
          value={systemCounts?.folders ?? 0}
          caption={countsLoading ? "Loading…" : "Organised items"}
          icon="folder"
          iconColor={theme.colors.primary}
          onPress={() => onNavigate("/folders")}
        />
      </View>

      {countsError ? (
        <View style={styles.errorBanner}>
          <Icon name="alert" size={16} color={theme.colors.danger} />
          <Text style={styles.errorText}>{countsError}</Text>
          <PressableScale onPress={onRetryCounts} accessibilityLabel="Retry loading counts">
            <Text style={styles.retryText}>Retry</Text>
          </PressableScale>
        </View>
      ) : null}

      <Section
        title="Workspace"
        subtitle="Jobs, stock and document groups"
        style={styles.workspaceSection}
      />

      {countsLoading ? (
        <>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={1} />
        </>
      ) : systemCounts ? (
        <View style={styles.tileGrid}>
          <WorkspaceTile
            label="Labour Jobs"
            value={systemCounts.jobsLabour}
            icon="hammer"
            color={theme.colors.warning}
            onPress={() => onNavigate("/jobs-labour")}
          />
          <WorkspaceTile
            label="Material Jobs"
            value={systemCounts.jobsWithMaterial}
            icon="box"
            color={theme.colors.success}
            onPress={() => onNavigate("/jobs-with-material")}
          />
          <WorkspaceTile
            label="Owner Stock"
            value={systemCounts.ownerStock}
            icon="users"
            color={theme.colors.info}
            onPress={() => onNavigate("/stock-owner")}
          />
          <WorkspaceTile
            label="Company Stock"
            value={systemCounts.companyStock}
            icon="building"
            color={theme.colors.primary}
            onPress={() => onNavigate("/stock-company")}
          />
          <WorkspaceTile
            label="Bill Groups"
            value={systemCounts.billGroups}
            icon="layers"
            color={theme.colors.primary}
            onPress={() => onNavigate("/group-bills")}
          />
          <WorkspaceTile
            label="Drawing Groups"
            value={systemCounts.drawingGroups}
            icon="image"
            color={theme.colors.success}
            onPress={() => onNavigate("/group-drawings")}
          />
        </View>
      ) : (
        <Card inset>
          <View style={styles.countsEmpty}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.countsEmptyText}>Loading workspace totals…</Text>
          </View>
        </Card>
      )}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: { gap: 0 },
    kpiRow: {
      flexDirection: "row",
      gap: theme.spacing.sm,
    },
    kpiWrap: { flex: 1 },
    kpi: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 12,
      minHeight: 112,
      justifyContent: "space-between",
      ...theme.elevation.card,
    },
    kpiTop: { flexDirection: "row", alignItems: "center", gap: 6 },
    kpiIcon: {
      width: 26,
      height: 26,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    kpiLabel: {
      flex: 1,
      color: theme.colors.textMuted,
      fontSize: 9.5,
      fontWeight: "700",
      letterSpacing: 0.7,
    },
    kpiValue: {
      color: theme.colors.text,
      fontSize: 27,
      lineHeight: 31,
      fontWeight: "800",
      letterSpacing: -0.8,
      fontVariant: ["tabular-nums"],
      marginTop: 8,
    },
    kpiCaption: {
      color: theme.colors.textMuted,
      fontSize: 10.5,
      marginTop: 1,
    },
    workspaceSection: { marginTop: theme.spacing.lg },
    tileGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing.sm,
    },
    tile: {
      flexBasis: "48%",
      flexGrow: 1,
      minHeight: 78,
      padding: 12,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      justifyContent: "space-between",
      ...theme.elevation.card,
    },
    tileWide: { flexBasis: "100%" },
    tileRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    tileIcon: {
      width: 27,
      height: 27,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    tileValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "800",
      letterSpacing: -0.4,
      fontVariant: ["tabular-nums"],
    },
    tileLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
      marginTop: 8,
    },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      backgroundColor: theme.colors.dangerMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger + "55",
      padding: 12,
      marginTop: theme.spacing.sm,
    },
    errorText: {
      flex: 1,
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
    },
    retryText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    countsEmpty: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
    },
    countsEmptyText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
    },
  });
