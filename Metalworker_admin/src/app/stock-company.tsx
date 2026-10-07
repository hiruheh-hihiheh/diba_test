// src/app/stock-company.tsx

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
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
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
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
      <View style={styles.screen}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
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
        {/* Count caption (shell header carries the title) */}
        <Text style={[styles.headerSubtitle, styles.countCaption]}>
          {stocks.length} Records
        </Text>

        {/* Search + Add */}
        <Input
          placeholder="Search stocks..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          accessibilityLabel="Search stocks"
        />
        <Button
          title="+ Add Company Stock"
          onPress={() => {
            setEditingItem(null);
            setShowForm(true);
          }}
        />

        <View style={styles.spacer} />

        {/* List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : filteredStocks.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🏭</Text>
            <Text style={styles.emptyTitle}>
              {search ? "No Results" : "No Company Stock Records"}
            </Text>
            <Text style={styles.emptyText}>
              {search
                ? "Try a different search term."
                : "Add your first company stock record above."}
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {filteredStocks.map((item) => (
              <View key={item.id} style={styles.stockRow}>
                <View style={styles.stockRowMain}>
                  {item.metal_photo_url ? (
                    <Image
                      source={{ uri: item.metal_photo_url }}
                      style={styles.stockThumb}
                    />
                  ) : (
                    <View style={styles.stockThumbPlaceholder}>
                      <Text style={styles.stockThumbPlaceholderText}>🏭</Text>
                    </View>
                  )}
                  <View style={styles.stockInfo}>
                    <Text style={styles.stockTitle} numberOfLines={1}>
                      {item.company_name || "Untitled"}
                    </Text>
                    <Text style={styles.stockMeta} numberOfLines={1}>
                      {item.product_name || "—"} •{" "}
                      {item.folder_no
                        ? `${item.folder_no}${item.folio_number ? " - " + item.folio_number : ""}`
                        : "No folder"}
                    </Text>
                    {item.metal_type && (
                      <Text style={styles.stockMetalType}>
                        {item.metal_type}
                        {item.processed_metal_type
                          ? ` → ${item.processed_metal_type}`
                          : ""}
                      </Text>
                    )}
                    <Text style={styles.stockDate}>
                      {formatDate(item.created_at)}
                    </Text>
                  </View>
                </View>
                <View style={styles.stockActions}>
                  <Pressable
                    onPress={() => handleEdit(item)}
                    style={styles.actionBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${item.company_name || "company stock"}`}
                  >
                    <Text style={styles.actionText}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDeleteTarget(item)}
                    style={styles.actionBtnDanger}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.company_name || "company stock"}`}
                  >
                    <Text style={styles.actionTextDanger}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Delete confirmation */}
      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete Stock"
        message={`Delete company stock "${deleteTarget?.company_name || deleteTarget?.folder_no || "record"}"?`}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Form Modal */}
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

const createStyles = (theme: AppTheme) => StyleSheet.create({
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
    alignSelf: "flex-start",
  },
  backBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  headerInfo: {},
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
  countCaption: {
    marginBottom: theme.spacing.md,
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
  listCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  stockRow: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  stockRowMain: {
    flexDirection: "row",
    marginBottom: theme.spacing.sm,
  },
  stockThumb: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.sm,
    marginRight: theme.spacing.md,
    backgroundColor: theme.colors.background,
  },
  stockThumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.sm,
    marginRight: theme.spacing.md,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  stockThumbPlaceholderText: {
    fontSize: 24,
  },
  stockInfo: {
    flex: 1,
  },
  stockTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: 2,
  },
  stockMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginBottom: 2,
  },
  stockMetalType: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    marginBottom: 2,
  },
  stockDate: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
  },
  stockActions: {
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