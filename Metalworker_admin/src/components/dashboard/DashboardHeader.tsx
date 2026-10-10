// src/components/dashboard/DashboardHeader.tsx
import React from "react";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "../../context/ThemeContext";
import { ThemeToggle } from "../ui/ThemeToggle";
import { createDashboardStyles } from "./styles";

export function DashboardHeader({
  adminUsername,
  onLogout,
}: {
  adminUsername: string;
  onLogout: () => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  return (
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <ThemeToggle />
        <Pressable onPress={onLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}