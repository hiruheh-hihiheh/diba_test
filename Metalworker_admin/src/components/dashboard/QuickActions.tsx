// src/components/dashboard/QuickActions.tsx
//
// Shortcuts for the tasks an admin starts from the dashboard. The four primary
// actions are one-thumb sized tiles; the remaining destinations stay available
// as a compact, horizontally scrollable tools strip rather than a wall of
// equally-weighted cards. Destinations and handlers are unchanged.
import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Icon, type IconName } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { PressableScale } from "../ui/PressableScale";
import { Section } from "../ui/Section";

function ActionTile({
  label,
  icon,
  onPress,
  accent = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  accent?: boolean;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={label}
      style={styles.tileWrap}
    >
      <View style={[styles.tile, accent && styles.tileAccent]}>
        <View
          style={[
            styles.tileIcon,
            {
              backgroundColor: accent
                ? "rgba(0,0,0,0.10)"
                : theme.colors.primarySoft,
            },
          ]}
        >
          <Icon
            name={icon}
            size={18}
            color={accent ? theme.colors.primaryButtonText : theme.colors.primary}
          />
        </View>
        <Text
          style={[
            styles.tileLabel,
            { color: accent ? theme.colors.primaryButtonText : theme.colors.text },
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

function ToolChip({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <PressableScale onPress={onPress} accessibilityLabel={label}>
      <View style={styles.chip}>
        <Icon name={icon} size={15} color={theme.colors.textSecondary} />
        <Text style={styles.chipLabel}>{label}</Text>
      </View>
    </PressableScale>
  );
}

export function QuickActions({
  onNavigate,
  onAddUser,
  onRefresh,
}: {
  onNavigate: (route: string) => void;
  onAddUser: () => void;
  onRefresh: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View>
      <Section
        title="Quick actions"
        subtitle="Start the usual tasks"
        right={
          <IconButton
            icon="refresh"
            accessibilityLabel="Refresh all dashboard data"
            onPress={onRefresh}
            variant="soft"
            size={34}
            iconSize={16}
          />
        }
      />

      <View style={styles.grid}>
        <ActionTile
          label="Create bill"
          icon="plus"
          accent
          onPress={() => onNavigate("/bill-create")}
        />
        <ActionTile
          label="Dispatches"
          icon="truck"
          onPress={() => onNavigate("/dispatch")}
        />
        <ActionTile label="Add user" icon="users" onPress={onAddUser} />
        <ActionTile
          label="Folders"
          icon="folder"
          onPress={() => onNavigate("/folders")}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        style={styles.chipScroll}
      >
        <ToolChip
          label="Labour jobs"
          icon="hammer"
          onPress={() => onNavigate("/jobs-labour")}
        />
        <ToolChip
          label="Material jobs"
          icon="box"
          onPress={() => onNavigate("/jobs-with-material")}
        />
        <ToolChip
          label="Owner stock"
          icon="users"
          onPress={() => onNavigate("/stock-owner")}
        />
        <ToolChip
          label="Company stock"
          icon="building"
          onPress={() => onNavigate("/stock-company")}
        />
        <ToolChip
          label="Bill groups"
          icon="layers"
          onPress={() => onNavigate("/group-bills")}
        />
        <ToolChip
          label="Drawing groups"
          icon="image"
          onPress={() => onNavigate("/group-drawings")}
        />
        <ToolChip
          label="Invoice profile"
          icon="tag"
          onPress={() => onNavigate("/invoice-settings")}
        />
        <ToolChip
          label="Invoice logos"
          icon="image"
          onPress={() => onNavigate("/invoice-logos")}
        />
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    grid: {
      flexDirection: "row",
      gap: theme.spacing.sm,
    },
    tileWrap: { flex: 1 },
    tile: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: 12,
      paddingHorizontal: 10,
      minHeight: 88,
      justifyContent: "space-between",
      gap: 10,
      ...theme.elevation.card,
    },
    tileAccent: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    tileIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    tileLabel: {
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: -0.1,
    },
    chipScroll: { marginTop: theme.spacing.sm + 2, marginHorizontal: -theme.spacing.md },
    chipRow: {
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 2,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    chipLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
    },
  });
