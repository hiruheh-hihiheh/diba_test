// src/app/folders.tsx
// Folders overview: shows available items (draggable) + folders (drop targets)

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
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
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { PressableScale } from "../components/ui/PressableScale";
import { Reveal } from "../components/ui/Reveal";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SearchBar } from "../components/ui/SearchBar";
import { Section } from "../components/ui/Section";
import { SkeletonCard } from "../components/ui/Skeleton";
import { notify } from "../utils/notify";

/* ─── Type badge config ─── */

const getTypeBadges = (theme: AppTheme): Record<FolderItemType, { label: string; color: string }> => ({
  owner_stock: { label: "Owner", color: theme.colors.primary },
  company_stock: { label: "Company", color: "#8B5CF6" },
  // The two bill-ish types must not share a badge: `bill_group` is the older
  // Group Bills photo group, `bill` is a parsed tax invoice.
  bill_group: { label: "Bill Group", color: theme.colors.warning },
  drawing_group: { label: "Drawing", color: theme.colors.success },
  job: { label: "Job", color: theme.colors.danger },
  bill: { label: "Bill", color: theme.colors.primary },
});

export default function FoldersScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const { checking: authChecking } = useAdminGate();

  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [allItems, setAllItems] = useState<
    { type: FolderItemType; id: string; label: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // Folder delete needs a confirmation on both web and native. `Alert.alert`
  // is a no-op on react-native-web, so a native-only confirm would silently
  // do nothing there; the shared ConfirmDialog modal works on both.
  const [pendingDelete, setPendingDelete] = useState<AdminFolder | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});

  // Transient banner for drop/create/rename/delete feedback.
  const [flash, setFlash] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = useCallback((type: "success" | "error", text: string) => {
    setFlash({ type, text });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState<FolderItemType | "all">("all");

  /* ── Data loading ── */
  const loadData = useCallback(async () => {
    try {
      const [folderList, items] = await Promise.all([
        fetchFolders(),
        fetchAllItems(),
      ]);
      setError(null);
      setFolders(folderList);
      setAllItems(items);

      // Count items per folder from the association table (row-light query).
      const { data: itemRows, error: countError } = await supabase
        .from("folder_items")
        .select("folder_id");
      if (countError) throw new Error(countError.message);

      const counts: Record<string, number> = {};
      if (itemRows) {
        for (const row of itemRows) {
          counts[row.folder_id] = (counts[row.folder_id] || 0) + 1;
        }
      }
      setFolderCounts(counts);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load folders."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

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

  /** Perform the folder delete; shared by the ConfirmDialog. */
  async function doDeleteFolder(folder: AdminFolder) {
    setDeletingFolderId(folder.id);
    try {
      const res = await deleteFolder(folder.id);
      if (res.ok) {
        await loadData();
      } else {
        notify("Error", res.error || "Failed to delete folder.");
      }
    } finally {
      setDeletingFolderId(null);
      setPendingDelete(null);
    }
  }

  function handleDeleteFolder(folder: AdminFolder) {
    setPendingDelete(folder);
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
        msg.toLowerCase().includes("already exists") ||
        msg.includes("23505");
      const displayMsg = isDuplicate
        ? `This item is already in "${folder.name}".`
        : msg;

      showFlash("error", displayMsg);
      return;
    }

    // Success: refresh from the backend so the folder count reflects the real
    // folder_items rows (no hand-rolled counter that drifts from the DB).
    await loadData();

    showFlash("success", `Added to "${folder.name}"`);
  }

  return (
    <View style={styles.screen}>
      <DragDropProvider
        onDrop={handleDrop}
        onDragStart={() => setIsDragActive(true)}
        onDragEnd={() => setIsDragActive(false)}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          scrollEnabled={!isDragActive}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        >
          <ScreenHeader
            eyebrow="Organization"
            title="Folders"
            subtitle={`${folders.length} ${folders.length === 1 ? "folder" : "folders"} · ${
              allItems.length
            } ${allItems.length === 1 ? "item" : "items"}`}
            right={
              <Button
                title="New"
                icon="folderPlus"
                size="sm"
                onPress={() => setShowCreateModal(true)}
              />
            }
          />

          {flash ? (
            <Reveal style={styles.flashWrap}>
              <View
                style={[
                  styles.flash,
                  {
                    backgroundColor:
                      flash.type === "error"
                        ? theme.colors.dangerMuted
                        : theme.colors.successMuted,
                    borderColor:
                      flash.type === "error"
                        ? theme.colors.danger + "45"
                        : theme.colors.success + "45",
                  },
                ]}
              >
                <Icon
                  name={flash.type === "error" ? "alert" : "checkCircle"}
                  size={16}
                  color={
                    flash.type === "error"
                      ? theme.colors.danger
                      : theme.colors.success
                  }
                />
                <Text
                  style={[
                    styles.flashText,
                    {
                      color:
                        flash.type === "error"
                          ? theme.colors.danger
                          : theme.colors.success,
                    },
                  ]}
                >
                  {flash.text}
                </Text>
              </View>
            </Reveal>
          ) : null}

          {authChecking || loading ? (
            <View style={styles.skeletons}>
              <SkeletonCard lines={2} />
              <SkeletonCard lines={1} />
              <SkeletonCard lines={1} />
            </View>
          ) : error ? (
            <View style={styles.errorBanner}>
              <Icon name="alert" size={17} color={theme.colors.danger} />
              <Text style={styles.errorBannerText}>
                Failed to load folders: {error}
              </Text>
              <Pressable onPress={loadData} accessibilityRole="button">
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {allItems.length > 0 ? (
                <View style={styles.panel}>
                  <View style={styles.panelHead}>
                    <View style={styles.panelHeadText}>
                      <Text style={styles.panelTitle}>Available items</Text>
                      <Text style={styles.panelHint}>
                        {isDragActive
                          ? "Drop onto a folder below"
                          : "Long-press an item and drag it into a folder"}
                      </Text>
                    </View>
                    <Badge
                      label={`${filteredItems.length} of ${allItems.length}`}
                      tone="neutral"
                    />
                  </View>

                  <SearchBar
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search items"
                    accessibilityLabel="Search available items"
                    autoCapitalize="none"
                    style={styles.search}
                  />

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterRow}
                  >
                    <TypeChip
                      label="All"
                      active={itemTypeFilter === "all"}
                      onPress={() => setItemTypeFilter("all")}
                    />
                    {Object.entries(getTypeBadges(theme)).map(([type, badge]) => (
                      <TypeChip
                        key={type}
                        label={badge.label}
                        active={itemTypeFilter === type}
                        onPress={() => setItemTypeFilter(type as FolderItemType)}
                      />
                    ))}
                  </ScrollView>

                  {filteredItems.length === 0 ? (
                    <View style={styles.emptySearch}>
                      <Icon name="search" size={18} color={theme.colors.textMuted} />
                      <Text style={styles.emptySearchTitle}>No matching items</Text>
                      <Text style={styles.emptySearchText}>
                        Try another search or type filter.
                      </Text>
                    </View>
                  ) : (
                    <ScrollView
                      style={styles.itemsScroll}
                      nestedScrollEnabled
                      scrollEnabled={!isDragActive}
                      showsVerticalScrollIndicator={false}
                    >
                      {filteredItems.map((item) => {
                        const badge = getTypeBadges(theme)[item.type];
                        return (
                          <DraggableItem
                            key={`${item.type}-${item.id}`}
                            data={{
                              type: item.type,
                              id: item.id,
                              label: item.label,
                            }}
                          >
                            <View style={styles.itemRow}>
                              <View style={styles.dragHandle}>
                                <Icon
                                  name="menu"
                                  size={13}
                                  color={theme.colors.textMuted}
                                />
                              </View>
                              <View
                                style={[
                                  styles.typeBadge,
                                  { backgroundColor: badge.color + "1F" },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.typeBadgeText,
                                    { color: badge.color },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {badge.label}
                                </Text>
                              </View>
                              <Pressable
                                style={styles.itemMain}
                                onPress={() =>
                                  setPreviewItem({
                                    type: item.type,
                                    id: item.id,
                                    label: item.label,
                                  })
                                }
                                accessibilityRole="button"
                                accessibilityLabel={`Preview ${item.label}`}
                              >
                                <Text style={styles.itemLabel} numberOfLines={1}>
                                  {item.label}
                                </Text>
                                <Icon
                                  name="chevronRight"
                                  size={14}
                                  color={theme.colors.textMuted}
                                />
                              </Pressable>
                            </View>
                          </DraggableItem>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              ) : null}

              <Section
                title="Your folders"
                subtitle="Tap to open · drag an item onto a folder to file it"
                style={styles.folderSection}
              />

              {folders.length === 0 ? (
                <EmptyState
                  icon="folderPlus"
                  title="No folders yet"
                  message="Create your first folder to organize stock, bills, drawings and jobs."
                  action={
                    <Button
                      title="Create folder"
                      icon="plus"
                      onPress={() => setShowCreateModal(true)}
                    />
                  }
                />
              ) : (
                folders.map((folder) => (
                  <FolderDropTarget key={folder.id} zoneId={folder.id}>
                    <View
                      style={[
                        styles.folderCard,
                        isDragActive && styles.folderCardDrop,
                      ]}
                    >
                      <PressableScale
                        onPress={() => openFolder(folder)}
                        accessibilityLabel={`Open folder ${folder.name}`}
                      >
                        <View style={styles.folderRow}>
                          <View style={styles.folderIcon}>
                            <Icon
                              name="folder"
                              size={20}
                              color={theme.colors.primary}
                            />
                          </View>
                          <View style={styles.folderInfo}>
                            <Text style={styles.folderName} numberOfLines={1}>
                              {folder.name}
                            </Text>
                            <Text style={styles.folderMeta}>
                              {folderCounts[folder.id] || 0}{" "}
                              {(folderCounts[folder.id] || 0) === 1
                                ? "item"
                                : "items"}{" "}
                              · Created{" "}
                              {new Date(folder.created_at).toLocaleDateString([], {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </Text>
                          </View>
                          <Icon
                            name="chevronRight"
                            size={16}
                            color={theme.colors.textMuted}
                          />
                        </View>
                      </PressableScale>

                      <View style={styles.folderActions}>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            setRenamingFolder(folder);
                          }}
                          style={({ pressed }) => [
                            styles.folderAction,
                            pressed && { opacity: 0.6 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Rename ${folder.name}`}
                        >
                          <Icon
                            name="pencil"
                            size={14}
                            color={theme.colors.textSecondary}
                          />
                          <Text style={styles.folderActionText}>Rename</Text>
                        </Pressable>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            handleDeleteFolder(folder);
                          }}
                          style={({ pressed }) => [
                            styles.folderAction,
                            pressed && { opacity: 0.6 },
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${folder.name}`}
                        >
                          <Icon name="trash" size={14} color={theme.colors.danger} />
                          <Text
                            style={[
                              styles.folderActionText,
                              { color: theme.colors.danger },
                            ]}
                          >
                            Delete
                          </Text>
                        </Pressable>
                      </View>
                    </View>
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

      <CreateFolderModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreateFolder}
      />

      {renamingFolder && (
        <RenameFolderModal
          visible={!!renamingFolder}
          currentName={renamingFolder.name}
          onClose={() => setRenamingFolder(null)}
          onSave={handleRenameFolder}
        />
      )}

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete folder"
        message={
          pendingDelete
            ? `Delete "${pendingDelete.name}"? This removes all item associations but will NOT delete the actual stock or group records.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        busy={deletingFolderId !== null}
        onConfirm={() => {
          if (pendingDelete) void doDeleteFolder(pendingDelete);
        }}
        onCancel={() => {
          if (deletingFolderId === null) setPendingDelete(null);
        }}
      />
    </View>
  );
}

function TypeChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filter by ${label}`}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? theme.colors.primary : theme.colors.surface,
          borderColor: active ? theme.colors.primary : theme.colors.border,
        },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text
        style={[
          styles.filterChipText,
          {
            color: active
              ? theme.colors.primaryButtonText
              : theme.colors.textSecondary,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
    },
    skeletons: { gap: 8 },
    flashWrap: { marginBottom: theme.spacing.md },
    flash: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 12,
      borderRadius: theme.radius.md,
      borderWidth: 1,
    },
    flashText: { flex: 1, fontSize: theme.textSizes.xs, fontWeight: "600" },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.colors.dangerMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger + "45",
      padding: 12,
    },
    errorBannerText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      flex: 1,
    },
    retryText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },

    panel: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      ...theme.elevation.card,
    },
    panelHead: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: theme.spacing.sm + 2,
    },
    panelHeadText: { flex: 1, minWidth: 0 },
    panelTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    panelHint: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },
    search: { marginBottom: theme.spacing.sm },
    filterRow: {
      gap: 6,
      paddingBottom: 10,
      paddingTop: 2,
    },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
    },
    filterChipText: { fontSize: theme.textSizes.xs, fontWeight: "600" },
    emptySearch: {
      alignItems: "center",
      gap: 4,
      paddingVertical: theme.spacing.lg,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: theme.colors.border,
    },
    emptySearchTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
      marginTop: 2,
    },
    emptySearchText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
    },
    itemsScroll: { maxHeight: 260 },
    itemRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    dragHandle: { width: 20, alignItems: "center" },
    typeBadge: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 7,
      maxWidth: 84,
    },
    typeBadgeText: {
      fontSize: 9.5,
      fontWeight: "800",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    itemMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minWidth: 0,
    },
    itemLabel: {
      flex: 1,
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "500",
    },

    folderSection: { marginTop: theme.spacing.lg },
    folderCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 12,
      marginBottom: theme.spacing.sm,
      ...theme.elevation.card,
    },
    folderCardDrop: {
      borderColor: theme.colors.primary + "70",
      backgroundColor: theme.colors.primarySoft,
    },
    folderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 2,
    },
    folderIcon: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    folderInfo: { flex: 1, minWidth: 0 },
    folderName: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    folderMeta: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },
    folderActions: {
      flexDirection: "row",
      gap: theme.spacing.md,
      marginTop: 10,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    folderAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingVertical: 4,
      paddingRight: 6,
    },
    folderActionText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
    },
  });
