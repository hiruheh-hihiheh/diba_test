// src/components/dashboard/SectionHeader.tsx
import React from "react";
import { Text, View } from "react-native";

import { useTheme } from "../../context/ThemeContext";
import { createDashboardStyles } from "./styles";

export function SectionHeader({
  title,
  subtitle,
  rightElement,
}: {
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createDashboardStyles(theme), [theme]);

  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      {rightElement}
    </View>
  );
}