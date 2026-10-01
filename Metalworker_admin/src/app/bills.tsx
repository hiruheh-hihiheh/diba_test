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
  deleteBill,
  fetchBillJobFacets,
  fetchBillUploads,
  fetchBills,
  formatBillDate,
  formatMoney,
  formatJobKind,
  formatQuantity,
  type BillJobFacet,
  type BillJobGroup,
} from "../services/bills";
import { BILL_COPIES, BILL_COPY_LABEL, type Bill } from "../types/bill";
import { BillCopyActions } from "../components/bills/BillCopyActions";
import { BillDetailModal } from "../components/bills/BillDetailModal";
import { BillEditScreen } from "../components/bills/BillEditScreen";
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
  /** The bill open in the editor, or null. Separate from the read-only detail view. */
  const [editId, setEditId] = useState<string | null>(null);
  const [pickerBillIds, setPickerBillIds] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  /** `null` = All. Otherwise the raw stored `job_kind` values in that bucket. */
  const [jobGroup, setJobGroup] = useState<BillJobGroup | null>(null);
  const [facets, setFacets] = useState<BillJobFacet[]>([]);

  const hasFilters = !!uploadFilter || !!from || !!to || jobGroup !== null;
  const filtered = !!search.trim() || hasFilters;

  /* The facet strip is derived from `job_kind` alone, so it does not change with
     the search box, the date range or the current page: it always answers "how
     many of each kind exist", which is what a user picking a bucket needs. */
  const jobKindValuesForGroup = useMemo(() => {
    if (jobGroup === null) return null;
    return facets.filter((f) => f.group === jobGroup).map((f) => f.raw ?? "");
  }, [facets, jobGroup]);

  const facetTotals = useMemo(() => {
    const totals = new Map<BillJobGroup, number>();
    for (const f of facets) {
      if (f.group === "other" && !f.raw) continue; // unclassified sits in its own chip
      totals.set(f.group, (totals.get(f.group) ?? 0) + f.count);
    }
    return totals;
  }, [facets]);

  /* A half-typed date is not a filter; sending "2026-0" to `gte` would silently
     return nothing. The value is only used once it is a complete date. */
  const fromBound = ISO_DATE.test(from) ? from : null;
  const toBound = ISO_DATE.test(to) ? to : null;

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [pageData, uploadList, facetList] = await Promise.all([
          fetchBills({
            search,
            uploadId: uploadFilter || null,
            from: fromBound,
            to: toBound,
            jobKindValues: jobKindValuesForGroup,
            page,
            pageSize: DEFAULT_PAGE_SIZE,
          }),
          fetchBillUploads(),
          // The facet strip is cheap and independent of the page, so it rides
          // along rather than becoming a second load path that can disagree.
          fetchBillJobFacets(),
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
        setFacets(facetList);
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
    [search, uploadFilter, fromBound, toBound, jobKindValuesForGroup, page]
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
    setJobGroup(null);
    setPage(1);
  }

  function openPicker(ids: string[]) {
    if (ids.length === 0) return;
    setDetailId(null);
    setPickerBillIds(ids);
  }

  /**
   * Delete ONE bill.
   *
   * A bill-level delete, not a workbook delete: siblings from the same upload,
   * their line items and their own documents are all left alone. The confirmation
   * says so explicitly, because the previous wording implied the whole workbook
   * was going and that was the most misleading part of the old behaviour.
   */
  async function handleDelete(bill: Bill) {
    setDeleting(bill.id);
    try {
      const res = await deleteBill(bill.id);
      if (!res.ok) {
        notify("The bill was not deleted", res.error || "Please try again.");
        return;
      }
      const gone = bill.invoice_no || bill.sheet_name;
      notify(
        "Bill deleted",
        (res.siblingsRemaining ?? 0) > 0
          ? `${gone} and its three PDFs are gone. ${res.siblingsRemaining} other invoice(s) from ${bill.original_filename} remain.`
          : `${gone} was the last invoice in ${bill.original_filename}, so the workbook was removed too.`
      );
      setSelected((prev) => prev.filter((id) => id !== bill.id));
      await load(true);
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  }

  /**
   * Delete every selected bill, one at a time.
   *
   * Per bill, not per workbook, and deliberately not all-or-nothing across the
   * selection: each `deleteBill` is independent, so a failure on one is reported
   * and the rest still go. That is the honest behaviour when the user has ticked
   * eight invoices from three different workbooks and asked for all eight.
   */
  async function handleBulkDelete() {
    if (selectedBills.length === 0) return;
    const ids = selectedBills.map((b) => b.id);
    setDeleteTarget(null);
    const failed: string[] = [];
    for (const bill of selectedBills) {
      const res = await deleteBill(bill.id);
      if (!res.ok) {
        failed.push(`${bill.invoice_no || bill.sheet_name}: ${res.error ?? "failed"}`);
      }
    }
    setSelected((prev) => prev.filter((id) => !ids.includes(id)));
    if (failed.length === 0) {
      notify(
        ids.length === 1 ? "Bill deleted" : `${ids.length} bills deleted`,
        "The selected invoices and their print copies are gone."
      );
    } else {
      notify(
        `${failed.length} of ${ids.length} could not be deleted`,
        failed.join(" · ")
      );
    }
    await load(true);
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

        {/* Job-type grouping.
            One workbook legitimately contains both kinds, so this is a filter on
            the one `job_kind` column, not a second list: no rows are duplicated
            and a bill appears under exactly one chip. A workbook whose job type
            this build has not seen lands in "Other" rather than disappearing
            between two known buckets. */}
        {facets.length > 0 && (
          <View style={styles.jobGroupRow} accessibilityRole="radiogroup">
            <Text style={styles.filterLabel}>Job type</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              <JobGroupChip
                active={jobGroup === null}
                label="All"
                count={facets.reduce((sum, f) => sum + f.count, 0)}
                onPress={() => {
                  setJobGroup(null);
                  setPage(1);
                }}
              />
              {(["with_metal", "labour", "other"] as BillJobGroup[]).map((group) => {
                const count = facetTotals.get(group) ?? 0;
                if (count === 0) return null;
                const names = Array.from(
                  new Set(
                    facets
                      .filter((f) => f.group === group && f.raw !== null)
                      .map((f) => f.label)
                  )
                );
                return (
                  <JobGroupChip
                    key={group}
                    active={jobGroup === group}
                    label={group === "other" ? `Other (${names.join(", ")})` : names[0] ?? group}
                    count={count}
                    onPress={() => {
                      setJobGroup(jobGroup === group ? null : group);
                      setPage(1);
                    }}
                  />
                );
              })}
            </ScrollView>
          </View>
        )}

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
              const rowBusy = deleting === bill.id;
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
                      onPress={() => setEditId(bill.id)}
                      disabled={rowBusy}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        rowBusy && styles.actionBtnDisabled,
                        pressed && !rowBusy && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit bill ${
                        bill.invoice_no || bill.sheet_name
                      }`}
                    >
                      <Text style={styles.actionText}>Edit</Text>
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
                      accessibilityLabel={`Delete bill ${
                        bill.invoice_no || bill.sheet_name
                      }`}
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
                accessibilityLabel={`Delete the ${selected.length} selected ${
                  selected.length === 1 ? "bill" : "bills"
                }`}
              >
                <Text style={styles.actionTextDanger}>
                  {selected.length === 1 ? "Delete bill" : `Delete ${selected.length} bills`}
                </Text>
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
        onEdit={(bill) => {
          /* Close the read-only view first: the editor loads the same row, and two
             stacked sheets on one bill is confusing to leave open. */
          setDetailId(null);
          setEditId(bill.id);
        }}
      />

      {/* Editing re-prints this bill's three documents from the saved values, so the
          list reloads afterwards: the amount, the copy row and the download links
          all have to show the new version. */}
      {editId && (
        <BillEditScreen
          billId={editId}
          onClose={() => setEditId(null)}
          onSaved={() => void load(true)}
        />
      )}

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

      {/* A BILL delete, not a workbook delete. The wording is explicit about the
          siblings that survive, because the old text said the whole workbook
          would go and that was the most misleading part of the behaviour. */}
      <ConfirmDialog
        visible={!!deleteTarget}
        title="Delete this bill?"
        message={`Invoice ${
          deleteTarget?.invoice_no || deleteTarget?.sheet_name || ""
        } and its three print copies (original, duplicate, triplicate) will be deleted, along with its line items and any folder links to it. Other invoices from the same workbook are not affected. This cannot be undone.`}
        confirmLabel="Delete this bill"
        busy={!!deleteTarget && deleting === deleteTarget.id}
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
    jobGroupRow: { marginBottom: theme.spacing.md },
    jobGroupChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 38,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    jobGroupChipActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary,
    },
    jobGroupChipText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    jobGroupChipTextActive: { color: theme.colors.primaryButtonText },
    jobGroupChipCount: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
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
/**
 * One button in the job-type facet strip.
 *
 * A toggle rather than a radio: tapping the active chip returns to All, which is
 * the fastest way out of a filter that turns out to be wrong. The count sits
 * beside the label so the split is visible before anything is chosen.
 */
function JobGroupChip({
  active,
  onPress,
  label,
  count,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
  count: number;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, checked: active }}
      accessibilityLabel={`${label}, ${count} ${count === 1 ? "bill" : "bills"}`}
      style={({ pressed }) => [
        styles.jobGroupChip,
        active && styles.jobGroupChipActive,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.jobGroupChipText,
          active && styles.jobGroupChipTextActive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.jobGroupChipCount,
          active && styles.jobGroupChipTextActive,
        ]}
      >
        {count}
      </Text>
    </Pressable>
  );
}

