// src/components/folders/FolderContents.tsx
// Folder items with drag-to-reorder + available items with drag-to-add.
// Wraps its own DragDropProvider + ScrollView for proper ghost positioning.

import { useCallback, useEffect, useRef, useState } from "react";
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

import { theme } from "../../constants/theme";
import type { FolderItemDisplay, FolderItemType } from "../../types/folder";
import {
  addItemToFolder,
  fetchAvailableItems,
  fetchFolderItems,
  removeItemFromFolder,
  reorderFolderItems,
  resolveFolderItemLabels,
} from "../../services/folders";
import { DragDropProvider, type DragData } from "./DragDropProvider";
import { DraggableItem } from "./DraggableItem";
import { FolderDropTarget } from "./FolderDropTarget";

/* ─── Constants ─── */

interface FolderContentsProps {
  folderId: string;
}

const TYPE_BADGES: Record<FolderItemType, { label: string; color: string }> = {
  owner_stock: { label: "Owner", color: "#3B82F6" },
  company_stock: { label: "Company", color: "#8B5CF6" },
  bill_group: { label: "Bill", color: "#F59E0B" },
  drawing_group: { label: "Drawing", color: "#10B981" },
};

const DROP_ZONE_ID = "folder-items";

/* ─── Component ─── */

export function FolderContents({ folderId }: FolderContentsProps) {
  const [items, setItems] = useState<FolderItemDisplay[]>([]);
  const [available, setAvailable] = useState<
    { type: FolderItemType; id: string; label: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  /** Screen-relative Y of each folder item row (for reorder insertion) */
  const itemYPositions = useRef<
    Map<string, { y: number; height: number }>
  >(new Map());
  /** Screen-relative Y of the folder-items container */
  const containerY = useRef(0);

  /* ── Data loading ── */

  const loadData = useCallback(async () => {
    try {
      const rawItems = await fetchFolderItems(folderId);
      const resolved = await resolveFolderItemLabels(rawItems);
      setItems(resolved);

      const avail = await fetchAvailableItems(folderId);
      setAvailable(avail);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load folder contents.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    }
  }, [folderId]);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    await loadData();
    setLoading(false);
  }, [loadData]);

  useEffect(() => {
    initialLoad();
  }, [initialLoad]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  /* ── Item operations ── */

  async function handleAddItem(
    itemType: FolderItemType,
    itemId: string,
    label: string
  ) {
    // Optimistic UI
    const prevItems = items;
    const prevAvailable = available;

    const optimisticItem: FolderItemDisplay = {
      id: `temp-${Date.now()}`,
      folder_id: folderId,
      item_type: itemType,
      item_id: itemId,
      position: items.length,
      created_at: new Date().toISOString(),
      label,
    };

    setItems((prev) => [...prev, optimisticItem]);
    setAvailable((prev) => prev.filter((a) => a.id !== itemId));

    // Persist
    const res = await addItemToFolder(folderId, itemType, itemId);
    if (!res.ok) {
      // Rollback
      setItems(prevItems);
      setAvailable(prevAvailable);

      const msg = res.error || "Failed to add item.";
      const isDuplicate =
        msg.toLowerCase().includes("duplicate") ||
        msg.toLowerCase().includes("unique") ||
        msg.toLowerCase().includes("already exists");
      const displayMsg = isDuplicate
        ? "This item is already in this folder."
        : msg;

      if (Platform.OS === "web") window.alert(displayMsg);
      else Alert.alert("Error", displayMsg);
      return;
    }

    // Reload to get the real IDs
    await loadData();
  }

  async function handleRemoveItem(folderItemId: string) {
    const doRemove = async () => {
      // Optimistic UI
      const prevItems = items;
      const prevAvailable = available;
      const removedItem = items.find((i) => i.id === folderItemId);
      setItems((prev) => prev.filter((i) => i.id !== folderItemId));

      const res = await removeItemFromFolder(folderItemId);
      if (!res.ok) {
        // Rollback
        setItems(prevItems);
        setAvailable(prevAvailable);
        const msg = res.error || "Failed to remove item.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
        return;
      }

      // Reload available items
      await loadData();
    };

    if (Platform.OS === "web") {
      if (window.confirm("Remove this item from the folder?")) {
        await doRemove();
      }
    } else {
      Alert.alert("Remove Item", "Remove this item from the folder?", [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: doRemove },
      ]);
    }
  }

  async function handleMoveItem(index: number, direction: "up" | "down") {
    const newItems = [...items];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newItems.length) return;

    [newItems[index], newItems[targetIndex]] = [
      newItems[targetIndex],
      newItems[index],
    ];

    const reordered = newItems.map((item, i) => ({
      ...item,
      position: i,
    }));

    // Optimistic
    const prevItems = items;
    setItems(reordered);

    const res = await reorderFolderItems(
      reordered.map((item) => ({ id: item.id, position: item.position }))
    );

    if (!res.ok) {
      setItems(prevItems);
      const msg = res.error || "Failed to reorder.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    }
  }

  /** Reorder via drag: move item from oldIndex to newIndex */
  async function handleReorderDrag(
    folderItemId: string,
    dropAbsY: number
  ) {
    const currentIndex = items.findIndex((i) => i.id === folderItemId);
    if (currentIndex === -1) return;

    // Determine insertion index from drop Y position
    let insertIndex = 0;
    const sortedPositions = Array.from(itemYPositions.current.entries())
      .sort((a, b) => a[1].y - b[1].y);

    for (const [, pos] of sortedPositions) {
      if (dropAbsY > pos.y + pos.height / 2) {
        insertIndex++;
      }
    }

    // Clamp
    insertIndex = Math.max(0, Math.min(insertIndex, items.length - 1));
    if (insertIndex === currentIndex) return;

    // Perform reorder
    const newItems = [...items];
    const [moved] = newItems.splice(currentIndex, 1);
    newItems.splice(insertIndex, 0, moved);

    const reordered = newItems.map((item, i) => ({
      ...item,
      position: i,
    }));

    // Optimistic
    const prevItems = items;
    setItems(reordered);

    const res = await reorderFolderItems(
      reordered.map((item) => ({ id: item.id, position: item.position }))
    );

    if (!res.ok) {
      setItems(prevItems);
      const msg = res.error || "Failed to reorder.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    }
  }

  /* ── Drag-and-drop handler ── */

  function handleDrop(
    data: DragData,
    zoneId: string,
    _absX: number,
    absY: number
  ) {
    if (zoneId !== DROP_ZONE_ID) return;

    if (data.folderItemId) {
      // Reorder existing item
      handleReorderDrag(data.folderItemId, absY);
    } else {
      // Add new item
      handleAddItem(data.type, data.id, data.label);
    }
  }

  /* ── Render ── */

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  return (
    <DragDropProvider
      onDrop={handleDrop}
      onDragStart={() => setIsDragActive(true)}
      onDragEnd={() => setIsDragActive(false)}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={!isDragActive}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* ── Items in this Folder ── */}
        <FolderDropTarget zoneId={DROP_ZONE_ID}>
          <View
            style={styles.sectionCard}
            onLayout={(e) => {
              containerY.current = e.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.sectionTitle}>
              Items in Folder ({items.length})
            </Text>

            {items.length === 0 ? (
              <View style={styles.emptyDropZone}>
                <Text style={styles.emptyDropIcon}>📥</Text>
                <Text style={styles.emptyDropText}>
                  {isDragActive
                    ? "Drop items here"
                    : "No items yet. Drag items from below or use the + Add buttons."}
                </Text>
              </View>
            ) : (
              items.map((item, index) => {
                const badge = TYPE_BADGES[item.item_type];
                return (
                  <DraggableItem
                    key={item.id}
                    data={{
                      type: item.item_type,
                      id: item.item_id,
                      label: item.label,
                      folderItemId: item.id,
                    }}
                    disabled={item.id.startsWith("temp-")}
                  >
                    <View
                      style={styles.itemRow}
                      onLayout={(e) => {
                        // Use measureInWindow for screen-relative coords
                        (e.target as any)?.measureInWindow?.(
                          (
                            _x: number,
                            y: number,
                            _w: number,
                            h: number
                          ) => {
                            itemYPositions.current.set(item.id, {
                              y,
                              height: h,
                            });
                          }
                        );
                      }}
                    >
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
                      <View style={styles.itemActions}>
                        <Pressable
                          onPress={() => handleMoveItem(index, "up")}
                          disabled={index === 0}
                          style={[
                            styles.moveBtn,
                            index === 0 && styles.moveBtnDisabled,
                          ]}
                        >
                          <Text style={styles.moveBtnText}>↑</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleMoveItem(index, "down")}
                          disabled={index === items.length - 1}
                          style={[
                            styles.moveBtn,
                            index === items.length - 1 &&
                              styles.moveBtnDisabled,
                          ]}
                        >
                          <Text style={styles.moveBtnText}>↓</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleRemoveItem(item.id)}
                          style={styles.removeBtn}
                        >
                          <Text style={styles.removeBtnText}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  </DraggableItem>
                );
              })
            )}
          </View>
        </FolderDropTarget>

        {/* ── Available Items ── */}
        <View style={styles.sectionCard}>
          <View style={styles.availableHeader}>
            <Text style={styles.sectionTitle}>
              Available Items ({available.length})
            </Text>
            <Text style={styles.sectionHint}>
              Long-press & drag into folder above
            </Text>
          </View>

          {available.length === 0 ? (
            <Text style={styles.emptyText}>
              All items are already in this folder, or no items exist yet.
            </Text>
          ) : (
            available.map((item) => {
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
                  <View style={styles.availableRow}>
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
                    <Text style={styles.availableLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {/* Tap fallback: quick-add button */}
                    <Pressable
                      onPress={() =>
                        handleAddItem(item.type, item.id, item.label)
                      }
                      style={styles.addBtn}
                    >
                      <Text style={styles.addBtnText}>+ Add</Text>
                    </Pressable>
                  </View>
                </DraggableItem>
              );
            })
          )}
        </View>
      </ScrollView>
    </DragDropProvider>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    paddingVertical: theme.spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
  },
  sectionCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: theme.spacing.sm,
  },
  sectionHint: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    fontStyle: "italic",
  },
  availableHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
  },

  /* ── Empty states ── */
  emptyDropZone: {
    alignItems: "center",
    paddingVertical: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    borderRadius: theme.radius.md,
  },
  emptyDropIcon: {
    fontSize: 32,
    marginBottom: theme.spacing.sm,
  },
  emptyDropText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    paddingHorizontal: theme.spacing.md,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    paddingVertical: theme.spacing.lg,
  },

  /* ── Folder item rows ── */
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
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
  itemActions: {
    flexDirection: "row",
    gap: 6,
  },
  moveBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.primary + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  moveBtnDisabled: {
    opacity: 0.3,
  },
  moveBtnText: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.danger + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtnText: {
    color: theme.colors.danger,
    fontSize: 12,
    fontWeight: "700",
  },

  /* ── Available item rows ── */
  availableRow: {
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
  availableLabel: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
  },
  addBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: theme.colors.success + "18",
  },
  addBtnText: {
    color: theme.colors.success,
    fontSize: theme.textSizes.xs,
    fontWeight: "700",
  },
});
