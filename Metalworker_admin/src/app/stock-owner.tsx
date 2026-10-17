// src/app/stock-owner.tsx

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
  fetchOwnerStocks,
  createOwnerStock,
  updateOwnerStock,
  deleteOwnerStock,
} from "../services/ownerStock";
import type { OwnerStock, OwnerStockInput } from "../types/ownerStock";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/IconButton";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SearchBar } from "../components/ui/SearchBar";
import { SkeletonCard } from "../components/ui/Skeleton";
import { OwnerStockForm } from "../components/stock/OwnerStockForm";
import { notify } from "../utils/notify";

export default function StockOwnerScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // Centralized admin gate (role + active check, transient-tolerant). This
  // screen previously ran a bare `getSession()` check that neither verified
  // the role nor handled transient network failures.
  const { checking: authChecking } = useAdminGate();

  const [stocks, setStocks] = useState<OwnerStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<OwnerStock | null>(null);

  // Cross-platform delete confirmation (Alert/confirm are no-ops on web)
  const [deleteTarget, setDeleteTarget] = useState<OwnerStock | null>(null);

  const loadStocks = useCallback(async () => {
    try {
      const list = await fetchOwnerStocks();
      setStocks(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load stocks.";
      notify("Error", msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const { refreshing, onRefresh } = useFocusLoader(loadStocks);

  const filteredStocks = useMemo(() => {
    if (!search.trim()) return stocks;
    const q = search.toLowerCase();
    return stocks.filter(
      (s) =>
        (s.source_of_metal ?? "").toLowerCase().includes(q) ||
        (s.folder_no ?? "").toLowerCase().includes(q) ||
        (s.folio_number ?? "").toLowerCase().includes(q) ||
        (s.metal_type ?? "").toLowerCase().includes(q) ||
        (s.tn_no ?? "").toLowerCase().includes(q)
    );
  }, [stocks, search]);

  async function handleSave(input: OwnerStockInput) {
    if (editingItem) {
      const res = await updateOwnerStock(editingItem.id, input);
      if (!res.ok) throw new Error(res.error || "Failed to update.");
    } else {
      const res = await createOwnerStock(input);
      if (!res.ok) throw new Error(res.error || "Failed to create.");
    }
    await loadStocks();
  }

  function handleEdit(item: OwnerStock) {
    setEditingItem(item);
    setShowForm(true);
  }

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const res = await deleteOwnerStock(deleteTarget.id);
    setDeleteTarget(null);
    if (res.ok) {
      await loadStocks();
    } else {
      notify("Error", res.error || "Failed to delete.");
    }
  }, [deleteTarget, loadStocks]);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  }

  if (authChecking) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
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
          eyebrow="Inventory"
          title="Stock by Owner"
          subtitle={`${stocks.length} ${stocks.length === 1 ? "record" : "records"}${
            search ? ` · ${filteredStocks.length} shown` : ""
          }`}
          right={
            <Button
              title="Add"
              icon="plus"
              size="sm"
              onPress={() => {
                setEditingItem(null);
                setShowForm(true);
              }}
            />
          }
        />

        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search folder, folio, metal or T.N."
          accessibilityLabel="Search owner stock"
          autoCapitalize="none"
          style={styles.search}
        />

        {loading ? (
          <View style={styles.skeletons}>
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
          </View>
        ) : filteredStocks.length === 0 ? (
          <EmptyState
            icon="box"
            title={search ? "No matching records" : "No owner stock yet"}
            message={
              search
                ? "Try a different folder number, folio, metal type or T.N."
                : "Add the first owner stock record to start tracking material."
            }
            action={
              search ? (
                <Button title="Clear search" variant="secondary" onPress={() => setSearch("")} />
              ) : (
                <Button
                  title="Add owner stock"
                  icon="plus"
                  onPress={() => {
                    setEditingItem(null);
                    setShowForm(true);
                  }}
                />
              )
            }
          />
        ) : (
          <View style={styles.list}>
            {filteredStocks.map((item) => {
              const label = item.folder_no
                ? `${item.folder_no}${item.folio_number ? ` · ${item.folio_number}` : ""}`
                : item.source_of_metal || "Untitled";
              return (
                <View key={item.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    {item.drawing_photo_url ? (
                      <Image source={{ uri: item.drawing_photo_url }} style={styles.thumb} />
                    ) : (
                      <View style={styles.thumbEmpty}>
                        <Icon name="image" size={20} color={theme.colors.textMuted} />
                      </View>
                    )}

                    <View style={styles.info}>
                      <Text style={styles.title} numberOfLines={1}>
                        {label}
                      </Text>
                      <View style={styles.metaRow}>
                        {item.metal_type ? (
                          <Badge label={item.metal_type} tone="neutral" />
                        ) : null}
                        <Text style={styles.meta} numberOfLines={1}>
                          {item.source_of_metal || "No source recorded"}
                        </Text>
                      </View>
                      {item.amount_purchase != null ? (
                        <Text style={styles.amount}>
                          ₹{item.amount_purchase.toLocaleString()}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.cardFooter}>
                    <Text style={styles.date}>{formatDate(item.created_at)}</Text>
                    <View style={styles.actions}>
                      <Button
                        title="Edit"
                        icon="pencil"
                        size="sm"
                        variant="secondary"
                        onPress={() => handleEdit(item)}
                      />
                      <IconButton
                        icon="trash"
                        accessibilityLabel={`Delete ${label}`}
                        onPress={() => setDeleteTarget(item)}
                        variant="soft"
                        size={38}
                        iconSize={16}
                        color={theme.colors.danger}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete stock record"
        message={`Delete owner stock "${
          deleteTarget?.folder_no || deleteTarget?.source_of_metal || "record"
        }"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <OwnerStockForm
        key={editingItem?.id ?? "new"}
        visible={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingItem(null);
        }}
        onSave={handleSave}
        editingItem={editingItem}
      />
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
    search: { marginBottom: theme.spacing.md },
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
    cardTop: { flexDirection: "row", gap: 12 },
    thumb: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceSecondary,
    },
    thumbEmpty: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    info: { flex: 1, minWidth: 0 },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
      letterSpacing: -0.2,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 5,
    },
    meta: {
      flex: 1,
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
    },
    amount: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
      marginTop: 6,
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
    date: { color: theme.colors.textMuted, fontSize: theme.textSizes.caption },
    actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  });
