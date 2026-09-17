// src/app/folders.tsx

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "../constants/theme";
import { supabase } from "../services/supabase";
import {
  fetchFolders,
  createFolder,
  renameFolder,
  deleteFolder,
} from "../services/folders";
import type { AdminFolder } from "../types/folder";
import { CreateFolderModal } from "../components/folders/CreateFolderModal";
import { RenameFolderModal } from "../components/folders/RenameFolderModal";

export default function FoldersScreen() {
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<AdminFolder | null>(
    null
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      setLoading(true);
      const list = await fetchFolders();
      setFolders(list);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load folders.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFolders();
    setRefreshing(false);
  }, [loadFolders]);

  async function handleCreateFolder(name: string) {
    const res = await createFolder(name);
    if (!res.ok) throw new Error(res.error || "Failed to create folder.");
    await loadFolders();
  }

  async function handleRenameFolder(newName: string) {
    if (!renamingFolder) return;
    const res = await renameFolder(renamingFolder.id, newName);
    if (!res.ok) throw new Error(res.error || "Failed to rename folder.");
    setRenamingFolder(null);
    await loadFolders();
  }

  function handleDeleteFolder(folder: AdminFolder) {
    const doDelete = async () => {
      const res = await deleteFolder(folder.id);
      if (res.ok) {
        await loadFolders();
      } else {
        const msg = res.error || "Failed to delete folder.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
      }
    };

    if (Platform.OS === "web") {
      if (
        window.confirm(
          `Delete folder "${folder.name}"?\n\nThis will remove all item associations but will NOT delete the actual stock/group records.`
        )
      ) {
        doDelete();
      }
    } else {
      Alert.alert(
        "Delete Folder",
        `Delete "${folder.name}"? This will remove all item associations but will NOT delete the actual records.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: doDelete },
        ]
      );
    }
  }

  function openFolder(folder: AdminFolder) {
    router.push({
      pathname: "/folder-detail",
      params: { id: folder.id, name: folder.name },
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </Pressable>
          <View style={styles.headerRow}>
            <View style={styles.headerInfo}>
              <Text style={styles.headerTitle}>Folders</Text>
              <Text style={styles.headerSubtitle}>
                {folders.length} Folders
              </Text>
            </View>
            <Pressable
              style={styles.newFolderBtn}
              onPress={() => setShowCreateModal(true)}
            >
              <Text style={styles.newFolderBtnText}>+ New Folder</Text>
            </Pressable>
          </View>
        </View>

        {/* Folder List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : folders.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📁</Text>
            <Text style={styles.emptyTitle}>No Folders</Text>
            <Text style={styles.emptyText}>
              Create your first folder to organize stock and documents.
            </Text>
          </View>
        ) : (
          folders.map((folder) => (
            <Pressable
              key={folder.id}
              style={styles.folderCard}
              onPress={() => openFolder(folder)}
            >
              <View style={styles.folderCardMain}>
                <View style={styles.folderIconWrap}>
                  <Text style={styles.folderIcon}>📁</Text>
                </View>
                <View style={styles.folderInfo}>
                  <Text style={styles.folderName} numberOfLines={1}>
                    {folder.name}
                  </Text>
                  <Text style={styles.folderDate}>
                    Created{" "}
                    {new Date(folder.created_at).toLocaleDateString([], {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </Text>
                </View>
                <Text style={styles.folderArrow}>→</Text>
              </View>
              <View style={styles.folderActions}>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    setRenamingFolder(folder);
                  }}
                  style={styles.actionBtn}
                >
                  <Text style={styles.actionText}>Rename</Text>
                </Pressable>
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    handleDeleteFolder(folder);
                  }}
                  style={styles.actionBtnDanger}
                >
                  <Text style={styles.actionTextDanger}>Delete</Text>
                </Pressable>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* Create Modal */}
      <CreateFolderModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreateFolder}
      />

      {/* Rename Modal */}
      {renamingFolder && (
        <RenameFolderModal
          visible={!!renamingFolder}
          currentName={renamingFolder.name}
          onClose={() => setRenamingFolder(null)}
          onSave={handleRenameFolder}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  header: {
    marginBottom: theme.spacing.lg,
  },
  backBtn: {
    marginBottom: theme.spacing.sm,
  },
  backBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
  },
  headerSubtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginTop: 2,
  },
  newFolderBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
  },
  newFolderBtnText: {
    color: "#FFF",
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },
  loadingContainer: {
    paddingVertical: theme.spacing.xl * 2,
    alignItems: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: theme.spacing.xl * 2,
  },
  emptyIcon: { fontSize: 48, marginBottom: theme.spacing.md },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    marginBottom: 4,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
  },
  folderCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  folderCardMain: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.sm,
  },
  folderIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary + "15",
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing.md,
  },
  folderIcon: {
    fontSize: 22,
  },
  folderInfo: {
    flex: 1,
  },
  folderName: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: 2,
  },
  folderDate: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
  },
  folderArrow: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.lg,
    marginLeft: theme.spacing.sm,
  },
  folderActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing.sm,
  },
  actionBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary + "15",
  },
  actionText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
  },
  actionBtnDanger: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger + "15",
  },
  actionTextDanger: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
  },
});
