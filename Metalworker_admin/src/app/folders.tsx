// src/app/folders.tsx
// Folders overview: shows available items (draggable) + folders (drop targets)

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ItemPreviewModal } from "../components/folders/ItemPreviewModal";
import { Input } from "../components/ui/Input";

/* ─── Type badge config ─── */

const TYPE_BADGES: Record<FolderItemType, { label: string; color: string }> = {
  owner_stock: { label: "Owner", color: "#3B82F6" },
  company_stock: { label: "Company", color: "#8B5CF6" },
  bill_group: { label: "Bill", color: "#F59E0B" },
  drawing_group: { label: "Drawing", color: "#10B981" },
  job: { label: "Job", color: "#EF4444" },
};

export default function FoldersScreen() {
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [allItems, setAllItems] = useState<
    { type: FolderItemType; id: string; label: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [previewItem, setPreviewItem] = useState<{
    type: FolderItemType;
    id: string;
    label: string;
  } | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<AdminFolder | null>(
    null
  );
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  
  const [searchQuery, setSearchQuery] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState<FolderItemType | "all">("all");

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
      const [folderList, items, countsRes] = await Promise.all([
        fetchFolders(),
        fetchAllItems(),
        supabase.from("folder_items").select("folder_id"),
      ]);
      setFolders(folderList);
      setAllItems(items);

      const counts: Record<string, number> = {};
      if (countsRes.data) {
        for (const row of countsRes.data) {
          counts[row.folder_id] = (counts[row.folder_id] || 0) + 1;
        }
      }
      setFolderCounts(counts);
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

  const filteredItems = useMemo(() => {
    let result = allItems;
    if (itemTypeFilter !== "all") {
      result = result.filter((item) => item.type === itemTypeFilter);
    }
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.trim().toLowerCase();
      result = result.filter((item) => item.label.toLowerCase().includes(lowerQuery));
    }
    return result;
  }, [allItems, searchQuery, itemTypeFilter]);

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
    setFolderCounts((prev) => ({
      ...prev,
      [zoneId]: (prev[zoneId] || 0) + 1,
    }));
    
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
                      Available Items {allItems.length !== filteredItems.length ? `(${filteredItems.length} of ${allItems.length})` : `(${allItems.length})`}
                    </Text>
                    <Text style={styles.sectionHint}>
                      Long-press & drag into a folder
                    </Text>
                  </View>
                  
                  <View style={styles.searchSection}>
                    <View style={styles.searchInputWrapper}>
                      <Input
                        placeholder="Search items..."
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        autoCapitalize="none"
                      />
                      {searchQuery.length > 0 && (
                        <Pressable onPress={() => setSearchQuery("")} style={styles.clearSearchBtn}>
                          <Text style={styles.clearSearchText}>✕</Text>
                        </Pressable>
                      )}
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
                      <View style={styles.filterRow}>
                        <Pressable
                          style={[styles.filterBtn, itemTypeFilter === "all" && styles.filterBtnActive]}
                          onPress={() => setItemTypeFilter("all")}
                        >
                          <Text style={[styles.filterBtnText, itemTypeFilter === "all" && styles.filterBtnTextActive]}>
                            All
                          </Text>
                        </Pressable>
                        {Object.entries(TYPE_BADGES).map(([type, badge]) => (
                          <Pressable
                            key={type}
                            style={[styles.filterBtn, itemTypeFilter === type && styles.filterBtnActive]}
                            onPress={() => setItemTypeFilter(type as FolderItemType)}
                          >
                            <Text style={[styles.filterBtnText, itemTypeFilter === type && styles.filterBtnTextActive]}>
                              {badge.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>

                  {filteredItems.length === 0 ? (
                    <View style={styles.emptySearchState}>
                      <Text style={styles.emptySearchTitle}>No matching items</Text>
                      <Text style={styles.emptySearchText}>Try a different search or filter.</Text>
                    </View>
                  ) : (
                    <ScrollView
                      style={styles.itemsScroll}
                      nestedScrollEnabled
                      scrollEnabled={!isDragActive}
                    >
                      {filteredItems.map((item) => {
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
                              <Pressable 
                                style={styles.itemInfoContainer}
                                onPress={() => setPreviewItem({ type: item.type, id: item.id, label: item.label })}
                              >
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
                              </Pressable>
                            </View>
                          </DraggableItem>
                        );
                      })}
                    </ScrollView>
                  )}
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
                          <Text style={styles.folderCount}>
                            {folderCounts[folder.id] || 0} item{(folderCounts[folder.id] || 0) !== 1 ? "s" : ""}
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

      {previewItem && (
        <ItemPreviewModal
          visible={!!previewItem}
          onClose={() => setPreviewItem(null)}
          itemType={previewItem.type}
          itemId={previewItem.id}
          label={previewItem.label}
        />
      )}

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
  searchSection: {
    marginBottom: theme.spacing.md,
  },
  searchInputWrapper: {
    position: "relative",
    marginBottom: theme.spacing.sm,
  },
  clearSearchBtn: {
    position: "absolute",
    right: 12,
    top: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  clearSearchText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: "bold",
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 4,
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  filterBtnActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  filterBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.textMuted,
  },
  filterBtnTextActive: {
    color: "#fff",
  },
  emptySearchState: {
    alignItems: "center",
    paddingVertical: theme.spacing.xl,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  emptySearchTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptySearchText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
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
  itemInfoContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
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
  folderCount: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
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
