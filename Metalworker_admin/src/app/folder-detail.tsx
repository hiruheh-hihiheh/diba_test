// src/app/folder-detail.tsx
// Shows folder contents with drag-and-drop.
// The shell app bar owns the back button; this screen adds the folder's
// identity and hands the scroll + DnD to FolderContents.
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
import { FolderContents } from "../components/folders/FolderContents";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { ScreenHeader } from "../components/ui/ScreenHeader";

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
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!folderId) {
    return (
      <View style={styles.centered}>
        <EmptyState
          icon="folder"
          title="Folder not found"
          message="This folder may have been deleted, or the link is incomplete."
          action={
            <Button
              title="Back to folders"
              variant="secondary"
              icon="arrowLeft"
              onPress={() => router.back()}
            />
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Icon name="folder" size={19} color={theme.colors.primary} />
        </View>
        <View style={styles.headerText}>
          <ScreenHeader
            eyebrow="Folder"
            title={folderName || "Folder"}
            subtitle="Open an item to preview it, or drag items out of the folder"
            style={styles.screenHeader}
          />
        </View>
      </View>

      {/* Folder contents manages its own scroll + drag-and-drop. */}
      <FolderContents folderId={folderId} />
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
      padding: theme.spacing.lg,
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.md,
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 11,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    headerText: { flex: 1, minWidth: 0 },
    screenHeader: { marginBottom: 0 },
  });
