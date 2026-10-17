// src/app/stock-company.tsx

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
  fetchCompanyStocks,
  createCompanyStock,
  updateCompanyStock,
  deleteCompanyStock,
} from "../services/companyStock";
import type { CompanyStock, CompanyStockInput } from "../types/companyStock";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/IconButton";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SearchBar } from "../components/ui/SearchBar";
import { SkeletonCard } from "../components/ui/Skeleton";
import { CompanyStockForm } from "../components/stock/CompanyStockForm";
import { notify } from "../utils/notify";

export default function StockCompanyScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  // Centralized admin gate (role + active check, transient-tolerant). This
  // screen previously ran a bare `getSession()` check that neither verified
  // the role nor handled transient network failures.
  const { checking: authChecking } = useAdminGate();

  const [stocks, setStocks] = useState<CompanyStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<CompanyStock | null>(null);

  // Cross-platform delete confirmation (Alert/confirm are no-ops on web)
  const [deleteTarget, setDeleteTarget] = useState<CompanyStock | null>(null);

  const loadStocks = useCallback(async () => {
    try {
      const list = await fetchCompanyStocks();
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
        (s.company_name ?? "").toLowerCase().includes(q) ||
        (s.product_name ?? "").toLowerCase().includes(q) ||
        (s.folder_no ?? "").toLowerCase().includes(q) ||
        (s.folio_number ?? "").toLowerCase().includes(q) ||
        (s.metal_type ?? "").toLowerCase().includes(q)
    );
  }, [stocks, search]);

  async function handleSave(input: CompanyStockInput) {
    if (editingItem) {
      const res = await updateCompanyStock(editingItem.id, input);
      if (!res.ok) throw new Error(res.error || "Failed to update.");
    } else {
      const res = await createCompanyStock(input);
      if (!res.ok) throw new Error(res.error || "Failed to create.");
    }
    await loadStocks();
  }

  function handleEdit(item: CompanyStock) {
    setEditingItem(item);
    setShowForm(true);
  }

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const res = await deleteCompanyStock(deleteTarget.id);
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
          title="Stock by Company"
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
          placeholder="Search company, product, folder or metal"
          accessibilityLabel="Search company stock"
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
            icon="building"
            title={search ? "No matching records" : "No company stock yet"}
            message={
              search
                ? "Try a different company, product, folder or metal type."
                : "Add the first company stock record to start tracking material."
            }
            action={
              search ? (
                <Button title="Clear search" variant="secondary" onPress={() => setSearch("")} />
              ) : (
                <Button
                  title="Add company stock"
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
              const label = item.company_name || "Untitled";
              return (
                <View key={item.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    {item.metal_photo_url ? (
                      <Image source={{ uri: item.metal_photo_url }} style={styles.thumb} />
                    ) : (
                      <View style={styles.thumbEmpty}>
                        <Icon name="building" size={20} color={theme.colors.textMuted} />
                      </View>
                    )}

                    <View style={styles.info}>
                      <Text style={styles.title} numberOfLines={1}>
                        {label}
                      </Text>
                      <Text style={styles.product} numberOfLines={1}>
                        {item.product_name || "No product recorded"}
                      </Text>
                      <View style={styles.metaRow}>
                        {item.metal_type ? (
                          <Badge
                            label={
                              item.processed_metal_type
                                ? `${item.metal_type} → ${item.processed_metal_type}`
                                : item.metal_type
                            }
                            tone="primary"
                          />
                        ) : null}
                        {item.folder_no ? (
                          <Badge
                            label={`${item.folder_no}${
                              item.folio_number ? ` · ${item.folio_number}` : ""
                            }`}
                            tone="neutral"
                          />
                        ) : null}
                      </View>
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
        message={`Delete company stock "${
          deleteTarget?.company_name || "record"
        }"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <CompanyStockForm
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
    product: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 2,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 7,
      flexWrap: "wrap",
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
