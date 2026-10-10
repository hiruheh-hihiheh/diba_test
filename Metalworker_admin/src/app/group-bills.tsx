// src/app/group-bills.tsx

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
import { useFocusLoader } from "../hooks/useFocusLoader";
import {
  fetchBillGroups,
  createBillGroup,
  updateBillGroup,
  deleteBillGroup,
  fetchBillGroupPhotos,
  addBillGroupPhoto,
  removeBillGroupPhoto,
  reorderBillGroupPhotos,
} from "../services/billGroups";
import type { BillGroup, BillGroupInput } from "../types/billGroup";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { BillGroupForm } from "../components/documents/BillGroupForm";
import type { GroupPhoto } from "../components/documents/GroupPhotoUploader";
import { GroupPhotoPreviewModal } from "../components/documents/GroupPhotoPreviewModal";
import { notify } from "../utils/notify";

export default function GroupBillsScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // Centralized admin gate (role + active check, transient-tolerant). This
  // screen previously ran a bare `getSession()` check that neither verified
  // the role nor handled transient network failures.
  const { checking: authChecking } = useAdminGate();

  const [groups, setGroups] = useState<BillGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<BillGroup | null>(null);
  const [editingPhotos, setEditingPhotos] = useState<GroupPhoto[]>([]);

  const [viewingItem, setViewingItem] = useState<BillGroup | null>(null);

  // Cross-platform delete confirmation (Alert/confirm are no-ops on web)
  const [deleteTarget, setDeleteTarget] = useState<BillGroup | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const list = await fetchBillGroups();
      setGroups(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load groups.";
      notify("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const { refreshing, onRefresh } = useFocusLoader(loadGroups);

  async function handleSave(input: BillGroupInput, photos: GroupPhoto[]) {
    // Collect per-photo failures instead of aborting the whole save silently.
    // These helpers return `{ok,error}` rather than throwing, so the wrapper
    // must inspect the result — a bare try/catch can never see a returned
    // failure and makes this "Partial Success" path dead code.
    const failures: string[] = [];

    const safe = async (
      fn: () => Promise<{ ok: boolean; error?: string }>,
      what: string
    ) => {
      try {
        const res = await fn();
        if (!res.ok) {
          failures.push(`${what}: ${res.error ?? "failed"}`);
        }
      } catch (err) {
        failures.push(
          `${what}: ${err instanceof Error ? err.message : "unknown error"}`
        );
      }
    };

    if (editingItem) {
      // Update group
      const res = await updateBillGroup(editingItem.id, input);
      if (!res.ok) throw new Error(res.error || "Failed to update.");

      // Sync photos: remove old ones that are gone, add new ones, reorder
      const existingPhotos = await fetchBillGroupPhotos(editingItem.id);
      const existingIds = new Set(existingPhotos.map((p) => p.id));
      const keepIds = new Set(photos.filter((p) => p.id).map((p) => p.id));

      // Remove deleted photos
      for (const ep of existingPhotos) {
        if (!keepIds.has(ep.id)) {
          await safe(() => removeBillGroupPhoto(ep.id), "Remove photo");
        }
      }

      // Add new photos
      for (const p of photos) {
        if (!p.id || !existingIds.has(p.id)) {
          await safe(
            () =>
              addBillGroupPhoto(editingItem.id, p.photo_url, p.photo_public_id),
            "Add photo"
          );
        }
      }

      // Reorder remaining
      const updatedPhotos = await fetchBillGroupPhotos(editingItem.id);
      if (updatedPhotos.length > 0) {
        await safe(
          () =>
            reorderBillGroupPhotos(
              updatedPhotos.map((p, i) => ({ id: p.id, position: i }))
            ),
          "Reorder photos"
        );
      }
    } else {
      // Create group
      const res = await createBillGroup(input);
      if (!res.ok || !res.data) throw new Error(res.error || "Failed to create.");
      const groupId = res.data.id;

      // Add photos
      for (const p of photos) {
        await safe(
          () => addBillGroupPhoto(groupId, p.photo_url, p.photo_public_id),
          "Add photo"
        );
      }
    }
    await loadGroups();

    if (failures.length > 0) {
      const msg =
        "Saved, but some photos could not be synced: " + failures.join("; ");
      notify("Partial Success", msg);
    }
  }

  async function handleEdit(item: BillGroup) {
    try {
      const photos = await fetchBillGroupPhotos(item.id);
      setEditingPhotos(
        photos.map((p) => ({
          id: p.id,
          photo_url: p.photo_url,
          photo_public_id: p.photo_public_id,
          position: p.position,
        }))
      );
      setEditingItem(item);
      setShowForm(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load photos.";
      notify("Error", msg);
    }
  }

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const res = await deleteBillGroup(deleteTarget.id);
    setDeleteTarget(null);
    if (res.ok) {
      await loadGroups();
    } else {
      notify("Error", res.error || "Failed to delete.");
    }
  }, [deleteTarget, loadGroups]);

  if (authChecking) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Count caption + new group */}
        <View style={styles.headerRow}>
          <Text style={styles.countCaption}>
            {groups.length === 1 ? "1 group" : `${groups.length} groups`}
          </Text>
          <Button
            title="+ Create Bill Group"
            size="sm"
            onPress={() => {
              setEditingItem(null);
              setEditingPhotos([]);
              setShowForm(true);
            }}
          />
        </View>

        <View style={styles.spacer} />

        {/* List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📄</Text>
            <Text style={styles.emptyTitle}>No Bill Groups</Text>
            <Text style={styles.emptyText}>
              Create your first bill group above.
            </Text>
          </View>
        ) : (
          groups.map((item) => (
            <View key={item.id} style={styles.groupCard}>
              <View style={styles.groupCardHeader}>
                <View style={styles.groupIconWrap}>
                  <Text style={styles.groupIcon}>📄</Text>
                </View>
                <View style={styles.groupInfo}>
                  <Text style={styles.groupName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.groupDate}>
                    {new Date(item.group_date).toLocaleDateString([], {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </Text>
                </View>
              </View>
              <View style={styles.groupActions}>
                <Pressable
                  onPress={() => setViewingItem(item)}
                  style={styles.actionBtnSecondary}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${item.name}`}
                >
                  <Text style={styles.actionTextSecondary}>View</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleEdit(item)}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.name}`}
                >
                  <Text style={styles.actionText}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDeleteTarget(item)}
                  style={styles.actionBtnDanger}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${item.name}`}
                >
                  <Text style={styles.actionTextDanger}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Delete confirmation */}
      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete Group"
        message={`Delete bill group "${deleteTarget?.name}"?`}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <BillGroupForm
        key={editingItem?.id ?? "new"}
        visible={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingItem(null);
          setEditingPhotos([]);
        }}
        onSave={handleSave}
        editingItem={editingItem}
        existingPhotos={editingPhotos}
      />

      {viewingItem && (
        <GroupPhotoPreviewModal
          visible={!!viewingItem}
          onClose={() => setViewingItem(null)}
          title={viewingItem.name}
          date={viewingItem.group_date}
          fetchPhotos={() => fetchBillGroupPhotos(viewingItem.id)}
        />
      )}
    </View>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  countCaption: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    flex: 1,
  },
  spacer: { height: theme.spacing.lg },
  loadingContainer: {
    paddingVertical: theme.spacing.xl * 2,
    alignItems: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: theme.spacing.xl * 2,
  },
  emptyIcon: { fontSize: 40, marginBottom: theme.spacing.md },
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
  groupCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  groupCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.md,
  },
  groupIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F59E0B" + "20",
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing.md,
  },
  groupIcon: {
    fontSize: 22,
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: 2,
  },
  groupDate: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },
  groupActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing.sm,
  },
  actionBtn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary + "15",
    minWidth: 70,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  actionText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  actionBtnSecondary: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.border,
    minWidth: 70,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  actionTextSecondary: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  actionBtnDanger: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger + "15",
    minWidth: 70,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  actionTextDanger: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
});