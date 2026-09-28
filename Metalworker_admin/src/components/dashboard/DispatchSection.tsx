// src/components/dashboard/DispatchSection.tsx
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useTheme } from "../../context/ThemeContext";
import {
  getMaterialLabel,
  getStatusColor,
} from "../../services/dispatch";
import type { Dispatch } from "../../types/dispatch";
import { createDashboardStyles } from "./styles";
import { SectionHeader } from "./SectionHeader";

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

function DispatchRow({
  dispatch,
  onPress,
}: {
  dispatch: Dispatch;
  onPress: (d: Dispatch) => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);
  const statusColor = getStatusColor(dispatch.status, theme);

  return (
    <Pressable
      onPress={() => onPress(dispatch)}
      style={styles.dispatchRow}
      accessibilityRole="button"
      accessibilityLabel={`Dispatch by ${dispatch.worker_username}, ${dispatch.status}`}
    >
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
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  return (
    <>
      {dispatchLoading && (
        <View style={styles.inlineLoader}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.inlineLoaderText}>
            Loading dispatch data...
          </Text>
        </View>
      )}

      {dispatchError && !dispatchLoading && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠ {dispatchError}</Text>
          <Pressable onPress={onRetryDispatches}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

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
              <DispatchRow key={d.id} dispatch={d} onPress={onPressDispatch} />
            ))}
          </>
        )}

        <Pressable style={styles.viewAllBtn} onPress={onViewAll}>
          <Text style={styles.viewAllText}>View All Dispatches →</Text>
        </Pressable>
      </View>

      <SectionHeader title="Recent Dispatches" subtitle="Latest activity" />

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
              <DispatchRow key={d.id} dispatch={d} onPress={onPressDispatch} />
            ))}
          </>
        )}

        <Pressable style={styles.viewAllBtn} onPress={onViewAll}>
          <Text style={styles.viewAllText}>View All Dispatches →</Text>
        </Pressable>
      </View>
    </>
  );
}