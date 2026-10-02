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
  deleteBillsInBulk,
  fetchBillIds,
  fetchBillLabels,
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
import { BILL_COPIES, BILL_COPY_LABEL, type Bill, type BulkProgress } from "../types/bill";
import { logoReprintFailureReason, type BillLogoRef } from "../types/invoiceLogo";
import {
  applyLogoToBills,
  describeBillLogo,
  fetchLogosByIds,
} from "../services/invoiceLogos";
import { BillingFolderSheet } from "../components/bills/BillingFolderSheet";
import { BulkOperationOverlay, type BulkOperation } from "../components/bills/BulkOperationOverlay";
import { BillCopyActions } from "../components/bills/BillCopyActions";
import { BillDetailModal } from "../components/bills/BillDetailModal";
import { BillEditScreen } from "../components/bills/BillEditScreen";
import { BillFolderPickerModal } from "../components/bills/BillFolderPickerModal";
import { BillUploadPanel } from "../components/bills/BillUploadPanel";
import { LogoPickerModal } from "../components/bills/LogoPickerModal";
import { LogoThumbnail } from "../components/bills/LogoThumbnail";
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
  /**
   * A bill awaiting confirmation of a SINGLE delete.
   *
   * Held as the target rather than a boolean so the dialog can name the invoice, and
   * so the row that opened it can show as busy while the dialog is up.
   */
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /**
   * A bulk delete awaiting confirmation.
   *
   * Separate from `deleteTarget` on purpose: the two dialogs say different things. One
   * names an invoice; the other has to make clear that N invoices across several
   * workbooks are going and that the other invoices in those workbooks are not.
   *
   * Confirmation is not optional here. With "Select all 412 matching" available, one
   * stray tap on Delete would otherwise destroy 412 invoices irrecoverably.
   */
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<string[] | null>(null);
  /**
   * The bulk operation currently running, if any.
   *
   * Non-null is the single signal the whole screen uses to lock itself: the Delete
   * button, Select All, the selection checkboxes and the folder bar all read it, so
   * there is exactly one definition of "a bulk operation is in flight" and no way for
   * one control to be re-enabled while another is still working.
   */
  const [bulk, setBulk] = useState<BulkOperation | null>(null);
  const [billingFoldersOpen, setBillingFoldersOpen] = useState(false);
  /** Bills armed to be filed into a billing folder when the sheet opens. */
  const [folderPendingIds, setFolderPendingIds] = useState<string[] | null>(null);
  /** Ids of every bill matching the filters, fetched only when asked for. */
  const [allMatchingIds, setAllMatchingIds] = useState<string[] | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
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
  /** True while any bulk operation owns the screen. See `bulk`. */
  const busy = bulk !== null;

  /** True while the bulk assign/remove is running, so the bar can lock. */
  const [logoBusy, setLogoBusy] = useState(false);
  /** The logo names behind the visible rows, by logo id. */
  const [logoNames, setLogoNames] = useState<Map<string, BillLogoRef>>(() => new Map());
  /** The bulk-assign picker. Opening it is the whole of "Assign Logo". */
  const [assignLogoOpen, setAssignLogoOpen] = useState(false);
  /** The confirmation before removing a logo from the whole selection. */
  const [bulkLogoConfirm, setBulkLogoConfirm] = useState(false);

  /* The logo line prints a NAME, and names live in `invoice_logos` — a different
     table. Asking per row would be one request per bill on the page, so the distinct
     ids are collected and asked about once. The key is the sorted set of ids rather
     than the array identity, so a refetch returning the same bills does not
     re-request, and a page change to different bills does. */
  const visibleLogoKey = useMemo(
    () =>
      [...new Set(bills.map((b) => b.logo_id).filter((v): v is string => !!v))].sort().join(","),
    [bills]
  );

  useEffect(() => {
    const wanted = visibleLogoKey ? visibleLogoKey.split(",") : [];
    if (wanted.length === 0) return;
    let cancelled = false;
    fetchLogosByIds(wanted)
      .then((next) => {
        if (!cancelled) setLogoNames(next);
      })
      .catch(() => {
        /* A missing name degrades one line to "Logo assigned", which is still
           truthful. Failing the whole list over a caption would be a worse trade
           than a line that is slightly less specific. */
        if (!cancelled) setLogoNames(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [visibleLogoKey]);

  /**
   * Is the current selection exactly "every bill matching the filters"?
   *
   * Recorded so the select-all strip can say so, and so the one control that can undo
   * it is a single tap. Without this, a 412-bill selection spread over 21 pages looks
   * identical to a 20-bill selection on page 1 until the user scrolls — and "Clear"
   * reads as clearing 20 when it will clear 412.
   *
   * Compared by LENGTH as well as contents, so a selection that happens to be the same
   * size as the matching set is not mistaken for one, and vice versa.
   */
  const allMatchingSelected =
    allMatchingIds !== null && allMatchingIds.length > 0 && allMatchingIds.length === selected.length;

  /**
   * Select every bill matching the current filters, across every page.
   *
   * The list is paginated, so "select all" over one page of 20 is not what the user
   * means when there are 400 bills and they want them in one folder. The ids are
   * fetched on demand rather than kept loaded, because carrying 1000+ uuids on every
   * render to support a button most sessions never press is the wrong trade.
   */
  async function handleSelectAllMatching() {
    if (busy || selectingAll) return;
    setSelectingAll(true);
    try {
      const ids = await fetchBillIds({
        search: search.trim() || undefined,
        uploadId: uploadFilter || null,
        from: from || null,
        to: to || null,
        jobKindValues: jobKindValuesForGroup,
      });
      setAllMatchingIds(ids);
      setSelected(ids);
      notify(
        `${ids.length} ${ids.length === 1 ? "bill" : "bills"} selected`,
        "Every bill matching the current filters is now selected, on any page.",
      );
    } catch (err) {
      notify(
        "The bills could not be selected",
        err instanceof Error ? err.message : "Please try again.",
      );
    } finally {
      setSelectingAll(false);
    }
  }

  /**
   * Select or clear just this page.
   *
   * Any across-everything selection is dropped, because the two are different things
   * and this control means the narrow one. That matters when every matching bill is
   * ticked: the page rows are all checked, so this reads as "Clear selection", and
   * tapping it must clear all 412 rather than replace them with 20.
   */
  function handleSelectAllOnPage() {
    if (busy) return;
    setAllMatchingIds(null);
    setSelected(allVisibleSelected ? [] : bills.map((b) => b.id));
  }

  function toggle(id: string) {
    /* Refused while a bulk operation runs. The overlay swallows these touches
       anyway; refusing here as well means a fast tap cannot slip through a gap
       in the UI's own event handling and change the selection mid-delete. */
    if (busy) return;
    /* Unticking one bill out of an across-everything selection breaks it, so the
       record of it goes too. Left in place it would go on reporting "all 412
       matching selected" for a selection that is now 411 and deliberately so. */
    setAllMatchingIds(null);
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

  /**
   * Apply a logo (or its absence) to every selected bill.
   *
   * `selected` is already the exact set of ids — the "every bill matching these
   * filters" case is resolved by `handleSelectAllMatching`, which fetches the ids
   * before it sets them — so there is nothing to gather here and nothing to guess.
   * That is why this can say which bills it is about to change before it does: the
   * answer is known, not estimated.
   *
   * The work underneath is one statement for the assignment and a bounded batch of
   * re-prints, both server-side, so four hundred bills cost the admin the same two
   * seconds as four. Progress is reported as it happens rather than faked, because
   * a bar that fills on a timer is a lie told to someone about their own tax
   * documents.
   */
  async function runBulkLogo(logoId: string | null) {
    const ids = [...selected];
    if (ids.length === 0 || logoBusy) return;

    if (logoId === null) {
      /* Removing is a real change to a financial document, so it asks first. It
         is the same operation as assigning and needs the same re-prints; the only
         difference is that the admin cannot preview the result, because the result
         is the absence of something. */
      setBulkLogoConfirm(true);
      return;
    }
    await applyLogoToSelection(ids, logoId);
  }

  async function applyLogoToSelection(ids: string[], logoId: string | null) {
    setLogoBusy(true);
    try {
      const result = await applyLogoToBills(ids, logoId);
      if (!result.ok) {
        notify(
          logoId ? "The logo could not be assigned" : "The logo could not be removed",
          result.error ?? "Please try again."
        );
        return;
      }

      /* Only the bills that really went are unticked. A bill that failed to
         re-print is still assigned and still selected, so a retry finds it without
         the admin having to hunt for it again. */
      if (result.failures.length > 0) {
        setSelected((prev) => prev.filter((id) => !result.failures.some((f) => f.bill_id === id)));
      } else {
        setAllMatchingIds(null);
        setSelected([]);
      }

      void load(true);

      if (result.failures.length > 0) {
        notify(
          `Logo ${logoId ? "assigned" : "removed"} on ${result.assigned} ${
            result.assigned === 1 ? "bill" : "bills"
          }, ${result.failures.length} could not be re-printed`,
          result.failures
            .slice(0, 3)
            .map((f) => `${f.invoice_no ?? "A bill"} — ${logoReprintFailureReason(f.reason)}`)
            .join("; ")
        );
        return;
      }

      notify(
        logoId === null
          ? `Logo removed from ${result.assigned} ${result.assigned === 1 ? "bill" : "bills"}`
          : `Logo assigned to ${result.assigned} ${result.assigned === 1 ? "bill" : "bills"}`,
        result.unchanged > 0
          ? `${result.unchanged} already had it and were left alone.`
          : "All three print copies were re-printed."
      );
    } catch (err) {
      notify(
        logoId ? "The logo could not be assigned" : "The logo could not be removed",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setLogoBusy(false);
    }
  }

  /** The generic folder picker: any folder, used from one bill's own detail view. */
  function openPicker(ids: string[]) {
    if (ids.length === 0 || busy) return;
    setDetailId(null);
    setPickerBillIds(ids);
  }

  /**
   * The Billing section's own folders, armed with the bills to file.
   *
   * This is where "Add to folder" on the list goes, rather than the generic
   * picker: filing 50 invoices should land in a Billing folder, not in a Labour
   * job folder that happens to exist.
   */
  function openBillingFolders(ids: string[]) {
    if (busy) return;
    setDetailId(null);
    setFolderPendingIds(ids);
    setBillingFoldersOpen(true);
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
      /* Deleting one of them means the "every matching bill" set no longer describes
         the selection, whatever is left of it. */
      setAllMatchingIds(null);
      await load(true);
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  }

  /**
   * Arm the bulk delete. This does NOT delete anything.
   *
   * Split from the work itself so a confirmation sits in between. With "Select all N
   * matching" one tap away, a delete that runs on the tap is a delete of 412 invoices
   * with no way back.
   *
   * The whole SELECTION is armed, not just the rows on this page. `selected` spans
   * pages by design, so arming `selectedBills` — which is the current page — would
   * offer to delete 20 while the bar says 412 are selected.
   */
  function requestBulkDelete() {
    if (selected.length === 0 || busy) return;
    setBulkDeleteTarget([...selected]);
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
    /* `busy` and not just an empty selection: a second tap must not start a second
       deletion while the first is still working through the list. */
    if (bulkDeleteTarget === null || busy) return;

    /* Snapshot the ids. `selected` is derived state and the page reloads underneath
       the operation — reading it again per bill would silently shrink the job as rows
       disappear. */
    const ids = [...bulkDeleteTarget];
    setDeleteTarget(null);
    setBulkDeleteTarget(null);

    /* Labels for the dialog and for any failure report.
     *
     * A bill selected on another page is not in `bills`, so the page cannot name it.
     * The service is asked for the ones it is missing rather than the list dropping
     * them from the delete: a selection the user can see must be a selection the
     * delete applies to. Anything that cannot be labelled is still deleted and is
     * reported by id, because a missing label is a cosmetic problem and a missing
     * delete is not. */
    const onThisPage = new Map(bills.map((b) => [b.id, b.invoice_no || b.sheet_name]));
    const missing = ids.filter((id) => !onThisPage.has(id));
    const labels = new Map(onThisPage);
    if (missing.length > 0) {
      try {
        const found = await fetchBillLabels(missing);
        for (const row of found) labels.set(row.id, row.label);
      } catch {
        /* Fall through: the delete proceeds and reports ids for anything unnamed. */
      }
    }
    const targets = ids.map((id) => ({ id, label: labels.get(id) ?? id.slice(0, 8) }));

    setBulk({
      title: "Deleting bills",
      subtitle: `${targets.length} ${targets.length === 1 ? "bill" : "bills"} selected`,
      progressLabel: "Deleting",
      progress: { done: 0, total: targets.length },
    });

    try {
      /* Progress is real: `deleteBill` is a multi-statement cascade and these run one
         at a time, so `done` counts invoices genuinely finished. Nothing here is a
         timer or an estimate, which is why the bar can say 18 / 37 and be right. */
      const result = await deleteBillsInBulk(targets, (progress: BulkProgress) =>
        setBulk((prev) => (prev ? { ...prev, progress } : prev))
      );

      /* Only bills that really went are dropped from the selection, so anything that
         failed stays ticked and can be retried without being hunted for again. The
         failures carry their ids precisely so this can be exact rather than
         "clear everything and hope". */
      const failedIds = new Set(result.failures.map((f) => f.id));
      setSelected((prev) => prev.filter((id) => !failedIds.has(id)));
      /* Whatever survived the delete is, by definition, no longer the whole matching
         set, so the "every matching bill" claim has to stop being made. */
      setAllMatchingIds(null);

      if (result.failed === 0) {
        notify(
          ids.length === 1 ? "Bill deleted" : `${ids.length} bills deleted`,
          "The selected invoices and their print copies are gone."
        );
      } else {
        /* Named, not summarised. "2 of 37 failed" without saying which 2 leaves the
           user unable to tell what is still on their books. */
        notify(
          `${result.deleted} of ${ids.length} deleted, ${result.failed} failed`,
          result.failures
            .map((f) => `${f.label}: ${f.error}`)
            .join(" · ")
        );
      }
    } catch (err) {
      /* The service loop reports per-bill failures itself and returns rather than
         throwing, so reaching here means something unexpected. Either way the list
         is reloaded below, so the screen shows the database's real state. */
      notify(
        "The deletion did not finish",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setBulk(null);
      setAllMatchingIds(null);
      await load(true);
    }
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
            {/* Select-all. Two doors, because they mean different things: the
                first covers this page, the second covers every bill the current
                filters match. With more bills than fit on a page, only the second
                gets 400 bills into a folder in one operation — which is the whole
                reason this section has its own folders. Both are inert while a
                bulk operation is running. */}
            <View style={styles.selectAllRow}>
              <Pressable
                onPress={handleSelectAllOnPage}
                disabled={busy}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allVisibleSelected, disabled: busy }}
                accessibilityLabel={
                  allVisibleSelected
                    ? "Clear the selection on this page"
                    : "Select every bill on this page"
                }
                style={({ pressed }) => [
                  styles.selectAll,
                  pressed && styles.pressed,
                  busy && styles.disabled,
                ]}
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

              {/* When every matching bill is already selected there is nothing to
                  offer, so the strip says what is selected instead — and how to get
                  rid of it. A 412-bill selection spread over 21 pages otherwise looks
                  identical to a 20-bill selection on page 1. */}
              {allMatchingSelected && (
                <Text style={styles.selectAllText}>
                  All {selected.length} matching bills selected
                </Text>
              )}

              {/* Only offered when there is more than this page to take, so the
                  common case stays one button rather than two competing ones. */}
              {!allMatchingSelected && !allVisibleSelected && total > bills.length && (
                <Pressable
                  onPress={() => void handleSelectAllMatching()}
                  disabled={busy || selectingAll}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy || selectingAll }}
                  accessibilityLabel={`Select all ${total} bills matching the current filters`}
                  style={({ pressed }) => [
                    styles.selectAllLink,
                    pressed && styles.pressed,
                    (busy || selectingAll) && styles.disabled,
                  ]}
                >
                  <Text style={styles.selectAllLinkText}>
                    {selectingAll ? "Finding all bills…" : `Select all ${total} matching`}
                  </Text>
                </Pressable>
              )}
            </View>

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
                      disabled={busy}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected, disabled: busy }}
                      accessibilityLabel={`Select bill ${
                        bill.invoice_no || bill.sheet_name
                      }`}
                      hitSlop={8}
                      style={({ pressed }) => [
                        pressed && styles.pressed,
                        busy && styles.disabled,
                      ]}
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

                  {/* The logo line answers "will this print with a letterhead?" at a
                      glance, which is the question an admin has when checking a list
                      before sending invoices out. It deliberately says "No Logo
                      Assigned" rather than showing nothing: the absence is the state
                      most bills are in, and silence would read as "not applicable"
                      rather than "chosen, deliberately none". */}
                  <View style={styles.logoRow}>
                    <Text style={styles.copyLabel}>Logo</Text>
                    {bill.logo_id ? (
                      <View style={styles.logoInner}>
                        <LogoThumbnail logoId={bill.logo_id} size={24} />
                        <Text style={styles.logoName} numberOfLines={1}>
                          {describeBillLogo(bill.logo_id, logoNames)}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.logoNone}>No Logo Assigned</Text>
                    )}
                    {bill.logo_rendered_logo_id !== bill.logo_id ? (
                      <Text style={styles.logoStale}>Re-printing PDF…</Text>
                    ) : null}
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
            {/* Says WHICH bills, not just how many. "412 bills selected" without the
                word "matching" reads as 412 on this page, and the user is about to
                delete or file all of them. */}
                      <Text style={styles.bulkCount}>
              {selected.length} {selected.length === 1 ? "bill" : "bills"} selected
              {allMatchingSelected ? " (every bill matching these filters)" : ""}
            </Text>
            <View style={styles.bulkActions}>
              <Pressable
                  onPress={() => {
                    setAllMatchingIds(null);
                    setSelected([]);
                  }}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel="Clear the selection"
                  style={({ pressed }) => [
                    styles.bulkBtnGhost,
                    pressed && styles.pressed,
                    busy && styles.disabled,
                  ]}
                >
                  <Text style={styles.actionTextSecondary}>Clear</Text>
                </Pressable>
                {/* Files into a BILLING folder, not a job folder — see
                  openBillingFolders for why these are two separate doors. */}
                <Pressable
                  onPress={() => openBillingFolders(selected)}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.bulkBtn,
                    pressed && styles.pressed,
                    busy && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel="Add the selected bills to a billing folder"
                >
                  <Text style={styles.actionText}>Add to folder</Text>
                </Pressable>
                {/* Bulk assign. The SAME picker the bill editor and the Logo Library
                    use, so there is one list of logos and one set of accepted formats
                    in the whole app. "No logo" is deliberately absent here: this is the
                    Assign action, and removal has its own button below — offering both
                    from one list would mean an admin could remove 400 letterheads by
                    clicking what reads as an assign control. */}
                <Pressable
                  onPress={() => setAssignLogoOpen(true)}
                  disabled={busy || logoBusy}
                  style={({ pressed }) => [
                    styles.bulkBtn,
                    pressed && styles.pressed,
                    (busy || logoBusy) && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy || logoBusy }}
                  accessibilityLabel={`Assign a logo to the ${selected.length} selected ${
                    selected.length === 1 ? "bill" : "bills"
                  }`}
                >
                  <Text style={styles.actionText}>Assign Logo</Text>
                </Pressable>
                <Pressable
                  onPress={() => void runBulkLogo(null)}
                  disabled={busy || logoBusy}
                  style={({ pressed }) => [
                    styles.bulkBtnGhost,
                    pressed && styles.pressed,
                    (busy || logoBusy) && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy || logoBusy }}
                  accessibilityLabel={`Remove the logo from the ${selected.length} selected ${
                    selected.length === 1 ? "bill" : "bills"
                  }`}
                >
                  <Text style={styles.actionTextSecondary}>Remove Logo</Text>
                </Pressable>
                <Pressable
                  onPress={requestBulkDelete}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.bulkBtnDanger,
                    pressed && styles.pressed,
                    busy && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
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

      {/* ── The bulk-assign picker ───────────────────────────────────── */}
      <LogoPickerModal
        visible={assignLogoOpen}
        onClose={() => setAssignLogoOpen(false)}
        onSelect={(logoId) => {
          if (logoId !== null) void applyLogoToSelection([...selected], logoId);
        }}
        allowNone={false}
        title={`Assign a logo to ${selected.length} ${
          selected.length === 1 ? "bill" : "bills"
        }`}
        subtitle="All three print copies of each bill are re-printed with the logo."
      />

      {/* Removing is the same operation as assigning and needs the same re-prints;
          the only difference is that the result cannot be previewed, because the
          result is the absence of something. So it asks. */}
      <ConfirmDialog
        visible={bulkLogoConfirm}
        title="Remove the logo from these bills?"
        message={`The logo will be removed from ${selected.length} ${
          selected.length === 1 ? "bill" : "bills"
        } and all three print copies of each will be re-printed without it. The logo itself stays in the Logo Library, so it can be put back at any time.`}
        confirmLabel="Remove logo"
        busy={logoBusy}
        onCancel={() => setBulkLogoConfirm(false)}
        onConfirm={() => {
          setBulkLogoConfirm(false);
          void applyLogoToSelection([...selected], null);
        }}
      />

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

      {/* The Billing section's own folder workspace. `folderPendingIds` is the armed
          selection; it is cleared when the sheet closes so a stale set of ids
          cannot be filed by the next visit. */}
      <BillingFolderSheet
        visible={billingFoldersOpen}
        pendingBillIds={folderPendingIds}
        onClose={() => {
          setBillingFoldersOpen(false);
          setFolderPendingIds(null);
        }}
        onChanged={() => void load(true)}
        onOpenBill={(billId) => setDetailId(billId)}
      />

      {/* The loading state for the whole screen. Mounted last so it paints over
          everything else, and the modal swallows every touch behind it — which is
          what makes a second Delete impossible while the first is running. */}
      <BulkOperationOverlay operation={bulk} />

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

      {/* The bulk counterpart. Names the count, names a few of the invoices, and says
          what survives — the single most misleading thing about a bill delete in the
          past was implying the whole workbook went. At 400+ bills a list of every
          invoice is unreadable, so a sample plus the count is the honest form. */}
      <ConfirmDialog
        visible={bulkDeleteTarget !== null}
        title={
          bulkDeleteTarget !== null && bulkDeleteTarget.length === 1
            ? "Delete this bill?"
            : `Delete ${bulkDeleteTarget?.length ?? 0} bills?`
        }
        message={bulkDeleteMessage(bulkDeleteTarget ?? [], bills, allMatchingSelected)}
        confirmLabel={
          bulkDeleteTarget !== null && bulkDeleteTarget.length === 1
            ? "Delete this bill"
            : `Delete ${bulkDeleteTarget?.length ?? 0} bills`
        }
        onConfirm={() => void handleBulkDelete()}
        onCancel={() => setBulkDeleteTarget(null)}
      />
    </SafeAreaView>
  );
}

/**
 * The wording for the bulk-delete confirmation.
 *
 * Kept out of the component so the sentence is one auditable string rather than JSX
 * fragments assembled inline, and so the rules it has to satisfy are readable in one
 * place:
 *
 *   * names the COUNT, because that is the number that matters and the bar already
 *     showed it;
 *   * names a SAMPLE of the invoices, because 400 names in a dialog is 400 names
 *     nobody reads — but no names at all means the user cannot tell a mis-selection
 *     from the one they meant;
 *   * says the three print copies go WITH the invoice, since those are what people
 *     actually want back;
 *   * says the other invoices in the same workbooks survive, because the opposite was
 *     the single most misleading thing about deleting a bill here.
 */
function bulkDeleteMessage(ids: string[], pageBills: Bill[], allMatching: boolean): string {
  if (ids.length === 0) return "";

  const labels = new Map(pageBills.map((b) => [b.id, b.invoice_no || b.sheet_name]));
  const named = ids.map((id) => labels.get(id)).filter((v): v is string => !!v);
  /* Three is enough to recognise the pattern without turning the dialog into a list. */
  const sample = named.slice(0, 3).join(", ");
  const rest = named.length > 3 ? ` and ${named.length - 3} more` : "";

  const which = allMatching
    ? "every bill matching the current filters"
    : ids.length === 1
      ? "the selected invoice"
      : `${ids.length} selected invoices`;

  if (ids.length === 1) {
    return `Invoice ${sample || "selected"} and its three print copies (original, duplicate, triplicate) will be deleted, along with its line items and any folder links to it. Other invoices from the same workbook are not affected. This cannot be undone.`;
  }

  return `This will delete ${which}: ${sample}${rest}. Each one's three print copies (original, duplicate, triplicate), its line items and its folder links go with it. Any other invoice, including the rest of the same workbooks, is not affected. This cannot be undone.`;
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

    selectAllRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    selectAll: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
    },
    selectAllText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    selectAllLink: {
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.primary,
    },
    selectAllLinkText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
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
    logoRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    logoInner: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      minWidth: 0,
    },
    logoName: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    logoNone: {
      flex: 1,
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
    },
    logoStale: {
      color: theme.colors.warning,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
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
    /* The one definition of "locked while a bulk operation runs". Every control
       that reads `busy` applies this, so the screen never shows one button still
       active while its neighbours are dimmed. */
    disabled: { opacity: 0.4 },
    /* Pressed feedback, shared by every Pressable on the screen. */
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

