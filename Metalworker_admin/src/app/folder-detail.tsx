// src/app/folder-detail.tsx
// Shows folder contents with drag-and-drop.
// Header is fixed; FolderContents manages its own scroll + DnD provider.

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
import { FolderContents } from "../components/folders/FolderContents";

export default function FolderDetailScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // Same admin gate as every other protected screen. This screen previously
  // did its own `getSession()` check, which only verified that *a* session
  // exists: a worker/processor session (or an inactive admin) could render
  // this screen and fire its folder queries before RLS rejected them.
  const { checking: authChecking } = useAdminGate();

  const params = useLocalSearchParams<{ id?: string | string[]; name?: string | string[] }>();
  const folderId = Array.isArray(params.id) ? params.id[0] : params.id;
  const folderName = Array.isArray(params.name) ? params.name[0] : params.name;

  // Don't mount FolderContents (and its data queries) until the gate confirms
  // an active admin session.
  if (authChecking) {
    return (
      <View style={styles.screen}>
        <View style={styles.errorContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (!folderId) {
    return (
      <View style={styles.screen}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Folder not found.</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backBtnText}>← Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* ── Folder identity (the shell header owns the back button) ── */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.folderIconWrap}>
            <Text style={styles.folderIcon}>📁</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {folderName || "Folder"}
          </Text>
        </View>
      </View>

      {/* ── Folder Contents (manages its own scroll + drag-drop) ── */}
      <FolderContents folderId={folderId} />
    </View>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backBtn: {
    marginBottom: theme.spacing.md,
  },
  backBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  folderIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  folderIcon: {
    fontSize: 26,
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.md,
    marginBottom: theme.spacing.md,
  },
});
