// src/components/bills/BillFolderPickerModal.tsx
//
// "Add these bills to a folder", reachable from the Bills list and from a bill's
// detail view.
//
// It writes ONE `folder_items` row per bill (item_type 'bill'). The three print
// copies are deliberately not offered separately: a folder holds documents, and
// the copy you want is chosen later, per bill. Adding all three would also make
// the folder's bill count three times the truth.

import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { addMultipleItemsToFolder, fetchFolders } from "../../services/folders";
import type { AdminFolder } from "../../types/folder";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { notify } from "../../utils/notify";

export function BillFolderPickerModal({
  visible,
  billIds,
  title,
  onClose,
  onAdded,
}: {
  visible: boolean;
  billIds: string[];
  /** What is being added, e.g. "1 bill" or "3 bills". */
  title: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Bumped by "Try again" so the effect below actually refetches. */
  const [reloadToken, setReloadToken] = useState(0);

  /* Reset on open/close DURING RENDER (React's documented "adjust state when a
     prop changes" pattern) rather than in an effect. Two things fall out of
     that: reopening never shows the previous search or a folder that is no
     longer the selection, and the loading flag is already correct by the time
     the effect runs, so the effect never calls setState synchronously. */
  const [shownVisible, setShownVisible] = useState(visible);
  if (visible !== shownVisible) {
    setShownVisible(visible);
    setFolders([]);
    setSearch("");
    setTarget(null);
    setError(null);
    setLoading(visible);
  }

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchFolders()
      .then((list) => {
        if (cancelled) return;
        setFolders(list);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Folders could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, reloadToken]);

  const needle = search.trim().toLowerCase();
  const visibleFolders = needle
    ? folders.filter((f) => f.name.toLowerCase().includes(needle))
    : folders;

  async function confirm() {
    if (!target || saving || billIds.length === 0) return;
    setSaving(true);
    try {
      const res = await addMultipleItemsToFolder(
        target,
        billIds.map((id) => ({ type: "bill" as const, id }))
      );
      if (!res.ok) {
        notify("The bills were not added", res.error || "Please try again.");
        return;
      }
      const folder = folders.find((f) => f.id === target);
      notify(
        `Added to ${folder?.name ?? "folder"}`,
        `${billIds.length} ${billIds.length === 1 ? "bill" : "bills"} linked.`
      );
      onAdded();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={saving ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Add {title} to a folder</Text>
          <Text style={styles.subtitle}>
            A bill is added once. The original, duplicate and triplicate PDFs stay
            with it.
          </Text>

          {loading ? (
            <View style={styles.center} accessibilityLiveRegion="polite">
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : error ? (
            <View style={{ gap: theme.spacing.md }}>
              <Text style={styles.error}>{error}</Text>
              <Button
                title="Try again"
                onPress={() => {
                  setError(null);
                  setLoading(true);
                  setReloadToken((n) => n + 1);
                }}
              />
            </View>
          ) : (
            <>
              <Input
                label="Search folders"
                value={search}
                onChangeText={setSearch}
                placeholder="Search folders…"
                returnKeyType="search"
                accessibilityLabel="Search folders"
              />

              {visibleFolders.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>
                    {needle ? "No folder matches" : "No folders yet"}
                  </Text>
                  <Text style={styles.emptyBody}>
                    {needle
                      ? `Nothing matches "${search.trim()}".`
                      : "Create a folder on the Folders page first, then add bills to it."}
                  </Text>
                </View>
              ) : (
                <ScrollView style={styles.list} nestedScrollEnabled>
                  {visibleFolders.map((folder) => {
                    const selected = target === folder.id;
                    return (
                      <Pressable
                        key={folder.id}
                        onPress={() => setTarget(folder.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        accessibilityLabel={folder.name}
                        style={({ pressed }) => [
                          styles.folderRow,
                          selected && styles.folderRowSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.folderInfo}>
                          <Text style={styles.folderName} numberOfLines={1}>
                            {folder.name}
                          </Text>
                          <Text style={styles.folderDate}>
                            Created{" "}
                            {new Date(folder.created_at).toLocaleDateString()}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.radio,
                            selected && {
                              borderColor: theme.colors.primary,
                              backgroundColor: theme.colors.primary,
                            },
                          ]}
                        >
                          {selected && (
                            <Text style={styles.radioDot}>✓</Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}

          <View style={styles.actions}>
            <Button
              title="Cancel"
              onPress={onClose}
              variant="ghost"
              style={styles.actionButton}
            />
            {!loading && !error && (
              <Button
                title="Add to folder"
                onPress={() => void confirm()}
                loading={saving}
                disabled={!target || saving || billIds.length === 0}
                style={styles.actionButton}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      borderTopWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
      maxHeight: "85%",
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
      marginBottom: theme.spacing.sm,
    },
    center: { paddingVertical: theme.spacing.xl, alignItems: "center" },
    error: { color: theme.colors.danger, fontSize: theme.textSizes.sm },
    empty: { paddingVertical: theme.spacing.lg, alignItems: "center" },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    emptyBody: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
      marginTop: 4,
    },
    list: { maxHeight: 300 },
    folderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceSecondary,
      marginBottom: theme.spacing.sm,
    },
    folderRowSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primaryMuted,
    },
    folderInfo: { flex: 1, minWidth: 0 },
    folderName: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    folderDate: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },
    radio: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    radioDot: { color: theme.colors.primaryButtonText, fontSize: 13, fontWeight: "800" },
    actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
    actionButton: { flex: 1 },
    pressed: { opacity: 0.8 },
  });
