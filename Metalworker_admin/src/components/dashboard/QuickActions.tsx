// src/components/dashboard/QuickActions.tsx
//
// High-frequency destinations only: Create Bill, the two job lists, Dispatches
// and Folders. Everything else lives in the More sheet / hamburger drawer.
// Worker management keeps its own "+ Add New User" / Refresh buttons inside
// `WorkerSection`, so this component only navigates.
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../../context/ThemeContext";
import { createDashboardStyles } from "./styles";
import { SectionHeader } from "./SectionHeader";

interface QuickAction {
  key: string;
  label: string;
  icon: string;
  route: string;
  bg: string;
}

export function QuickActions({
  onNavigate,
}: {
  onNavigate: (route: string) => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  const actions: QuickAction[] = [
    {
      key: "create-bill",
      label: "Create Bill",
      icon: "🧾",
      route: "/bill-create",
      bg: theme.colors.primary + "20",
    },
    {
      key: "labour",
      label: "Labour Jobs",
      icon: "🧰",
      route: "/jobs-labour",
      bg: "#F59E0B" + "20",
    },
    {
      key: "material",
      label: "With Material Jobs",
      icon: "🔩",
      route: "/jobs-with-material",
      bg: "#10B981" + "20",
    },
    {
      key: "dispatches",
      label: "Dispatches",
      icon: "🚚",
      route: "/dispatch",
      bg: theme.colors.success + "20",
    },
    {
      key: "folders",
      label: "Folders",
      icon: "📁",
      route: "/folders",
      bg: theme.colors.primary + "20",
    },
  ];

  return (
    <>
      <SectionHeader title="Quick Actions" subtitle="Frequent destinations" />
      <View style={styles.quickActionsRow}>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            style={styles.quickActionCard}
            onPress={() => onNavigate(action.route)}
            accessibilityRole="button"
            accessibilityLabel={action.label}
          >
            <View
              style={[
                styles.quickActionIcon,
                { backgroundColor: action.bg },
              ]}
            >
              <Text style={styles.quickActionIconText}>{action.icon}</Text>
            </View>
            <Text style={styles.quickActionLabel}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}