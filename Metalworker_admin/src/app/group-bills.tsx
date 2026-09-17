// src/app/group-bills.tsx

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
import { BillGroupForm } from "../components/documents/BillGroupForm";
import type { GroupPhoto } from "../components/documents/GroupPhotoUploader";

export default function GroupBillsScreen() {
  const [groups, setGroups] = useState<BillGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<BillGroup | null>(null);
  const [editingPhotos, setEditingPhotos] = useState<GroupPhoto[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
    });
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      const list = await fetchBillGroups();
      setGroups(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load groups.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGroups();
    setRefreshing(false);
  }, [loadGroups]);

  async function handleSave(input: BillGroupInput, photos: GroupPhoto[]) {
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
          await removeBillGroupPhoto(ep.id);
        }
      }

      // Add new photos
      for (const p of photos) {
        if (!p.id || !existingIds.has(p.id)) {
          await addBillGroupPhoto(editingItem.id, p.photo_url, p.photo_public_id);
        }
      }

      // Reorder remaining
      const updatedPhotos = await fetchBillGroupPhotos(editingItem.id);
      if (updatedPhotos.length > 0) {
        await reorderBillGroupPhotos(
          updatedPhotos.map((p, i) => ({ id: p.id, position: i }))
        );
      }
    } else {
      // Create group
      const res = await createBillGroup(input);
      if (!res.ok || !res.data) throw new Error(res.error || "Failed to create.");

      // Add photos
      for (const p of photos) {
        await addBillGroupPhoto(res.data.id, p.photo_url, p.photo_public_id);
      }
    }
    await loadGroups();
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
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    }
  }

  function handleDelete(item: BillGroup) {
    const doDelete = async () => {
      const res = await deleteBillGroup(item.id);
      if (res.ok) {
        await loadGroups();
      } else {
        const msg = res.error || "Failed to delete.";
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Error", msg);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(`Delete bill group "${item.name}"?`)) {
        doDelete();
      }
    } else {
      Alert.alert("Delete Group", `Delete "${item.name}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: doDelete },
      ]);
    }
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
          <Text style={styles.headerTitle}>Group Bill</Text>
          <Text style={styles.headerSubtitle}>
            {groups.length} Groups
          </Text>
        </View>

        <Button
          title="+ Create Bill Group"
          onPress={() => {
            setEditingItem(null);
            setEditingPhotos([]);
            setShowForm(true);
          }}
        />

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
                  onPress={() => handleEdit(item)}
                  style={styles.actionBtn}
                >
                  <Text style={styles.actionText}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleDelete(item)}
                  style={styles.actionBtnDanger}
                >
                  <Text style={styles.actionTextDanger}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <BillGroupForm
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
    alignItems: "center",
  },
  actionText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  actionBtnDanger: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.danger + "15",
    minWidth: 70,
    alignItems: "center",
  },
  actionTextDanger: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
});
