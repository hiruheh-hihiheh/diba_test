// src/app/bills.tsx
//
// Tax-invoice workbooks, one row per invoice.
//
// WHAT A ROW IS
// A row is one real invoice, parsed from one worksheet. The workbook it came
// from produced three PDFs (original / duplicate / triplicate), but those are
// three print copies of the SAME invoice, so nothing on this screen counts them
// separately. Deleting is per WORKBOOK, because the three PDFs and the invoice
// rows only exist and die together — the confirmation says so in words.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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
import {
  deleteBillUpload,
  fetchBillUploads,
  fetchBills,
  formatBillDate,
  formatMoney,
  formatJobKind,
  formatQuantity,
} from "../services/bills";
import { BILL_COPIES, BILL_COPY_LABEL, type Bill } from "../types/bill";
import { BillCopyActions } from "../components/bills/BillCopyActions";
import { BillDetailModal } from "../components/bills/BillDetailModal";
import { BillFolderPickerModal } from "../components/bills/BillFolderPickerModal";
import { BillUploadPanel } from "../components/bills/BillUploadPanel";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input } from "../components/ui/Input";
import { notify } from "../utils/notify";

const DEFAULT_PAGE_SIZE = 20;

/** `YYYY-MM-DD`, which is what `bills.invoice_date` stores. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function BillsScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const { checking: authChecking } = useAdminGate();

  const [bills, setBills] = useState<Bill[]>([]);
  const [uploads, setUploads] = useState<
    { id: string; original_filename: string; invoice_count: number }[]
  >([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [search, setSearch] = useState("");
  const [uploadFilter, setUploadFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pickerBillIds, setPickerBillIds] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const hasFilters = !!uploadFilter || !!from || !!to;
  const filtered = !!search.trim() || hasFilters;

  /* A half-typed date is not a filter; sending "2026-0" to `gte` would silently
     return nothing. The value is only used once it is a complete date. */
  const fromBound = ISO_DATE.test(from) ? from : null;
  const toBound = ISO_DATE.test(to) ? to : null;

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [pageData, uploadList] = await Promise.all([
          fetchBills({
            search,
            uploadId: uploadFilter || null,
            from: fromBound,
            to: toBound,
            page,
            pageSize: DEFAULT_PAGE_SIZE,
          }),
          fetchBillUploads(),
        ]);
        setBills(pageData.rows);
        setTotal(pageData.total);
        setUploads(
          uploadList.map((u) => ({
            id: u.id,
            original_filename: u.original_filename,
            invoice_count: u.invoice_count,
          }))
        );
        setLoadError(null);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "The bills could not be loaded."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadedOnce(true);
      }
    },
    [search, uploadFilter, fromBound, toBound, page]
  );

  /* Debounced so typing does not fire a request per keystroke. */
  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const selectedBills = useMemo(
    () => bills.filter((b) => selected.includes(b.id)),
    [bills, selected]
  );

  /* Deleting one row deletes its whole workbook, so a multi-selection that
     spans two workbooks would be ambiguous. Rather than guess, say so. */
  const selectedWorkbooks = useMemo(
    () => Array.from(new Set(selectedBills.map((b) => b.bill_upload_id))),
    [selectedBills]
  );

  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const allVisibleSelected = bills.length > 0 && selectedBills.length === bills.length;

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function clearFilters() {
    setUploadFilter("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  function openPicker(ids: string[]) {
    if (ids.length === 0) return;
    setDetailId(null);
    setPickerBillIds(ids);
  }

  async function handleDelete(bill: Bill) {
    setDeleting(bill.bill_upload_id);
    try {
      const res = await deleteBillUpload(bill.bill_upload_id);
      if (!res.ok) {
        notify(
          "The workbook was not deleted",
          res.error || "Please try again."
        );
        return;
      }
      notify(
        "Workbook deleted",
        `${bill.original_filename} and its three PDFs are gone.`
      );
      setSelected((prev) =>
        prev.filter((id) => {
          const row = bills.find((b) => b.id === id);
          return row?.bill_upload_id !== bill.bill_upload_id;
        })
      );
      await load(true);
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  }

  async function handleBulkDelete() {
    if (selectedWorkbooks.length !== 1) {
      notify(
        "Select one workbook at a time",
        `Your selection spans ${selectedWorkbooks.length} workbooks. Delete uploads one workbook at a time so you can see exactly what goes.`
      );
      return;
    }
    await handleDelete(selectedBills[0]);
  }

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
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
          >
            <Text style={styles.backBtnText}>← Back</Text>
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>Bills</Text>
            <Text style={styles.headerSubtitle}>
              {loading && !loadedOnce
                ? "Loading…"
                : filtered
                ? `${total} ${total === 1 ? "bill matches" : "bills match"}`
                : `${total} ${total === 1 ? "bill" : "bills"} from ${uploads.length} ${
                    uploads.length === 1 ? "workbook" : "workbooks"
                  }`}
            </Text>
          </View>
        </View>

        <View style={styles.toolbar}>
          <Button
            title="+ Upload workbook"
            onPress={() => setUploadOpen(true)}
            style={styles.toolbarMain}
          />
          <Pressable
            onPress={() => setShowFilters((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showFilters }}
            accessibilityLabel="Filters"
            style={({ pressed }) => [
              styles.filterToggle,
              hasFilters && styles.filterToggleActive,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.filterToggleText,
                hasFilters && styles.filterToggleTextActive,
              ]}
            >
              {hasFilters ? "Filtered" : "Filter"}
            </Text>
          </Pressable>
        </View>

        {/* Search */}
        <Input
          label="Search"
          value={search}
          onChangeText={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Invoice no, filename, sheet or GST no…"
          returnKeyType="search"
          accessibilityLabel="Search bills by invoice number, filename, sheet or GST number"
        />

        {/* Filters */}
        {showFilters && (
          <View style={styles.filters}>
            <Text style={styles.filterLabel}>Workbook</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              <Pressable
                onPress={() => {
                  setUploadFilter("");
                  setPage(1);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: !uploadFilter }}
                style={({ pressed }) => [
                  styles.chip,
                  !uploadFilter && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    !uploadFilter && styles.chipTextActive,
                  ]}
                >
                  All workbooks
                </Text>
              </Pressable>
              {uploads.map((u) => (
                <Pressable
                  key={u.id}
                  onPress={() => {
                    setUploadFilter(u.id);
                    setPage(1);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: uploadFilter === u.id }}
                  accessibilityLabel={u.original_filename}
                  style={({ pressed }) => [
                    styles.chip,
                    uploadFilter === u.id && styles.chipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      uploadFilter === u.id && styles.chipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {u.original_filename} ({u.invoice_count})
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <Input
                  label="Invoice date from"
                  value={from}
                  onChangeText={(v) => {
                    setFrom(v);
                    setPage(1);
                  }}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Invoice date from, YYYY-MM-DD"
                />
              </View>
              <View style={styles.dateField}>
                <Input
                  label="to"
                  value={to}
                  onChangeText={(v) => {
                    setTo(v);
                    setPage(1);
                  }}
                  placeholder="YYYY-MM-DD"
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Invoice date to, YYYY-MM-DD"
                />
              </View>
            </View>

            {hasFilters && (
              <Pressable
                onPress={clearFilters}
                accessibilityRole="button"
                accessibilityLabel="Clear filters"
                style={({ pressed }) => [styles.clearBtn, pressed && styles.pressed]}
              >
                <Text style={styles.clearText}>Clear filters</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* List */}
        {loading && !loadedOnce ? (
          <View
            style={styles.loadingContainer}
            accessibilityLiveRegion="polite"
            accessibilityLabel="Loading bills"
          >
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : loadError ? (
          <View style={styles.errorState}>
            <Text style={styles.emptyTitle}>Could not load the bills</Text>
            <Text style={styles.emptyText}>{loadError}</Text>
            <Button title="Try again" onPress={() => void load()} />
          </View>
        ) : bills.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>{filtered ? "🔍" : "🧾"}</Text>
            <Text style={styles.emptyTitle}>
              {filtered ? "No bills match" : "No bills yet"}
            </Text>
            <Text style={styles.emptyText}>
              {filtered
                ? "Nothing matches the current search and filters."
                : "Upload a tax-invoice workbook. Each worksheet becomes one bill, and the workbook produces an original, a duplicate and a triplicate PDF."}
            </Text>
            <View style={styles.emptyActions}>
              {filtered ? (
                <Button
                  title="Clear search and filters"
                  onPress={() => {
                    setSearch("");
                    clearFilters();
                  }}
                />
              ) : (
                <Button
                  title="Upload workbook"
                  onPress={() => setUploadOpen(true)}
                />
              )}
            </View>
          </View>
        ) : (
          <>
            {/* Select-all */}
            <Pressable
              onPress={() =>
                setSelected(allVisibleSelected ? [] : bills.map((b) => b.id))
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allVisibleSelected }}
              accessibilityLabel={
                allVisibleSelected ? "Clear the selection" : "Select every bill on this page"
              }
              style={({ pressed }) => [styles.selectAll, pressed && styles.pressed]}
            >
              <View
                style={[
                  styles.checkbox,
                  allVisibleSelected && {
                    backgroundColor: theme.colors.primary,
                    borderColor: theme.colors.primary,
                  },
                ]}
              >
                {allVisibleSelected && <Text style={styles.checkboxTick}>✓</Text>}
              </View>
              <Text style={styles.selectAllText}>
                {allVisibleSelected ? "Clear selection" : "Select all on this page"}
              </Text>
            </Pressable>

            {bills.map((bill) => {
              const isSelected = selected.includes(bill.id);
              const rowBusy = deleting === bill.bill_upload_id;
              /* Normalized once per card: "WITHMETAL" must never reach the
                 screen, and an invoice that declared no job type shows nothing. */
              const jobKind = formatJobKind(bill.job_kind);
              return (
                <View
                  key={bill.id}
                  style={[
                    styles.billCard,
                    isSelected && styles.billCardSelected,
                    rowBusy && styles.billCardBusy,
                  ]}
                  accessibilityState={{ busy: rowBusy }}
                >
                  <View style={styles.billCardTop}>
                    <Pressable
                      onPress={() => toggle(bill.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityLabel={`Select bill ${
                        bill.invoice_no || bill.sheet_name
                      }`}
                      hitSlop={8}
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          isSelected && {
                            backgroundColor: theme.colors.primary,
                            borderColor: theme.colors.primary,
                          },
                        ]}
                      >
                        {isSelected && <Text style={styles.checkboxTick}>✓</Text>}
                      </View>
                    </Pressable>

                    <View style={styles.billMain}>
                      <Pressable
                        onPress={() => setDetailId(bill.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open bill ${
                          bill.invoice_no || bill.sheet_name
                        }`}
                      >
                        <Text style={styles.invoiceNo} numberOfLines={1}>
                          {bill.invoice_no || "No invoice number"}
                        </Text>
                      </Pressable>
                      {/* Job classification, under the invoice number. Normalized
                          once per card, so the raw "WITHMETAL" token is never
                          shown; omitted entirely when the invoice declared none. */}
                      {jobKind && (
                        <View style={styles.jobKindPill}>
                          <Text style={styles.jobKindPillText} numberOfLines={1}>
                            {jobKind}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.billSub} numberOfLines={1}>
                        {bill.party_name
                          ? `${bill.party_name} · `
                          : ""}
                        {`Sheet ${bill.sheet_name} · ${bill.original_filename}`}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.billFigures}>
                    <View style={styles.figureCell}>
                      <Text style={styles.figureLabel}>Qty</Text>
                      <Text style={styles.figureValue}>
                        {formatQuantity(bill.total_quantity)}
                      </Text>
                    </View>
                    <View style={styles.figureCell}>
                      <Text style={styles.figureLabel}>Invoice date</Text>
                      <Text style={styles.figureValue}>
                        {formatBillDate(bill.invoice_date)}
                      </Text>
                    </View>
                    <View style={styles.figureCellWide}>
                      <Text style={styles.figureLabel}>Amount</Text>
                      <Text style={styles.figureAmount}>
                        {formatMoney(bill.amount_after_tax)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.copyRow}>
                    <Text style={styles.copyLabel}>Print copies</Text>
                    <BillCopyActions bill={bill} layout="compact" />
                  </View>

                  <View style={styles.billActions}>
                    <Pressable
                      onPress={() => setDetailId(bill.id)}
                      style={({ pressed }) => [
                        styles.actionBtnSecondary,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`View bill ${
                        bill.invoice_no || bill.sheet_name
                      }`}
                    >
                      <Text style={styles.actionTextSecondary}>View</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => openPicker([bill.id])}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Add bill ${
                        bill.invoice_no || bill.sheet_name
                      } to a folder`}
                    >
                      <Text style={styles.actionText}>Add to folder</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDeleteTarget(bill)}
                      disabled={rowBusy}
                      style={({ pressed }) => [
                        styles.actionBtnDanger,
                        rowBusy && styles.actionBtnDisabled,
                        pressed && !rowBusy && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${bill.original_filename}`}
                      accessibilityState={{ busy: rowBusy }}
                    >
                      <Text style={styles.actionTextDanger}>
                        {rowBusy ? "Deleting…" : "Delete"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}

            {/* Pagination */}
            <View style={styles.pagination}>
              <Pressable
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                accessibilityRole="button"
                accessibilityLabel="Previous page"
                accessibilityState={{ disabled: page <= 1 }}
                style={({ pressed }) => [
                  styles.pageBtn,
                  page <= 1 && styles.actionBtnDisabled,
                  pressed && page > 1 && styles.pressed,
                ]}
              >
                <Text style={styles.actionTextSecondary}>← Prev</Text>
              </Pressable>
              <Text
                style={styles.pageInfo}
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Page ${page} of ${totalPages}`}
              >
                Page {page} of {totalPages}
              </Text>
              <Pressable
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                accessibilityRole="button"
                accessibilityLabel="Next page"
                accessibilityState={{ disabled: page >= totalPages }}
                style={({ pressed }) => [
                  styles.pageBtn,
                  page >= totalPages && styles.actionBtnDisabled,
                  pressed && page < totalPages && styles.pressed,
                ]}
              >
                <Text style={styles.actionTextSecondary}>Next →</Text>
              </Pressable>
            </View>

            <Text style={styles.legend}>
              The print copies are {BILL_COPIES.map((c) => BILL_COPY_LABEL[c]).join(", ")}.
              All three hold the same invoices and the same amounts; open a bill to view,
              download or print each one.
            </Text>
          </>
        )}

        {/* Bulk actions */}
        {selected.length > 0 && (
          <View style={styles.bulkBar} accessibilityLiveRegion="polite">
            <Text style={styles.bulkCount}>
              {selected.length} {selected.length === 1 ? "bill" : "bills"} selected
            </Text>
            <View style={styles.bulkActions}>
              <Pressable
                onPress={() => setSelected([])}
                accessibilityRole="button"
                accessibilityLabel="Clear the selection"
                style={({ pressed }) => [styles.bulkBtnGhost, pressed && styles.pressed]}
              >
                <Text style={styles.actionTextSecondary}>Clear</Text>
              </Pressable>
              <Pressable
                onPress={() => openPicker(selected)}
                style={({ pressed }) => [styles.bulkBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Add the selected bills to a folder"
              >
                <Text style={styles.actionText}>Add to folder</Text>
              </Pressable>
              <Pressable
                onPress={() => void handleBulkDelete()}
                style={({ pressed }) => [styles.bulkBtnDanger, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Delete the selected workbook"
              >
                <Text style={styles.actionTextDanger}>Delete workbook</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Dialogs ─────────────────────────────────────── */}

      {uploadOpen && (
        <BillUploadScreenModal
          onClose={() => setUploadOpen(false)}
          onUploaded={() => void load(true)}
        />
      )}

      <BillDetailModal
        billId={detailId}
        onClose={() => setDetailId(null)}
        onOpenFolderPicker={(bill) => openPicker([bill.id])}
      />

      {pickerBillIds && (
        <BillFolderPickerModal
          visible
          billIds={pickerBillIds}
          title={`${pickerBillIds.length} ${
            pickerBillIds.length === 1 ? "bill" : "bills"
          }`}
          onClose={() => setPickerBillIds(null)}
          onAdded={() => void load(true)}
        />
      )}

      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete this workbook?"
        message={`${deleteTarget?.original_filename ?? "This workbook"} will be deleted completely: ${
          deleteTarget?.invoice_no
            ? `the invoice ${deleteTarget.invoice_no} and every other invoice in that workbook`
            : "every invoice in that workbook"
        }, all three PDFs (original, duplicate and triplicate), and any folder links to them. This cannot be undone.`}
        confirmLabel="Delete workbook"
        busy={!!deleteTarget && deleting === deleteTarget.bill_upload_id}
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </SafeAreaView>
  );
}

/**
 * A plain Modal wrapper so the upload panel gets the same chrome as the other
 * dialogs. Defined here rather than in `components/ui` because it is the only
 * screen that needs it.
 */
function BillUploadScreenModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Upload a bill workbook</Text>
          <Text style={styles.sheetSubtitle}>
            One .xlsx file. Every sheet becomes one bill.
          </Text>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            <BillUploadPanel onUploaded={onUploaded} onClose={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xl },

    header: { marginBottom: theme.spacing.lg },
    backBtn: { marginBottom: theme.spacing.sm, alignSelf: "flex-start" },
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

    toolbar: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
    toolbarMain: { flex: 1 },
    filterToggle: {
      minHeight: 50,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    filterToggleActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primaryMuted,
    },
    filterToggleText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    filterToggleTextActive: { color: theme.colors.primary },

    filters: { marginBottom: theme.spacing.md },
    filterLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginBottom: theme.spacing.xs,
    },
    chipRow: { gap: theme.spacing.sm, paddingVertical: 2, paddingRight: theme.spacing.md },
    chip: {
      minHeight: 38,
      maxWidth: 220,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    chipActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primaryMuted,
    },
    chipText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
    },
    chipTextActive: { color: theme.colors.primary },
    dateRow: { flexDirection: "row", gap: theme.spacing.sm },
    dateField: { flex: 1 },
    clearBtn: { alignSelf: "flex-start", paddingVertical: theme.spacing.xs },
    clearText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },

    loadingContainer: { paddingVertical: theme.spacing.xl * 2, alignItems: "center" },
    emptyState: { alignItems: "center", paddingVertical: theme.spacing.xl * 2 },
    errorState: { alignItems: "center", paddingVertical: theme.spacing.xl, gap: theme.spacing.sm },
    emptyIcon: { fontSize: 40, marginBottom: theme.spacing.md },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      marginBottom: 4,
      textAlign: "center",
    },
    emptyText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
    },
    emptyActions: { marginTop: theme.spacing.lg, alignSelf: "stretch" },

    selectAll: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    selectAllText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxTick: {
      color: theme.colors.primaryButtonText,
      fontSize: 13,
      fontWeight: "800",
      lineHeight: 16,
    },

    billCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    billCardSelected: { borderColor: theme.colors.primary },
    billCardBusy: { opacity: 0.6 },
    billCardTop: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm },
    billMain: { flex: 1, minWidth: 0 },
    invoiceNo: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
    },
    /* Self-align so the pill hugs the text rather than stretching the card, and
       sits inline with the invoice number's own line height. */
    jobKindPill: {
      alignSelf: "flex-start",
      marginTop: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 5,
      backgroundColor: theme.colors.primaryMuted,
    },
    jobKindPillText: {
      color: theme.colors.primary,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.6,
    },
    billSub: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },

    billFigures: {
      flexDirection: "row",
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    figureCell: { flex: 1 },
    figureCellWide: { flex: 1.4, alignItems: "flex-end" },
    figureLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    figureValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      marginTop: 2,
    },
    figureAmount: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      marginTop: 2,
    },

    copyRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      paddingTop: theme.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    copyLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },

    billActions: {
      flexDirection: "row",
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    actionBtn: {
      flex: 1,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.primary + "15",
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    actionText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    actionBtnSecondary: {
      flex: 1,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.border,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    actionTextSecondary: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    actionBtnDanger: {
      flex: 1,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.danger + "15",
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    actionTextDanger: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    actionBtnDisabled: { opacity: 0.4 },

    pagination: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    pageBtn: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.border,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    pageInfo: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    legend: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      lineHeight: 18,
      marginTop: theme.spacing.md,
    },

    bulkBar: {
      marginTop: theme.spacing.lg,
      padding: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primaryMuted,
      gap: theme.spacing.sm,
    },
    bulkCount: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    bulkActions: { gap: theme.spacing.sm },
    bulkBtn: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.primary + "25",
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    bulkBtnGhost: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.border,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    bulkBtnDanger: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.danger + "25",
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },

    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      borderTopWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      maxHeight: "92%",
    },
    sheetTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
    },
    sheetSubtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      marginBottom: theme.spacing.md,
    },
    pressed: { opacity: 0.7 },
  });
