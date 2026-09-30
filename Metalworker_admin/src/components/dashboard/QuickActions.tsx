// src/components/dashboard/QuickActions.tsx
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../../context/ThemeContext";
import { createDashboardStyles } from "./styles";
import { SectionHeader } from "./SectionHeader";

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
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  return (
    <>
      <SectionHeader title="Quick Actions" />

      <View style={styles.quickActionsRow}>
        <Pressable
          style={styles.quickActionCard}
          onPress={() => onNavigate("/dispatch")}
          accessibilityRole="button"
          accessibilityLabel="View dispatches"
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
          onPress={onAddUser}
          accessibilityRole="button"
          accessibilityLabel="Add user"
        >
          <View
            style={[
              styles.quickActionIcon,
              { backgroundColor: theme.colors.success + "20" },
            ]}
          >
            <Text style={styles.quickActionIconText}>+</Text>
          </View>
          <Text style={styles.quickActionLabel}>Add User</Text>
        </Pressable>

        <Pressable
          style={styles.quickActionCard}
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel="Refresh all data"
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

      <View style={styles.divider} />

      <SectionHeader title="Jobs" subtitle="Manage work orders" />
      <View style={styles.quickActionsRow}>
        <Pressable
          style={styles.quickActionCard}
          onPress={() => onNavigate("/jobs-labour")}
          accessibilityRole="button"
          accessibilityLabel="Labour jobs"
        >
          <View
            style={[
              styles.quickActionIcon,
              { backgroundColor: "#F59E0B" + "20" },
            ]}
          >
            <Text style={styles.quickActionIconText}>🧰</Text>
          </View>
          <Text style={styles.quickActionLabel}>Labour Jobs</Text>
        </Pressable>

        <Pressable
          style={styles.quickActionCard}
          onPress={() => onNavigate("/jobs-with-material")}
          accessibilityRole="button"
          accessibilityLabel="Jobs with material"
        >
          <View
            style={[
              styles.quickActionIcon,
              { backgroundColor: "#10B981" + "20" },
            ]}
          >
            <Text style={styles.quickActionIconText}>🔩</Text>
          </View>
          <Text style={styles.quickActionLabel}>With Material (BO)</Text>
        </Pressable>
      </View>

      <SectionHeader title="Stock" subtitle="Manage stock records" />
      <View style={styles.quickActionsRow}>
        <Pressable
          style={styles.quickActionCard}
          onPress={() => onNavigate("/stock-owner")}
          accessibilityRole="button"
          accessibilityLabel="Stock by owner"
        >
          <View
            style={[
              styles.quickActionIcon,
              { backgroundColor: theme.colors.primary + "20" },
            ]}
          >
            <Text style={styles.quickActionIconText}>🏠</Text>
          </View>
          <Text style={styles.quickActionLabel}>Stock by Owner</Text>
        </Pressable>

        <Pressable
          style={styles.quickActionCard}
          onPress={() => onNavigate("/stock-company")}
          accessibilityRole="button"
          accessibilityLabel="Stock by company"
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

      <SectionHeader title="Documents" subtitle="Bills & drawings" />
      <View style={styles.quickActionsRow}>
        <Pressable
          style={styles.quickActionCard}
          onPress={() => onNavigate("/bills")}
          accessibilityRole="button"
          accessibilityLabel="Bills"
        >
          <View
            style={[
              styles.quickActionIcon,
              { backgroundColor: theme.colors.primary + "20" },
            ]}
          >
            <Text style={styles.quickActionIconText}>🧾</Text>
          </View>
          <Text style={styles.quickActionLabel}>Bills</Text>
        </Pressable>

        <Pressable
          style={styles.quickActionCard}
          onPress={() => onNavigate("/group-bills")}
          accessibilityRole="button"
          accessibilityLabel="Bill groups"
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
          onPress={() => onNavigate("/group-drawings")}
          accessibilityRole="button"
          accessibilityLabel="Drawing groups"
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

      <SectionHeader title="Folders" subtitle="Organize items" />
      <View style={styles.quickActionsRow}>
        <Pressable
          style={styles.quickActionCard}
          onPress={() => onNavigate("/folders")}
          accessibilityRole="button"
          accessibilityLabel="Manage folders"
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
    </>
  );
}