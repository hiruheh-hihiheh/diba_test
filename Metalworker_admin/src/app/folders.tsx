// src/app/folders.tsx
// Folders overview: shows available items (draggable) + folders (drop targets)

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
  fetchAllItems,
  addItemToFolder,
} from "../services/folders";
import type { AdminFolder, FolderItemType } from "../types/folder";
import { CreateFolderModal } from "../components/folders/CreateFolderModal";
import { RenameFolderModal } from "../components/folders/RenameFolderModal";
import {
  DragDropProvider,
  type DragData,
} from "../components/folders/DragDropProvider";
import { DraggableItem } from "../components/folders/DraggableItem";
import { FolderDropTarget } from "../components/folders/FolderDropTarget";

/* ─── Type badge config ─── */

const TYPE_BADGES: Record<FolderItemType, { label: string; color: string }> = {
  owner_stock: { label: "Owner", color: "#3B82F6" },
  company_stock: { label: "Company", color: "#8B5CF6" },
  bill_group: { label: "Bill", color: "#F59E0B" },
  drawing_group: { label: "Drawing", color: "#10B981" },
};

export default function FoldersScreen() {
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [allItems, setAllItems] = useState<
    { type: FolderItemType; id: string; label: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<AdminFolder | null>(
    null
  );

  /* ── Auth guard ── */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, []);

  /* ── Data loading ── */
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [folderList, items] = await Promise.all([
        fetchFolders(),
        fetchAllItems(),
      ]);
      setFolders(folderList);
      setAllItems(items);
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
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  /* ── Folder CRUD (existing, unchanged) ── */

  async function handleCreateFolder(name: string) {
    const res = await createFolder(name);
    if (!res.ok) throw new Error(res.error || "Failed to create folder.");
    await loadData();
  }

  async function handleRenameFolder(newName: string) {
    if (!renamingFolder) return;
    const res = await renameFolder(renamingFolder.id, newName);
    if (!res.ok) throw new Error(res.error || "Failed to rename folder.");
    setRenamingFolder(null);
    await loadData();
  }

  function handleDeleteFolder(folder: AdminFolder) {
    const doDelete = async () => {
      const res = await deleteFolder(folder.id);
      if (res.ok) {
        await loadData();
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

  /* ── Drag-and-drop handler ── */

  async function handleDrop(
    data: DragData,
    zoneId: string,
    _absX: number,
    _absY: number
  ) {
    // zoneId is the folder ID
    const folder = folders.find((f) => f.id === zoneId);
    if (!folder) return;

    const res = await addItemToFolder(zoneId, data.type, data.id);
    if (!res.ok) {
      const msg = res.error || "Failed to add item to folder.";
      // Check for duplicate
      const isDuplicate =
        msg.toLowerCase().includes("duplicate") ||
        msg.toLowerCase().includes("unique") ||
        msg.toLowerCase().includes("already exists");
      const displayMsg = isDuplicate
        ? `This item is already in "${folder.name}".`
        : msg;

      if (Platform.OS === "web") window.alert(displayMsg);
      else Alert.alert("Error", displayMsg);
      return;
    }

    // Success feedback
    const successMsg = `Added to "${folder.name}"`;
    if (Platform.OS === "web") {
      // Brief non-blocking feedback — using a simple approach
      // (no toast library needed)
    } else {
      Alert.alert("✓ Added", successMsg);
    }
  }

  /* ── Render ── */

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <DragDropProvider
        onDrop={handleDrop}
        onDragStart={() => setIsDragActive(true)}
        onDragEnd={() => setIsDragActive(false)}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          scrollEnabled={!isDragActive}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        >
          {/* ── Header ── */}
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backBtnText}>← Back</Text>
            </Pressable>
            <View style={styles.headerRow}>
              <View style={styles.headerInfo}>
                <Text style={styles.headerTitle}>Folders</Text>
                <Text style={styles.headerSubtitle}>
                  {folders.length} Folders · {allItems.length} Items
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

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <>
              {/* ── Available Items (draggable) ── */}
              {allItems.length > 0 && (
                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>
                      Available Items ({allItems.length})
                    </Text>
                    <Text style={styles.sectionHint}>
                      Long-press & drag into a folder
                    </Text>
                  </View>

                  <ScrollView
                    style={styles.itemsScroll}
                    nestedScrollEnabled
                    scrollEnabled={!isDragActive}
                  >
                    {allItems.map((item) => {
                      const badge = TYPE_BADGES[item.type];
                      return (
                        <DraggableItem
                          key={`${item.type}-${item.id}`}
                          data={{
                            type: item.type,
                            id: item.id,
                            label: item.label,
                          }}
                        >
                          <View style={styles.draggableRow}>
                            <Text style={styles.dragHandle}>⠿</Text>
                            <View
                              style={[
                                styles.typeBadge,
                                { backgroundColor: badge.color + "20" },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.typeBadgeText,
                                  { color: badge.color },
                                ]}
                              >
                                {badge.label}
                              </Text>
                            </View>
                            <Text style={styles.itemLabel} numberOfLines={1}>
                              {item.label}
                            </Text>
                          </View>
                        </DraggableItem>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {/* ── Folders (drop targets) ── */}
              <Text style={styles.foldersHeading}>
                {isDragActive
                  ? "⬇ Drop onto a folder below"
                  : "📁 Folders"}
              </Text>

              {folders.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>📁</Text>
                  <Text style={styles.emptyTitle}>No Folders</Text>
                  <Text style={styles.emptyText}>
                    Create your first folder to organize stock and documents.
                  </Text>
                </View>
              ) : (
                folders.map((folder) => (
                  <FolderDropTarget key={folder.id} zoneId={folder.id}>
                    <Pressable
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
                            {new Date(folder.created_at).toLocaleDateString(
                              [],
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }
                            )}
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
                  </FolderDropTarget>
                ))
              )}
            </>
          )}
        </ScrollView>
      </DragDropProvider>

      {/* ── Create Modal ── */}
      <CreateFolderModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreateFolder}
      />

      {/* ── Rename Modal ── */}
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

/* ─── Styles ─── */

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

  /* ── Available Items section ── */
  sectionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  sectionHint: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    fontStyle: "italic",
  },
  itemsScroll: {
    maxHeight: 280,
  },
  draggableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    marginBottom: 2,
  },
  dragHandle: {
    color: theme.colors.textMuted,
    fontSize: 16,
    width: 20,
    textAlign: "center",
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  itemLabel: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },

  /* ── Folders section ── */
  foldersHeading: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: theme.spacing.md,
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
