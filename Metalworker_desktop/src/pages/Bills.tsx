// src/pages/Bills.tsx
//
// Tax-invoice workbooks, one row per invoice.
//
// WHAT A ROW IS
// A row is one real invoice, parsed from one worksheet. The workbook it came
// from produced three PDFs (original / duplicate / triplicate), but those are
// three print copies of the SAME invoice, so nothing on this page counts them
// separately. Deleting is per WORKBOOK, because the three PDFs and the invoice
// rows only exist and die together — the confirmation says so in words.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Receipt,
  RefreshCw,
  SearchX,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import {
  deleteBill,
  fetchBillJobFacets,
  fetchBillUploads,
  fetchBills,
  formatBillDate,
  formatMoney,
  formatJobKind,
  type BillJobFacet,
  type BillJobGroup,
  formatQuantity,
} from "../services/bills";
import { BILL_COPIES, BILL_COPY_LABEL, type Bill, type BillUpload } from "../types/bill";
import { usePageMeta } from "../contexts/PageMetaContext";
import { useSelection } from "../hooks/useSelection";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import Modal from "../components/ui/Modal";
import IconButton from "../components/ui/IconButton";
import Pagination from "../components/ui/Pagination";
import SelectAllCheckbox from "../components/ui/SelectAllCheckbox";
import BulkActionBar from "../components/ui/BulkActionBar";
import { ErrorState, InlineRefreshBar } from "../components/ui/LoadingState";
import { BillCopyActions } from "../components/bills/BillCopyActions";
import { BillDetailModal } from "../components/bills/BillDetailModal";
import { BillUploadPanel } from "../components/bills/BillUploadPanel";
import { BillFolderPickerModal } from "../components/bills/BillFolderPickerModal";

const DEFAULT_PAGE_SIZE = 25;

const selectCls =
  "bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary";
const inputCls =
  "bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary";

export default function BillsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const selection = useSelection();

  const [bills, setBills] = useState<Bill[]>([]);
  const [uploads, setUploads] = useState<BillUpload[]>([]);
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
  const [pageSize, setPageSizeRaw] = useState(DEFAULT_PAGE_SIZE);

  /** `null` = All. Otherwise the raw stored `job_kind` values in that bucket. */
  const [jobGroup, setJobGroup] = useState<BillJobGroup | null>(null);
  const [facets, setFacets] = useState<BillJobFacet[]>([]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const hasFilters = !!uploadFilter || !!from || !!to || jobGroup !== null;

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

  /* Changing the page size restarts at page 1: staying on page 4 of the old
     size would land past the end of the new, shorter result set. */
  const setPageSize = useCallback((n: number) => {
    setPageSizeRaw(n);
    setPage(1);
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [pageData, uploadList, facetList] = await Promise.all([
          fetchBills({
            search,
            uploadId: uploadFilter || null,
            from: from || null,
            to: to || null,
            jobKindValues: jobKindValuesForGroup,
            page,
            pageSize,
          }),
          fetchBillUploads(),
          // The facet strip is cheap and independent of the page, so it rides
          // along rather than becoming a second load path that can disagree.
          fetchBillJobFacets(),
        ]);
        setBills(pageData.rows);
        setTotal(pageData.total);
        setUploads(uploadList);
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
    [search, uploadFilter, from, to, jobKindValuesForGroup, page, pageSize]
  );

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per
    // keystroke; the first render loads immediately.
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  usePageMeta(
    {
      title: "Bills",
      crumbs: [{ label: "Documents" }, { label: "Bills" }],
      subtitle: `${total.toLocaleString()} ${total === 1 ? "bill" : "bills"}`,
      selfTitles: true,
    },
    [total]
  );

  const visibleIds = useMemo(() => bills.map((b) => b.id), [bills]);
  const selectedBills = useMemo(
    () => bills.filter((b) => selection.isSelected(b.id)),
    [bills, selection]
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function clearFilters() {
    setUploadFilter("");
    setFrom("");
    setTo("");
    setJobGroup(null);
    setPage(1);
  }

  /**
   * Delete ONE bill.
   *
   * This is a bill-level delete, not a workbook delete: siblings from the same
   * upload, their line items and their own documents are all left alone. The
   * confirmation says so explicitly, because the previous wording implied the
   * whole workbook was going and that was the single most misleading thing about
   * the old behaviour.
   */
  async function deleteOneBill(bill: Bill) {
    const ok = await confirm({
      title: "Delete this bill?",
      message: (
        <>
          Invoice{" "}
          <strong className="text-text">{bill.invoice_no || bill.sheet_name}</strong> and its
          three print copies (original, duplicate, triplicate) will be deleted, along with
          its line items and any folder links to it.{" "}
          <strong className="text-text">Other invoices from the same workbook are not
          affected.</strong> This cannot be undone.
        </>
      ),
      confirmLabel: "Delete this bill",
      tone: "danger",
    });
    if (!ok) return;

    setDeleting(bill.id);
    try {
      const res = await deleteBill(bill.id);
      if (!res.ok) {
        toast.error({
          title: "The bill was not deleted",
          description: res.error || "Please try again.",
        });
        return;
      }
      const gone = bill.invoice_no || bill.sheet_name;
      toast.success({
        title: "Bill deleted",
        description:
          (res.siblingsRemaining ?? 0) > 0
            ? `${gone} and its three PDFs are gone. ${res.siblingsRemaining} other invoice(s) from ${bill.original_filename} remain.`
            : `${gone} was the last invoice in ${bill.original_filename}, so the workbook was removed too.`,
      });
      selection.prune([bill.id]);
      await load(true);
    } finally {
      setDeleting(null);
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
    const names = selectedBills.map((b) => b.invoice_no || b.sheet_name);
    const ok = await confirm({
      title: ids.length === 1 ? "Delete this bill?" : `Delete ${ids.length} bills?`,
      message: (
        <>
          {ids.length === 1 ? (
            <>Invoice <strong className="text-text">{names[0]}</strong> and its three print
            copies will be deleted.</>
          ) : (
            <>
              These {ids.length} invoices and their print copies will be deleted:{" "}
              <strong className="text-text">{names.join(", ")}</strong>.
            </>
          )}{" "}
          <strong className="text-text">Any other invoice, including the rest of their
          workbooks, is not affected.</strong> This cannot be undone.
        </>
      ),
      confirmLabel: ids.length === 1 ? "Delete this bill" : `Delete ${ids.length} bills`,
      tone: "danger",
    });
    if (!ok) return;

    setDeleting(null);
    const failed: string[] = [];
    for (const bill of selectedBills) {
      const res = await deleteBill(bill.id);
      if (!res.ok) failed.push(`${bill.invoice_no || bill.sheet_name}: ${res.error ?? "failed"}`);
    }

    selection.prune(ids);
    if (failed.length === 0) {
      toast.success({
        title: ids.length === 1 ? "Bill deleted" : `${ids.length} bills deleted`,
        description: "The selected invoices and their print copies are gone.",
      });
    } else {
      toast.error({
        title: `${failed.length} of ${ids.length} could not be deleted`,
        description: failed.join(" · "),
      });
    }
    await load(true);
  }

  const openBulkFolderPicker = () => setPickerOpen(true);

  /* ── Render ───────────────────────────────────────────── */

  if (loading && !loadedOnce) {
    return (
      <div className="flex items-center justify-center py-32" role="status" aria-live="polite">
        <Loader2 size={32} className="text-primary animate-spin" />
        <span className="sr-only">Loading bills</span>
      </div>
    );
  }

  const filtered = !!search.trim() || hasFilters;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-primary-muted">
            <FileText size={20} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">
              {filtered ? "Matching bills" : "All bills"}
            </p>
            <p className="text-sm text-text-muted mt-0.5">
              {filtered ? (
                <>
                  <strong className="text-text">{total.toLocaleString()}</strong>{" "}
                  {total === 1 ? "bill matches" : "bills match"} this search
                </>
              ) : (
                <>
                  <strong className="text-text">{total.toLocaleString()}</strong>{" "}
                  {total === 1 ? "bill" : "bills"} from {uploads.length}{" "}
                  {uploads.length === 1 ? "workbook" : "workbooks"}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <IconButton
            label="Refresh the list"
            icon={<RefreshCw size={17} className={refreshing ? "animate-spin" : ""} />}
            onClick={() => load(true)}
            busy={refreshing}
            variant="surface"
          />
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer"
          >
            <UploadCloud size={17} />
            Upload workbook
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="space-y-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          scope="bills by invoice number, filename, sheet or GST number"
          unit="bill"
          resultCount={total}
          placeholder="Search invoices…"
          className="lg:max-w-2xl"
        />

        {/* Job-type grouping.
            One workbook legitimately contains both kinds, so this is a filter on
            the one `job_kind` column, not a second list: no rows are duplicated
            and a bill appears under exactly one chip. A workbook whose job type
            this build has not seen lands in "Other" rather than disappearing
            between two known buckets. */}
        {facets.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Group bills by job type"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
              <Receipt size={13} />
              Job type
            </span>
            <JobGroupChip
              active={jobGroup === null}
              onClick={() => {
                setJobGroup(null);
                setPage(1);
              }}
              label="All"
              count={facets.reduce((sum, f) => sum + f.count, 0)}
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
                  onClick={() => {
                    setJobGroup(jobGroup === group ? null : group);
                    setPage(1);
                  }}
                  label={group === "other" ? `Other (${names.join(", ")})` : names[0] ?? group}
                  count={count}
                />
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            <Filter size={13} />
            Filters
          </span>

          <label className="inline-flex items-center gap-1.5">
            <span className="sr-only">Workbook</span>
            <select
              value={uploadFilter}
              onChange={(e) => {
                setUploadFilter(e.target.value);
                setPage(1);
              }}
              className={selectCls}
            >
              <option value="">All workbooks</option>
              {uploads.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.original_filename} ({u.invoice_count})
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-1.5">
            <span className="text-xs text-text-muted">Invoice date</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              aria-label="Invoice date from"
              className={inputCls}
            />
            <span className="text-xs text-text-muted">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              aria-label="Invoice date to"
              className={inputCls}
            />
          </label>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-semibold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <X size={13} />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {loadError ? (
        <ErrorState
          title="Could not load the bills"
          message={loadError}
          onRetry={() => load()}
        />
      ) : (
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <InlineRefreshBar show={refreshing} />

          {bills.length === 0 ? (
            <EmptyState
              icon={filtered ? <SearchX size={24} /> : <FileSpreadsheet size={24} />}
              title={filtered ? "No bills match" : "No bills yet"}
              description={
                filtered
                  ? "Nothing matches the current search and filters."
                  : "Upload a tax-invoice workbook. Each worksheet becomes one bill, and the workbook produces an original, a duplicate and a triplicate PDF."
              }
              action={
                filtered ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      clearFilters();
                    }}
                    className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    Clear search and filters
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    Upload workbook
                  </button>
                )
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto scrollbar-thin table-scroll">
                <table className="w-full min-w-[62rem]">
                  <thead className="sticky-head">
                    <tr className="border-b border-border">
                      <th className="w-10 px-5 py-3">
                        <SelectAllCheckbox ids={visibleIds} selection={selection} />
                      </th>
                      <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Invoice no
                      </th>
                      <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Sheet
                      </th>
                      <th className="hidden lg:table-cell text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Workbook
                      </th>
                      <th className="text-right text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Qty
                      </th>
                      <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Invoice date
                      </th>
                      <th className="text-right text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Amount
                      </th>
                      <th className="hidden xl:table-cell text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Copies
                      </th>
                      <th className="sticky-actions sticky-head-cell text-right text-[11px] font-bold text-text-muted uppercase tracking-wider px-5 py-3 w-28">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bills.map((bill) => {
                      const isSelected = selection.isSelected(bill.id);
                      const rowBusy = deleting === bill.bill_upload_id;
                      /* Normalized once per row: "WITHMETAL" must never reach the
                         screen, and the value is absent entirely when the invoice
                         declared no job type. */
                      const jobKind = formatJobKind(bill.job_kind);
                      return (
                        <tr
                          key={bill.id}
                          aria-busy={rowBusy}
                          className={`hover:bg-surface-hover/50 transition-colors ${
                            isSelected ? "bg-primary-muted/40" : ""
                          } ${rowBusy ? "opacity-60" : ""}`}
                        >
                          <td className="px-5 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => selection.toggle(bill.id)}
                              aria-label={`Select bill ${bill.invoice_no ?? bill.sheet_name}`}
                              className="w-4 h-4 rounded accent-primary cursor-pointer"
                            />
                          </td>

                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => setDetailId(bill.id)}
                              className="text-sm font-bold text-text hover:text-primary hover:underline underline-offset-2 cursor-pointer text-left"
                            >
                              {bill.invoice_no || "No invoice number"}
                            </button>
                            {jobKind && (
                              <p className="mt-1">
                                <JobKindPill label={jobKind} />
                              </p>
                            )}
                            {bill.party_name && (
                              <p className="text-xs text-text-muted truncate max-w-[14rem]">
                                {bill.party_name}
                              </p>
                            )}
                          </td>

                          <td className="px-3 py-3 text-sm text-text-muted whitespace-nowrap">
                            {bill.sheet_name}
                          </td>

                          <td className="hidden lg:table-cell px-3 py-3">
                            <span className="inline-flex items-center gap-1.5 text-sm text-text-muted">
                              <FileSpreadsheet size={13} className="shrink-0" />
                              <span className="truncate max-w-[12rem] block">
                                {bill.original_filename}
                              </span>
                            </span>
                          </td>

                          <td className="px-3 py-3 text-sm text-text text-right tabular-nums whitespace-nowrap">
                            {formatQuantity(bill.total_quantity)}
                          </td>

                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 text-sm text-text-muted">
                              <CalendarDays size={13} />
                              {formatBillDate(bill.invoice_date)}
                            </span>
                          </td>

                          <td className="px-3 py-3 text-sm font-bold text-text text-right tabular-nums whitespace-nowrap">
                            {formatMoney(bill.amount_after_tax)}
                          </td>

                          <td className="hidden xl:table-cell px-3 py-3">
                            <BillCopyActions bill={bill} layout="compact" />
                          </td>

                          <td className="sticky-actions px-5 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <IconButton
                                label={`Open bill ${bill.invoice_no ?? bill.sheet_name}`}
                                size="sm"
                                tooltipPlacement="top-end"
                                icon={<FileText size={15} />}
                                onClick={() => setDetailId(bill.id)}
                              />
                              <IconButton
                                label={`Delete bill ${bill.invoice_no ?? bill.sheet_name}`}
                                size="sm"
                                tooltipPlacement="top-end"
                                variant="danger"
                                icon={<Trash2 size={15} />}
                                busy={rowBusy}
                                onClick={() => deleteOneBill(bill)}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={page}
                pageSize={pageSize}
                setPage={setPage}
                setPageSize={setPageSize}
                totalItems={total}
                totalPages={totalPages}
                itemLabel="bills"
              />
            </>
          )}
        </div>
      )}

      {/* Bulk actions */}
      <BulkActionBar
        count={selection.count}
        itemLabel={selection.count === 1 ? "bill" : "bills"}
        onClear={selection.clear}
      >
        <button
          type="button"
          onClick={openBulkFolderPicker}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-muted text-primary text-xs font-bold hover:bg-primary hover:text-[var(--theme-primary-text)] transition-colors cursor-pointer"
        >
          Add to folder
        </button>
        <button
          type="button"
          onClick={handleBulkDelete}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger-muted text-danger text-xs font-bold hover:bg-danger hover:text-white transition-colors cursor-pointer"
        >
          <Trash2 size={13} />
          {selection.count === 1 ? "Delete bill" : `Delete ${selection.count} bills`}
        </button>
      </BulkActionBar>

      {/* ── Dialogs ─────────────────────────────────────── */}

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload a bill workbook"
        subtitle="One .xlsx file. Every sheet becomes one bill."
        size="lg"
      >
        <BillUploadPanel
          onUploaded={() => {
            void load(true);
          }}
          onClose={() => setUploadOpen(false)}
        />
      </Modal>

      <BillDetailModal
        billId={detailId}
        onClose={() => setDetailId(null)}
        onOpenFolderPicker={() => {
          if (detailId) selection.replace([detailId]);
          setDetailId(null);
          setPickerOpen(true);
        }}
      />

      <BillFolderPickerModal
        open={pickerOpen}
        billIds={[...selection.selected]}
        title={`${selection.count} ${selection.count === 1 ? "bill" : "bills"}`}
        onClose={() => setPickerOpen(false)}
        onAdded={() => void load(true)}
      />

      {/* Copy legend — printed under the table so the three icons in the Copies
          column are not a puzzle. */}
      {bills.length > 0 && (
        <p className="text-xs text-text-muted px-1">
          The copies column shows one button per print copy —{" "}
          {BILL_COPIES.map((c) => BILL_COPY_LABEL[c]).join(", ")}. All three hold the same
          invoices and the same amounts; open a bill to view, download or print each one.
        </p>
      )}
    </div>
  );
}

/**
 * The job classification as a compact pill.
 *
 * A pill rather than plain text because it is a short, fixed-vocabulary label
 * that must not be mistaken for a free-text value like the party name sitting
 * next to it. Rendered from the already-normalized label, so this component never
 * has to know the raw spellings.
 */
function JobKindPill({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md bg-primary-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary"
      title="Job classification"
    >
      {label}
    </span>
  );
}

/**
 * One button in the job-type facet strip.
 *
 * A toggle rather than a radio: clicking the active chip returns to All, which is
 * the fastest way out of a filter that turns out to be wrong. The count is part
 * of the label so a user can see the split before choosing.
 */
function JobGroupChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
        active
          ? "border-primary bg-primary text-[var(--theme-primary-text)]"
          : "border-border bg-surface text-text-secondary hover:border-primary hover:text-primary"
      }`}
    >
      {label}
      <span className={active ? "opacity-80" : "text-text-muted"}>{count}</span>
    </button>
  );
}