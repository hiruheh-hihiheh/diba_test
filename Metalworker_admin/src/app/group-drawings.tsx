// src/app/group-drawings.tsx

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
import { useFocusLoader } from "../hooks/useFocusLoader";
import {
  fetchDrawingGroups,
  createDrawingGroup,
  updateDrawingGroup,
  deleteDrawingGroup,
  fetchDrawingGroupPhotos,
  addDrawingGroupPhoto,
  removeDrawingGroupPhoto,
  reorderDrawingGroupPhotos,
} from "../services/drawingGroups";
import type { DrawingGroup, DrawingGroupInput } from "../types/drawingGroup";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/IconButton";
import { PressableScale } from "../components/ui/PressableScale";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SkeletonCard } from "../components/ui/Skeleton";
import { DrawingGroupForm } from "../components/documents/DrawingGroupForm";
import type { GroupPhoto } from "../components/documents/GroupPhotoUploader";
import { GroupPhotoPreviewModal } from "../components/documents/GroupPhotoPreviewModal";
import { notify } from "../utils/notify";

export default function GroupDrawingsScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // Centralized admin gate (role + active check, transient-tolerant). This
  // screen previously ran a bare `getSession()` check that neither verified
  // the role nor handled transient network failures.
  const { checking: authChecking } = useAdminGate();

  const [groups, setGroups] = useState<DrawingGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<DrawingGroup | null>(null);
  const [editingPhotos, setEditingPhotos] = useState<GroupPhoto[]>([]);

  const [viewingItem, setViewingItem] = useState<DrawingGroup | null>(null);

  // Cross-platform delete confirmation (Alert/confirm are no-ops on web)
  const [deleteTarget, setDeleteTarget] = useState<DrawingGroup | null>(null);

  const loadGroups = useCallback(async () => {
    try {
      const list = await fetchDrawingGroups();
      setGroups(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load groups.";
      notify("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const { refreshing, onRefresh } = useFocusLoader(loadGroups);

  async function handleSave(input: DrawingGroupInput, photos: GroupPhoto[]) {
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
      const res = await updateDrawingGroup(editingItem.id, input);
      if (!res.ok) throw new Error(res.error || "Failed to update.");

      const existingPhotos = await fetchDrawingGroupPhotos(editingItem.id);
      const existingIds = new Set(existingPhotos.map((p) => p.id));
      const keepIds = new Set(photos.filter((p) => p.id).map((p) => p.id));

      for (const ep of existingPhotos) {
        if (!keepIds.has(ep.id)) {
          await safe(() => removeDrawingGroupPhoto(ep.id), "Remove photo");
        }
      }

      for (const p of photos) {
        if (!p.id || !existingIds.has(p.id)) {
          await safe(
            () =>
              addDrawingGroupPhoto(
                editingItem.id,
                p.photo_url,
                p.photo_public_id
              ),
            "Add photo"
          );
        }
      }

      const updatedPhotos = await fetchDrawingGroupPhotos(editingItem.id);
      if (updatedPhotos.length > 0) {
        await safe(
          () =>
            reorderDrawingGroupPhotos(
              updatedPhotos.map((p, i) => ({ id: p.id, position: i }))
            ),
          "Reorder photos"
        );
      }
    } else {
      const res = await createDrawingGroup(input);
      if (!res.ok || !res.data) throw new Error(res.error || "Failed to create.");
      const groupId = res.data.id;

      for (const p of photos) {
        await safe(
          () => addDrawingGroupPhoto(groupId, p.photo_url, p.photo_public_id),
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

  async function handleEdit(item: DrawingGroup) {
    try {
      const photos = await fetchDrawingGroupPhotos(item.id);
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
    const res = await deleteDrawingGroup(deleteTarget.id);
    setDeleteTarget(null);
    if (res.ok) {
      await loadGroups();
    } else {
      notify("Error", res.error || "Failed to delete.");
    }
  }, [deleteTarget, loadGroups]);

  if (authChecking) {
    return (
      <View
        style={[
          styles.screen,
          { alignItems: "center", justifyContent: "center" },
        ]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
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
          eyebrow="Documents"
          title="Drawing Groups"
          subtitle={`${groups.length} ${
            groups.length === 1 ? "group" : "groups"
          } · Photos stay grouped by date`}
          right={
            <Button
              title="New"
              icon="plus"
              size="sm"
              onPress={() => {
                setEditingItem(null);
                setEditingPhotos([]);
                setShowForm(true);
              }}
            />
          }
        />

        {loading ? (
          <View style={styles.skeletons}>
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
          </View>
        ) : groups.length === 0 ? (
          <EmptyState
            icon="image"
            title="No drawing groups yet"
            message="Create a group to keep drawing photos together by date."
            action={
              <Button
                title="Create drawing group"
                icon="plus"
                onPress={() => {
                  setEditingItem(null);
                  setEditingPhotos([]);
                  setShowForm(true);
                }}
              />
            }
          />
        ) : (
          <View style={styles.list}>
            {groups.map((item) => (
              <View key={item.id} style={styles.card}>
                <PressableScale
                  onPress={() => setViewingItem(item)}
                  accessibilityLabel={`Open ${item.name}`}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.iconWrap}>
                      <Icon name="image" size={20} color={theme.colors.primary} />
                    </View>
                    <View style={styles.info}>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.date}>
                        {new Date(item.group_date).toLocaleDateString([], {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </Text>
                      <Text style={styles.hint}>Tap to open the drawing set</Text>
                    </View>
                    <Icon
                      name="chevronRight"
                      size={16}
                      color={theme.colors.textMuted}
                    />
                  </View>
                </PressableScale>

                <View style={styles.cardFooter}>
                  <Button
                    title="View photos"
                    icon="eye"
                    size="sm"
                    variant="secondary"
                    onPress={() => setViewingItem(item)}
                  />
                  <View style={styles.actions}>
                    <IconButton
                      icon="pencil"
                      accessibilityLabel={`Edit ${item.name}`}
                      onPress={() => handleEdit(item)}
                      variant="soft"
                      size={38}
                      iconSize={16}
                    />
                    <IconButton
                      icon="trash"
                      accessibilityLabel={`Delete ${item.name}`}
                      onPress={() => setDeleteTarget(item)}
                      variant="soft"
                      size={38}
                      iconSize={16}
                      color={theme.colors.danger}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete group"
        message={`Delete "${deleteTarget?.name}"? The photos stay in storage, but the group and its ordering are removed.`}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <DrawingGroupForm
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
          fetchPhotos={() => fetchDrawingGroupPhotos(viewingItem.id)}
        />
      )}
    </View>
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
    list: { gap: theme.spacing.sm },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 12,
      ...theme.elevation.card,
    },
    cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
    iconWrap: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    info: { flex: 1, minWidth: 0 },
    name: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    date: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },
    hint: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 3,
    },
    cardFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  });
