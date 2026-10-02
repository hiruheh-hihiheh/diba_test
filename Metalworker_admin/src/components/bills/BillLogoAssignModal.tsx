// src/components/bills/BillLogoAssignModal.tsx
//
// "Put this logo on these invoices", started from the Logo Library.
//
// WHY A SEARCHABLE LIST AND NOT "APPLY TO ALL"
// Assigning a letterhead is not a setting. It changes what a customer receives on a
// tax document, and which invoices carry a company's mark is usually decided per
// customer, per period, or per job — not globally. A button that stamped one logo on
// every invoice ever uploaded would be wrong far more often than it was right.
//
// WHY IT IS PAGINATED, AND WHY SELECT ALL STILL WORKS
// Select All means "every bill matching this search", and the count comes from the
// database — so ticking it on a search that matches four hundred bills costs the
// same as ticking it on four, and the client never holds four hundred rows. The
// selection is a set of ids plus a flag saying "all of these", not a materialised
// list. That is what keeps this responsive on a large library rather than freezing
// on a large selection.
//
// THE SELECTION IS KEPT ACROSS PAGES AND SEARCHES
// An admin assigning logos works through a list, and retyping a search to find the
// next page would make that impossible. Ids already chosen stay chosen; only the
// visible rows change. The count in the footer is the truth, and it is the number
// the operation will actually use.
//
// THE PROGRESS IS REAL
// The re-print that follows the assignment is batched on the server, and each batch
// reports what it finished. The bar says "Re-printing 40 of 137" because that is
// what has happened, not a timer advancing towards an estimate. A bill that cannot
// be re-printed is named afterwards rather than swallowed, because an invoice that
// silently printed without its logo is worse than one the admin is told about.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { formatBillDate } from "../../services/bills";
import {
  applyLogoToBills,
  fetchAssignableBills,
  ASSIGN_PAGE_SIZE,
  type AssignableBill,
} from "../../services/invoiceLogos";
import { logoReprintFailureReason, type InvoiceLogo } from "../../types/invoiceLogo";
import { notify } from "../../utils/notify";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

/**
 * Above this many bills, the apply asks first.
 *
 * The threshold exists because the operation re-prints three PDFs per bill, which
 * is real work and real time. Up to this number the dialog has already been a
 * deliberate act — a search, a list, a per-row choice — so a second confirmation
 * would be ceremony. Above it, the number itself is the warning, and the admin
 * should be told what they are about to do before they do it.
 */
const BULK_CONFIRM_THRESHOLD = 50;

/** Shared empty page, so `rows` is referentially stable while a page loads. */
const NO_ROWS: AssignableBill[] = [];

interface BillLogoAssignModalProps {
  logo: InvoiceLogo | null;
  onClose: () => void;
  /** Called after the assignment is written, with how many bills changed. */
  onApplied: (assigned: number) => void;
}

export function BillLogoAssignModal({ logo, onClose, onApplied }: BillLogoAssignModalProps) {
  /* Each logo gets its own instance of the body rather than a reused one with its
     state reset. The key advances whenever a different logo is opened, so React
     unmounts the old body and mounts a new one — which clears the search box, the
     ticked rows and the partial-failure report for free, with no effect doing it
     and no frame painted showing the previous logo's selection. */
  return (
    <AssignBody
      key={logo?.id ?? "none"}
      logo={logo}
      onClose={onClose}
      onApplied={onApplied}
    />
  );
}

/** The dialog's contents. Split out so opening it remounts this entirely. */
function AssignBody({
  logo,
  onClose,
  onApplied,
}: BillLogoAssignModalProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  /** The last settled page of results, tagged with the question that asked for it. */
  const [settled, setSettled] = useState<{
    key: string;
    rows: AssignableBill[];
    total: number;
  } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  /** Ids explicitly ticked, across every page and search. */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  /** Set when Select All covered the whole matching set. */
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ assigned: number; reprinted: number } | null>(null);
  /** Shown after a partial success, naming the bills that could not be printed. */
  const [report, setReport] = useState<{
    failures: { invoice_no: string | null; reason: string }[];
    warning?: string;
  } | null>(null);
  /** The extra confirmation for a very large apply. */
  const [confirming, setConfirming] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = logo !== null;

  /* Debounced so a fast typist does not fire a request per keystroke. 250ms is
     short enough to feel immediate and long enough to collapse a word into one
     request. */
  useEffect(() => {
    if (!open) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);

    searchTimer.current = setTimeout(() => {
      setPage(1);
    }, 250);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search, open]);

  /* The request key ties a response to the question that asked for it, so a slow
     page 1 cannot land after the user has already moved to page 2 and overwrite
     it. Making `loading`, `rows` and the error DERIVED from that key rather than
     assigned at the top of an async function also removes a whole class of bug:
     nothing is in flight unless the last settled result belongs to the current
     search and page, and rows from the previous page are not shown — or
     tickable — while the new ones arrive. */
  const requestKey = `${search}|${page}`;
  useEffect(() => {
    let cancelled = false;

    fetchAssignableBills(search, page, ASSIGN_PAGE_SIZE)
      .then((result) => {
        if (cancelled) return;
        setSettled({ key: requestKey, rows: result.rows, total: result.total });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed({
          key: requestKey,
          message: err instanceof Error ? err.message : "The invoices could not be loaded.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [search, page, requestKey]);

  const settledHere = settled?.key === requestKey;
  /* `NO_ROWS` rather than a fresh `[]` so this is referentially stable while a
     page is in flight — the memos and the row list below depend on `rows`, and a
     new array every render would make them recompute on every keystroke for no
     reason. It is never written to. */
  const rows = useMemo(
    () => (settledHere ? settled.rows : NO_ROWS),
    [settled, settledHere]
  );
  const total = settledHere ? settled.total : 0;
  const loading = !settledHere && failed?.key !== requestKey;
  const loadError = failed?.key === requestKey ? failed.message : null;

  /**
   * Ids for every bill matching the current search.
   *
   * Paged, because a single unbounded read of four hundred ids is exactly what
   * makes a control like Select All unusable. The loop stops on a short page or on
   * reaching the reported total, whichever comes first, so a concurrent insert
   * cannot make it walk forever.
   */
  const allMatchingIds = useCallback(async (): Promise<string[]> => {
    const out: string[] = [];
    const CHUNK = 500;
    for (let chunk = 0; ; chunk++) {
      const result = await fetchAssignableBills(search, chunk + 1, CHUNK);
      for (const row of result.rows) out.push(row.id);
      if (result.rows.length < CHUNK) break;
      if (out.length >= result.total) break;
      /* A hard stop, so a pathological dataset cannot spin here. Beyond this the
         admin still gets the first several thousand assigned, and the remainder
         stays queued for the server to finish on its next pass. */
      if (out.length >= 5000) break;
    }
    return out;
  }, [search]);

  /**
   * How many bills will be assigned.
   *
   * When Select All is on this is the total the database reported, not a count of
   * ticked rows — which is the honest number, and the one the confirmation quotes.
   */
  const targetCount = selectAllMatching ? total : picked.size;

  const visiblePicked = useMemo(() => rows.filter((row) => picked.has(row.id)).length, [rows, picked]);
  const allVisibleSelected = rows.length > 0 && visiblePicked === rows.length;

  function toggleRow(id: string) {
    /* Ticking a row after a Select All has to leave Select All, or the next
       render would put the row straight back: the flag and the set have to describe
       the same intent, and the set is now the more specific claim. */
    setSelectAllMatching(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectAllMatching(false);
    setPicked((prev) => {
      const next = new Set(prev);
      const shouldSelect = !allVisibleSelected;
      for (const row of rows) {
        if (shouldSelect) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  /**
   * Select every bill matching the current search, or clear.
   *
   * Nothing is loaded to do this: the count is already on screen from the last
   * page's exact count. That is the whole reason Select All stays usable on a
   * large search — the alternative, materialising the ids so they can be ticked,
   * is what makes this kind of control unusable at scale.
   */
  function toggleSelectAllMatching() {
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setPicked(new Set());
      return;
    }
    /* Even when every visible row is already ticked, making this the Select All
       control means the admin is asking for the rest of the matching set, not to
       untick the page — so the page is kept and the flag is set. */
    setSelectAllMatching(true);
  }

  async function run() {
    if (!logo || targetCount === 0) return;
    setApplying(true);
    setConfirming(false);
    setProgress({ assigned: 0, reprinted: 0 });
    setReport(null);

    try {
      /* Ids are sent in one array. When Select All covered the matching set, the
         matching bills are fetched by id — chunked, because a single request with
         four hundred uuids is a URL four hundred ids long, and the ids are needed
         because the assignment is a statement about specific rows rather than
         about a filter. The count is already known, so nothing here can silently
         assign a different set than the one that was counted. */
      const ids = selectAllMatching ? await allMatchingIds() : [...picked];
      if (ids.length === 0) {
        notify("No invoices were selected.");
        setApplying(false);
        setProgress(null);
        return;
      }

      const result = await applyLogoToBills(ids, logo.id, (p) =>
        setProgress({ assigned: p.assigned, reprinted: p.reprinted })
      );

      if (!result.ok) {
        notify("The logo could not be assigned.", result.error ?? "Please try again.");
        setApplying(false);
        setProgress(null);
        return;
      }

      setPicked(new Set());
      setSelectAllMatching(false);

      if (result.failures.length > 0) {
        setReport({
          failures: result.failures.map((f) => ({
            invoice_no: f.invoice_no,
            reason: logoReprintFailureReason(f.reason),
          })),
          warning: result.error,
        });
        notify(
          `Assigned to ${result.assigned} bills, but ${result.failures.length} could not be re-printed.`
        );
      } else {
        onApplied(result.assigned);
      }
    } catch (err) {
      notify(
        "The logo could not be assigned.",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setApplying(false);
      setProgress(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / ASSIGN_PAGE_SIZE));
  const billsWithOtherLogo = rows.filter((row) => row.logo_id && row.logo_id !== logo?.id).length;

  return (
    <>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={applying ? undefined : onClose}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Assign to Bills</Text>
            <Text style={styles.subtitle}>
              {logo
                ? `"${logo.name}" will print in the header of every invoice you select.`
                : ""}
            </Text>

            {report ? (
              <ScrollView style={styles.reportBox}>
                <Text style={styles.warning}>
                  {report.warning ??
                    "The logo was assigned, but these invoices could not be re-printed yet. Their stored PDFs still show the previous state, and will be re-printed on the next attempt."}
                </Text>
                {report.failures.map((failure, i) => (
                  <Text key={`${failure.invoice_no}-${i}`} style={styles.reportRow}>
                    <Text style={styles.reportInvoice}>{failure.invoice_no ?? "An invoice"}</Text>
                    {" — "}
                    {failure.reason}
                  </Text>
                ))}
                <Text style={styles.muted}>
                  The assignment itself is saved. Re-opening this dialog and assigning again will
                  pick up whatever is left.
                </Text>
              </ScrollView>
            ) : (
              <>
                <Input
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search by invoice number, customer, job number or date…"
                  accessibilityLabel="Search invoices by number, customer, job number or date"
                />

                {billsWithOtherLogo > 0 ? (
                  <Text style={styles.muted}>
                    {billsWithOtherLogo} of the{" "}
                    {rows.length === 1 ? "invoice on this page" : `${rows.length} invoices on this page`}{" "}
                    {billsWithOtherLogo === 1 ? "has" : "have"} a different logo. They will be
                    changed to this one.
                  </Text>
                ) : null}

                {progress ? (
                  <View style={styles.progressRow} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <Text style={styles.progressText}>
                      Assigned to {progress.assigned}{" "}
                      {progress.assigned === 1 ? "invoice" : "invoices"}
                      {progress.reprinted > 0 ? ` · re-printed ${progress.reprinted}` : ""}
                    </Text>
                  </View>
                ) : null}

                {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

                <View style={styles.selectRow}>
                  <Pressable
                    onPress={toggleAllVisible}
                    disabled={rows.length === 0 || applying}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: allVisibleSelected, disabled: rows.length === 0 }}
                    accessibilityLabel="Select all on this page"
                    style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]}
                  >
                    <Text style={styles.selectButtonText}>
                      {allVisibleSelected ? "☑" : "☐"} Select all on this page
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={toggleSelectAllMatching}
                    disabled={total === 0 || applying}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selectAllMatching, disabled: total === 0 }}
                    accessibilityLabel={
                      selectAllMatching ? "All matching invoices selected" : `Select all ${total} matching invoices`
                    }
                    style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]}
                  >
                    <Text style={[styles.selectButtonText, selectAllMatching && styles.selectButtonTextActive]}>
                      {selectAllMatching ? "☑" : "☐"}{" "}
                      {selectAllMatching ? "All matching selected" : `Select all ${total} matching`}
                    </Text>
                  </Pressable>
                </View>

                <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                  {rows.map((row) => {
                    const checked = selectAllMatching || picked.has(row.id);
                    const hasOther = !!row.logo_id && row.logo_id !== logo?.id;
                    return (
                      <Pressable
                        key={row.id}
                        onPress={() => toggleRow(row.id)}
                        disabled={applying}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked, disabled: applying }}
                        accessibilityLabel={row.invoice_no ?? "Unnumbered invoice"}
                        style={({ pressed }) => [
                          styles.row,
                          checked ? styles.rowSelected : styles.rowIdle,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.checkbox, checked && styles.checkboxChecked]}>
                          {checked ? "☑" : "☐"}
                        </Text>
                        <View style={styles.rowText}>
                          <Text style={styles.rowName} numberOfLines={1}>
                            {row.invoice_no || row.order_no || "Unnumbered invoice"}
                          </Text>
                          <Text style={styles.muted} numberOfLines={1}>
                            {[
                              row.party_name,
                              row.order_no && row.order_no !== row.invoice_no ? row.order_no : null,
                              row.invoice_date ? formatBillDate(row.invoice_date) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "No customer, job number or date"}
                          </Text>
                        </View>
                        {hasOther ? <Text style={styles.badge}>has another logo</Text> : null}
                      </Pressable>
                    );
                  })}

                  {loading && rows.length === 0 ? (
                    <View style={styles.center}>
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                      <Text style={styles.muted}>Loading invoices…</Text>
                    </View>
                  ) : null}

                  {!loading && rows.length === 0 && !loadError ? (
                    <View style={styles.empty}>
                      <Text style={styles.emptyTitle}>No invoices match that search</Text>
                      <Text style={styles.muted}>
                        Try an invoice number, a customer name, a job number, or part of a date.
                      </Text>
                    </View>
                  ) : null}
                </ScrollView>

                {pageCount > 1 ? (
                  <View style={styles.pager}>
                    <Text style={styles.muted}>
                      Page {page} of {pageCount} · {total} invoices match
                    </Text>
                    <View style={styles.pagerButtons}>
                      <Button
                        title="Previous"
                        variant="ghost"
                        onPress={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1 || loading}
                        style={styles.pagerButton}
                      />
                      <Button
                        title="Next"
                        variant="ghost"
                        onPress={() => setPage((p) => Math.min(pageCount, p + 1))}
                        disabled={page >= pageCount || loading}
                        style={styles.pagerButton}
                      />
                    </View>
                  </View>
                ) : null}

                {/* Says WHICH invoices, not just how many. A bare "412 selected" reads
                    as 412 on this page, and the next tap stamps a letterhead on all
                    of them. */}
                <Text style={styles.count}>
                  {targetCount > 0
                    ? `${targetCount} ${targetCount === 1 ? "invoice" : "invoices"} selected${
                        selectAllMatching && total > rows.length ? " · every invoice matching this search" : ""
                      }`
                    : "No invoices selected"}
                </Text>

                <Button
                  title={
                    applying
                      ? "Re-printing"
                      : targetCount > BULK_CONFIRM_THRESHOLD
                        ? `Assign to ${targetCount} invoices`
                        : "Assign logo"
                  }
                  loading={applying}
                  disabled={targetCount === 0}
                  onPress={() => {
                    /* A large apply re-prints three PDFs per bill, so above the
                       threshold the number is put in front of the admin once more
                       before the work starts. */
                    if (targetCount > BULK_CONFIRM_THRESHOLD) setConfirming(true);
                    else void run();
                  }}
                />
              </>
            )}

            {report ? (
              <Button title="Close" onPress={onClose} />
            ) : (
              <Button title="Cancel" variant="ghost" onPress={onClose} disabled={applying} />
            )}
          </View>
        </View>
      </Modal>

      {/* ── The extra confirmation for a very large apply ──────── */}
      <Modal
        visible={confirming}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setConfirming(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.title}>Assign to {targetCount} invoices?</Text>
            <Text style={styles.muted}>
              {logo?.name} will be assigned to {targetCount} invoices, and all three print copies
              of each will be re-printed. That is {targetCount * 3} PDFs. It keeps working in the
              background if you close this dialog.
            </Text>
            <View style={styles.actions}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setConfirming(false)}
                style={styles.flexButton}
              />
              <Button
                title="Yes, assign and re-print"
                onPress={() => void run()}
                style={styles.flexButton}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
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
      maxHeight: "92%",
    },
    confirmCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
      margin: theme.spacing.lg,
    },
    title: { color: theme.colors.text, fontSize: theme.textSizes.lg, fontWeight: "700" },
    subtitle: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm, lineHeight: 20 },
    list: { maxHeight: 300 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      marginBottom: 6,
    },
    rowIdle: { borderColor: theme.colors.border, backgroundColor: "transparent" },
    rowSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryMuted },
    rowText: { flex: 1, minWidth: 0 },
    rowName: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    checkbox: { fontSize: 17, color: theme.colors.textMuted },
    checkboxChecked: { color: theme.colors.primary },
    badge: {
      color: theme.colors.warning,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.5,
      textTransform: "uppercase",
      borderWidth: 1,
      borderColor: theme.colors.warning,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
      overflow: "hidden",
    },
    selectRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    selectButton: { paddingVertical: 6 },
    selectButtonText: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    selectButtonTextActive: { color: theme.colors.primary },
    progressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      padding: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.primaryMuted,
    },
    progressText: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "600" },
    reportBox: { gap: theme.spacing.xs },
    reportRow: { color: theme.colors.text, fontSize: theme.textSizes.sm, lineHeight: 20 },
    reportInvoice: { fontWeight: "700" },
    warning: { color: theme.colors.warning, fontSize: theme.textSizes.sm, lineHeight: 20 },
    muted: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm, lineHeight: 19 },
    errorText: { color: theme.colors.danger, fontSize: theme.textSizes.sm },
    center: { paddingVertical: theme.spacing.lg, alignItems: "center", gap: theme.spacing.sm },
    empty: {
      alignItems: "center",
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.lg,
      paddingHorizontal: theme.spacing.md,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
      textAlign: "center",
    },
    pager: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    pagerButtons: { flexDirection: "row", gap: theme.spacing.sm },
    pagerButton: { minHeight: 44, paddingHorizontal: theme.spacing.sm },
    count: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    actions: { flexDirection: "row", gap: theme.spacing.sm },
    flexButton: { flex: 1 },
    pressed: { opacity: 0.7 },
  });

export default BillLogoAssignModal;