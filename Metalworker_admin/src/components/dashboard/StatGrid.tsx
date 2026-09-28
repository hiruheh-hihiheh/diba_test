// src/components/dashboard/StatGrid.tsx
import React from "react";
import type { SystemCounts } from "../../services/counts";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";

import { useTheme } from "../../context/ThemeContext";
import { createDashboardStyles } from "./styles";
import { SectionHeader } from "./SectionHeader";

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

export function StatCard({
  title,
  value,
  color,
  icon,
  onPress,
}: {
  title: string;
  value: number;
  color: string;
  icon: string;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  const card = (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <View style={[styles.statIcon, { backgroundColor: color + "15" }]}>
        <Text style={[styles.statIconText, { color }]}>{icon}</Text>
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );

  if (!onPress) return card;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}. Open ${title}`}
      style={({ pressed }) => [
        { flexGrow: 1, flexBasis: "47%" },
        pressed && { opacity: 0.8 },
      ]}
    >
      {card}
    </Pressable>
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
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  return (
    <>
      <SectionHeader title="Overview" />

      <View style={styles.overviewGrid}>
        <StatCard
          title="Labour"
          value={userStats.labour}
          color="#8B5CF6"
          icon="🛠️"
        />
        <StatCard
          title="Processor"
          value={userStats.processor}
          color={theme.colors.primary}
          icon="⚙️"
        />
        <StatCard
          title="Active Users"
          value={userStats.active}
          color={theme.colors.success}
          icon="✓"
        />
        <StatCard
          title="Inactive Users"
          value={userStats.inactive}
          color={theme.colors.textMuted}
          icon="✕"
        />
        <StatCard
          title="Total Dispatches"
          value={dispatchStats.total}
          color={theme.colors.primary}
          icon="📦"
          onPress={() => onNavigate("/dispatch")}
        />
        <StatCard
          title="Needs Review"
          value={dispatchStats.submitted}
          color="#F59E0B"
          icon="⏳"
          onPress={() => onNavigate("/dispatch")}
        />
        <StatCard
          title="Approved"
          value={dispatchStats.approved}
          color={theme.colors.success}
          icon="✓"
          onPress={() => onNavigate("/dispatch")}
        />
        <StatCard
          title="Rejected"
          value={dispatchStats.rejected}
          color={theme.colors.danger}
          icon="✕"
          onPress={() => onNavigate("/dispatch")}
        />
      </View>

      <SectionHeader
        title="System Overview"
        subtitle="Jobs, stock, folders & documents"
      />

      {countsLoading ? (
        <View style={styles.inlineLoader}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.inlineLoaderText}>
            Loading system overview...
          </Text>
        </View>
      ) : countsError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠ {countsError}</Text>
          <Pressable onPress={onRetryCounts}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : systemCounts ? (
        <View style={styles.overviewGrid}>
          <StatCard
            title="Labour Jobs"
            value={systemCounts.jobsLabour}
            color="#F59E0B"
            icon="🧰"
            onPress={() => onNavigate("/jobs-labour")}
          />
          <StatCard
            title="Material Jobs"
            value={systemCounts.jobsWithMaterial}
            color="#10B981"
            icon="🔩"
            onPress={() => onNavigate("/jobs-with-material")}
          />
          <StatCard
            title="Folders"
            value={systemCounts.folders}
            color={theme.colors.primary}
            icon="📁"
            onPress={() => onNavigate("/folders")}
          />
          <StatCard
            title="Owner Stock"
            value={systemCounts.ownerStock}
            color={theme.colors.primary}
            icon="🏠"
            onPress={() => onNavigate("/stock-owner")}
          />
          <StatCard
            title="Company Stock"
            value={systemCounts.companyStock}
            color="#8B5CF6"
            icon="🏭"
            onPress={() => onNavigate("/stock-company")}
          />
          <StatCard
            title="Bill Groups"
            value={systemCounts.billGroups}
            color="#F59E0B"
            icon="📄"
            onPress={() => onNavigate("/group-bills")}
          />
          <StatCard
            title="Drawing Groups"
            value={systemCounts.drawingGroups}
            color={theme.colors.success}
            icon="✏️"
            onPress={() => onNavigate("/group-drawings")}
          />
        </View>
      ) : null}
    </>
  );
}