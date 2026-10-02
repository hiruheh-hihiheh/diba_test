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
// the tab on a large selection.
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckSquare, Loader2, SearchX, Square, X } from "lucide-react";

import {
  applyLogoToBills,
  fetchAssignableBills,
  ASSIGN_PAGE_SIZE,
  type AssignableBill,
} from "../../services/invoiceLogos";
import { logoReprintFailureReason, type InvoiceLogo } from "../../types/invoiceLogo";
import { formatBillDate } from "../../services/bills";
import Modal, { ModalCancel } from "../ui/Modal";
import EmptyState from "../ui/EmptyState";
import SearchInput from "../ui/SearchInput";
import { useToast } from "../ui/Toast";

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

interface BillLogoAssignModalProps {
  logo: InvoiceLogo | null;
  onClose: () => void;
  /** Called after the assignment is written, with how many bills changed. */
  onApplied: (assigned: number) => void;
}

export function BillLogoAssignModal({ logo, onClose, onApplied }: BillLogoAssignModalProps) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AssignableBill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Ids explicitly ticked, across every page and search. */
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  /** Set when Select All covered the whole matching set. */
  const [selectAllMatching, setSelectAllMatching] = useState(false);

  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<{ assigned: number; reprinted: number } | null>(null);
  /** Shown after a partial success, naming the bills that could not be printed. */
  const [report, setReport] = useState<{ failures: { invoice_no: string | null; reason: string }[]; warning?: string } | null>(null);
  /** The extra confirmation for a very large apply. */
  const [confirming, setConfirming] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = logo !== null;

  /* Reset everything on open, so a second logo starts from a clean sheet rather
     than inheriting the previous one's ticked rows. */
  useEffect(() => {
    if (!open) return;
    setSearch("");
    setPage(1);
    setPicked(new Set());
    setSelectAllMatching(false);
    setApplying(false);
    setProgress(null);
    setReport(null);
    setConfirming(false);
  }, [open, logo?.id]);

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

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchAssignableBills(search, page, ASSIGN_PAGE_SIZE);
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "The invoices could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [open, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * How many bills will be assigned.
   *
   * When Select All is on this is the total the database reported, not a count of
   * ticked rows — which is the honest number, and the one the confirmation quotes.
   */
  const targetCount = selectAllMatching ? total : picked.size;

  const visiblePicked = useMemo(
    () => rows.filter((row) => picked.has(row.id)).length,
    [rows, picked]
  );

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
   * page's `count: "exact"`. That is the whole reason Select All stays usable on a
   * large search — the alternative, materialising the ids so they can be ticked,
   * is what makes this kind of control unusable at scale.
   */
  function toggleSelectAllMatching() {
    if (selectAllMatching) {
      setSelectAllMatching(false);
      setPicked(new Set());
      return;
    }
    if (allVisibleSelected) {
      /* Every visible row is already ticked. Making this the Select All control
         means the admin is asking for the rest of the matching set, not to untick
         the page — so the page is kept and the flag is set. */
      setSelectAllMatching(true);
      return;
    }
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
        toast.error("No invoices were selected.");
        setApplying(false);
        setProgress(null);
        return;
      }

      const result = await applyLogoToBills(ids, logo.id, (p) =>
        setProgress({ assigned: p.assigned, reprinted: p.reprinted })
      );

      if (!result.ok) {
        toast.error(result.error ?? "The logo could not be assigned.");
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
        toast.error(
          `Assigned to ${result.assigned} bills, but ${result.failures.length} could not be re-printed.`
        );
      } else {
        onApplied(result.assigned);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The logo could not be assigned.");
    } finally {
      setApplying(false);
      setProgress(null);
    }
  }

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

  const pageCount = Math.max(1, Math.ceil(total / ASSIGN_PAGE_SIZE));
  const billsWithOtherLogo = rows.filter((row) => row.logo_id && row.logo_id !== logo?.id).length;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Assign to Bills"
        subtitle={logo ? `“${logo.name}” will print in the header of every invoice you select.` : undefined}
        size="xl"
        hideClose={applying}
        footer={
          report ? (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all cursor-pointer"
            >
              Close
            </button>
          ) : (
            <>
              <span className="mr-auto text-sm text-text-muted tabular-nums">
                {targetCount > 0 ? (
                  <>
                    <span className="font-semibold text-text">{targetCount}</span>{" "}
                    {targetCount === 1 ? "invoice" : "invoices"} selected
                    {selectAllMatching && total > rows.length && (
                      <> · every invoice matching this search</>
                    )}
                  </>
                ) : (
                  "No invoices selected"
                )}
              </span>
              <ModalCancel onClick={onClose} disabled={applying} />
              <button
                type="button"
                onClick={() => {
                  /* A large apply re-prints three PDFs per bill, so above the
                     threshold the number is put in front of the admin once more
                     before the work starts. */
                  if (targetCount > BULK_CONFIRM_THRESHOLD) setConfirming(true);
                  else void run();
                }}
                disabled={applying || targetCount === 0}
                className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {applying ? (
                  <>
                    <Loader2 size={15} className="animate-spin mr-1.5 inline" />
                    Re-printing…
                  </>
                ) : targetCount > BULK_CONFIRM_THRESHOLD ? (
                  `Assign to ${targetCount} invoices`
                ) : (
                  "Assign logo"
                )}
              </button>
            </>
          )
        }
      >
        {report ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-warning-muted border border-warning/25 text-warning text-sm">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                {report.warning ??
                  "The logo was assigned, but these invoices could not be re-printed yet. Their stored PDFs still show the previous state, and will be re-printed on the next attempt."}
              </span>
            </div>
            <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {report.failures.map((failure, i) => (
                <li key={`${failure.invoice_no}-${i}`} className="text-sm text-text">
                  <span className="font-semibold">{failure.invoice_no ?? "An invoice"}</span>{" "}
                  <span className="text-text-muted">— {failure.reason}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-text-muted leading-relaxed">
              The assignment itself is saved. Re-opening this dialog and assigning again will
              pick up whatever is left.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <SearchInput
              value={search}
              onChange={setSearch}
              scope="invoices"
              unit="invoice"
              resultCount={total}
              placeholder="Search by invoice number, customer, job number or date…"
            />

            {billsWithOtherLogo > 0 && (
              <p className="text-xs text-text-muted">
                {billsWithOtherLogo} of the{" "}
                {rows.length === 1 ? "invoice on this page" : `${rows.length} invoices on this page`}{" "}
                {billsWithOtherLogo === 1 ? "has" : "have"} a different logo. They will be
                changed to this one.
              </p>
            )}

            {progress && (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-primary/5 border border-primary/20 text-sm text-text">
                <Loader2 size={15} className="animate-spin text-primary shrink-0" />
                <span>
                  Assigned to {progress.assigned}{" "}
                  {progress.assigned === 1 ? "invoice" : "invoices"}
                  {progress.reprinted > 0 && ` · re-printed ${progress.reprinted}`}
                </span>
              </div>
            )}

            {loadError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-danger-muted border border-danger/25 text-danger text-sm"
              >
                {loadError}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pb-1 border-b border-border">
              <button
                type="button"
                onClick={toggleAllVisible}
                disabled={rows.length === 0}
                className="flex items-center gap-2 text-sm font-semibold text-text hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {allVisibleSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                Select all on this page
              </button>
              <button
                type="button"
                onClick={toggleSelectAllMatching}
                disabled={total === 0}
                className={`flex items-center gap-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                  selectAllMatching ? "text-primary" : "text-text hover:text-primary"
                }`}
                title="Select every invoice matching this search, without loading them all"
              >
                {selectAllMatching ? <CheckSquare size={15} /> : <Square size={15} />}
                {selectAllMatching ? "All matching selected" : `Select all ${total} matching`}
              </button>
            </div>

            <div className="flex flex-col gap-1.5 max-h-[45vh] overflow-y-auto -mx-1 px-1">
              {rows.map((row) => {
                const checked = selectAllMatching || picked.has(row.id);
                const hasOther = !!row.logo_id && row.logo_id !== logo?.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleRow(row.id)}
                    disabled={applying}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors disabled:opacity-60 cursor-pointer ${
                      checked ? "border-primary bg-primary/5" : "border-border hover:bg-surface-hover"
                    }`}
                  >
                    {checked ? (
                      <CheckSquare size={17} className="text-primary shrink-0" />
                    ) : (
                      <Square size={17} className="text-text-muted shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-text truncate">
                        {row.invoice_no || row.order_no || "Unnumbered invoice"}
                      </span>
                      <span className="block text-xs text-text-muted truncate">
                        {[
                          row.party_name,
                          row.order_no && row.order_no !== row.invoice_no ? row.order_no : null,
                          row.invoice_date ? formatBillDate(row.invoice_date) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No customer, job number or date"}
                      </span>
                    </span>
                    {hasOther && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-warning bg-warning-muted border border-warning/25 rounded-md px-1.5 py-0.5 shrink-0">
                        has another logo
                      </span>
                    )}
                    {checked && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleRow(row.id);
                        }}
                        aria-label={`Remove ${row.invoice_no ?? "invoice"} from selection`}
                        className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </button>
                );
              })}

              {loading && rows.length === 0 && (
                <div className="flex items-center justify-center gap-2.5 py-10 text-text-muted">
                  <Loader2 size={17} className="animate-spin" />
                  <span className="text-sm">Loading invoices…</span>
                </div>
              )}

              {!loading && rows.length === 0 && !loadError && (
                <EmptyState
                  size="sm"
                  icon={<SearchX size={22} />}
                  title="No invoices match that search"
                  description="Try an invoice number, a customer name, a job number, or part of a date."
                />
              )}
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
                <p className="text-xs text-text-muted tabular-nums">
                  Page {page} of {pageCount} · {total} invoices match
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm font-semibold text-text hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    disabled={page >= pageCount || loading}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm font-semibold text-text hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── The extra confirmation for a very large apply ──────── */}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Assign to ${targetCount} invoices?`}
        size="sm"
        footer={
          <>
            <ModalCancel onClick={() => setConfirming(false)} />
            <button
              type="button"
              onClick={() => void run()}
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all cursor-pointer"
            >
              Yes, assign and re-print
            </button>
          </>
        }
      >
        <p className="text-sm text-text-muted leading-relaxed">
          {logo?.name} will be assigned to {targetCount} invoices, and all three print copies of
          each will be re-printed. That is {targetCount * 3} PDFs. It keeps working in the
          background if you close this dialog.
        </p>
      </Modal>
    </>
  );
}

export default BillLogoAssignModal;
