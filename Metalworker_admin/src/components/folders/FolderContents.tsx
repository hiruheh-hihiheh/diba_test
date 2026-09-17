// src/components/folders/FolderContents.tsx
// Displays folder items with reorder/remove + available items to add

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
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

interface FolderContentsProps {
  folderId: string;
}

const TYPE_BADGES: Record<FolderItemType, { label: string; color: string }> = {
  owner_stock: { label: "Owner", color: "#3B82F6" },
  company_stock: { label: "Company", color: "#8B5CF6" },
  bill_group: { label: "Bill", color: "#F59E0B" },
  drawing_group: { label: "Drawing", color: "#10B981" },
};

export function FolderContents({ folderId }: FolderContentsProps) {
  const [items, setItems] = useState<FolderItemDisplay[]>([]);
  const [available, setAvailable] = useState<
    { type: FolderItemType; id: string; label: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [showAvailable, setShowAvailable] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const rawItems = await fetchFolderItems(folderId);
      const resolved = await resolveFolderItemLabels(rawItems);
      setItems(resolved);

      const avail = await fetchAvailableItems(folderId);
      setAvailable(avail);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load folder contents.";
      if (Platform.OS === "web") {
        window.alert(msg);
      } else {
        Alert.alert("Error", msg);
      }
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRemoveItem(folderItemId: string) {
    const doRemove = async () => {
      const res = await removeItemFromFolder(folderItemId);
      if (!res.ok) {
        const msg = res.error || "Failed to remove item.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
      }
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

    setItems(reordered);

    const res = await reorderFolderItems(
      reordered.map((item) => ({ id: item.id, position: item.position }))
    );

    if (!res.ok) {
      const msg = res.error || "Failed to reorder.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
      await loadData();
    }
  }

  async function handleAddItem(
    itemType: FolderItemType,
    itemId: string
  ) {
    const res = await addItemToFolder(folderId, itemType, itemId);
    if (!res.ok) {
      const msg = res.error || "Failed to add item.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    }
    await loadData();
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Folder Items */}
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>
          Items ({items.length})
        </Text>

        {items.length === 0 ? (
          <Text style={styles.emptyText}>
            No items in this folder yet. Add items from the available pool
            below.
          </Text>
        ) : (
          items.map((item, index) => {
            const badge = TYPE_BADGES[item.item_type];
            return (
              <View key={item.id} style={styles.itemRow}>
                <View
                  style={[styles.typeBadge, { backgroundColor: badge.color + "20" }]}
                >
                  <Text style={[styles.typeBadgeText, { color: badge.color }]}>
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
                      index === items.length - 1 && styles.moveBtnDisabled,
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
            );
          })
        )}
      </View>

      {/* Available Items */}
      <Pressable
        style={styles.toggleAvailableBtn}
        onPress={() => setShowAvailable(!showAvailable)}
      >
        <Text style={styles.toggleAvailableText}>
          {showAvailable
            ? "▼ Hide Available Items"
            : "▶ Add Items to Folder"}
        </Text>
        {available.length > 0 && (
          <View style={styles.availableBadge}>
            <Text style={styles.availableBadgeText}>{available.length}</Text>
          </View>
        )}
      </Pressable>

      {showAvailable && (
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            Available Items ({available.length})
          </Text>

          {available.length === 0 ? (
            <Text style={styles.emptyText}>
              All items are already in this folder, or no items exist yet.
            </Text>
          ) : (
            <ScrollView style={styles.availableScroll} nestedScrollEnabled>
              {available.map((item) => {
                const badge = TYPE_BADGES[item.type];
                return (
                  <Pressable
                    key={`${item.type}-${item.id}`}
                    style={styles.availableRow}
                    onPress={() => handleAddItem(item.type, item.id)}
                  >
                    <View
                      style={[
                        styles.typeBadge,
                        { backgroundColor: badge.color + "20" },
                      ]}
                    >
                      <Text
                        style={[styles.typeBadgeText, { color: badge.color }]}
                      >
                        {badge.label}
                      </Text>
                    </View>
                    <Text style={styles.availableLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.addText}>+ Add</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    paddingVertical: theme.spacing.xl,
    alignItems: "center",
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
    marginBottom: theme.spacing.md,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    paddingVertical: theme.spacing.lg,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
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
  toggleAvailableBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.primary + "10",
    borderRadius: theme.radius.md,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  toggleAvailableText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
    flex: 1,
  },
  availableBadge: {
    backgroundColor: theme.colors.primary,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  availableBadgeText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },
  availableScroll: {
    maxHeight: 300,
  },
  availableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  availableLabel: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
  },
  addText: {
    color: theme.colors.success,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },
});
