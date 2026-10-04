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
  ImageOff,
  ImagePlus,
  Link2,
  Loader2,
  Pencil,
  Receipt,
  RefreshCw,
  SearchX,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import {
  deleteBillsInBulk,
  fetchBillIds,
  fetchBillLabels,
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
import { BILL_COPIES, BILL_COPY_LABEL, type Bill, type BillUpload, type BulkProgress } from "../types/bill";
import BillingFolderSheet from "../components/bills/BillingFolderSheet";
import BulkOperationOverlay, {
  type BulkOperation,
} from "../components/bills/BulkOperationOverlay";
import { usePageMeta } from "../contexts/PageMetaContext";
import { useSelection } from "../hooks/useSelection";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import Modal from "../components/ui/Modal";
import IconButton from "../components/ui/IconButton";
import Pagination from "../components/ui/Pagination";
import SelectAllCheckbox, { selectionStats } from "../components/ui/SelectAllCheckbox";
import BulkActionBar from "../components/ui/BulkActionBar";
import { ErrorState, InlineRefreshBar } from "../components/ui/LoadingState";
import { BillCopyActions } from "../components/bills/BillCopyActions";
import { BillDetailModal } from "../components/bills/BillDetailModal";
import BillEditModal from "../components/bills/BillEditModal";
import { BillUploadPanel } from "../components/bills/BillUploadPanel";
import { BillFolderPickerModal } from "../components/bills/BillFolderPickerModal";
import { applyLogoToBills, fetchLogosByIds } from "../services/invoiceLogos";
import { logoReprintFailureReason, type BillLogoRef } from "../types/invoiceLogo";
import LogoPickerModal from "../components/bills/LogoPickerModal";
import { LogoThumbnail } from "../components/bills/LogoThumbnail";
import LinkBillsToJobsModal from "../components/bills/LinkBillsToJobsModal";
import BillConnectionsPanel from "../components/bills/BillConnectionsPanel";
import {
  getBillConnectionCounts,
  getBillConnections,
  unlinkConnections,
} from "../services/billJobConnections";
import { jobCountLabel, type BillJobConnection } from "../types/billJobConnections";

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
  /** The bill open in the editor, or null. Separate from the read-only detail view. */
  const [editId, setEditId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkOperation | null>(null);
  const [billingFoldersOpen, setBillingFoldersOpen] = useState(false);
  const [folderPendingIds, setFolderPendingIds] = useState<string[] | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  /**
   * How many bills the current selection holds BECAUSE it is the whole matching set.
   *
   * `null` for a selection made by ticking rows, which may be any number and may span
   * pages by accident. The number is what lets the bar say "412 bills selected (every
   * bill matching these filters)" instead of a bare 412 that reads as "412 on this
   * page" — and the user is about to delete or file all of them.
   */
  const [allMatchingCount, setAllMatchingCount] = useState<number | null>(null);
  const allMatchingSelected = allMatchingCount !== null && allMatchingCount === selection.count;

  /** True while the bulk assign/remove is running, so the bar can lock. */
  const [logoBusy, setLogoBusy] = useState(false);
  /** The logo names behind the visible rows, by logo id. */
  const [logoNames, setLogoNames] = useState<Map<string, BillLogoRef>>(() => new Map());
  /** The bulk-assign picker. Opening it is the whole of "Assign Logo". */
  const [assignLogoOpen, setAssignLogoOpen] = useState(false);

  /* ── Bill ↔ Job connections ────────────────────────── */
  /** Link counts for the bills currently on screen, by bill id. */
  const [billLinkCounts, setBillLinkCounts] = useState<
    Map<string, { total: number; labour: number; withMaterial: number }>
  >(() => new Map());
  /** The bill whose linked jobs are open in the panel, or null for closed. */
  const [connectionsFor, setConnectionsFor] = useState<Bill | null>(null);
  /** That bill's linked jobs, split by type for the panel. */
  const [connectionsList, setConnectionsList] = useState<BillJobConnection[]>([]);
  const [connectionsBusy, setConnectionsBusy] = useState(false);
  /** The bill the "link jobs" picker is open for. Separate from `connectionsFor`
      so viewing a bill's links and adding to it are two independent actions. */
  const [linkJobsFor, setLinkJobsFor] = useState<Bill | null>(null);

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

  /* The logo column prints a NAME, and names live in `invoice_logos` — a different
     table. Asking per row would be one request per bill on the page, so the
     distinct ids are collected and asked about once. The key is the sorted set of
     ids rather than the array identity, so a refetch that returns the same bills
     does not re-request, and a page change to different bills does. */
  const visibleLogoKey = useMemo(
    () => [...new Set(bills.map((b) => b.logo_id).filter((v): v is string => !!v))].sort().join(","),
    [bills]
  );

  useEffect(() => {
    const wanted = visibleLogoKey ? visibleLogoKey.split(",") : [];
    if (wanted.length === 0) {
      setLogoNames(new Map());
      return;
    }
    let cancelled = false;
    fetchLogosByIds(wanted)
      .then((next) => {
        if (!cancelled) setLogoNames(next);
      })
      .catch(() => {
        /* A missing name degrades one column to "Logo assigned", which is still
           truthful. Failing the whole page over a caption would be a worse trade
           than a column that is slightly less specific. */
        if (!cancelled) setLogoNames(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [visibleLogoKey]);

  /* Link counts for the bills on screen. Read for the visible page only, for the
     same reason the logos are: a list of two thousand bills must not become two
     thousand count lookups. Failures degrade the column to "0" rather than taking the
     page down, because a missing connection count must not hide the invoices.

     A bill with no entry reads as "0" in the render — no entry and a zero are the
     same thing to this column, and there is nothing to distinguish them by. */
  const visibleBillKey = useMemo(() => bills.map((b) => b.id).join(","), [bills]);

  /* The one bill a "Link Jobs" bulk action could apply to.
     Null unless EXACTLY ONE bill is selected AND that bill is on the current page —
     the selection can also be an "all N matching" selection spanning pages, in which
     case there is no single bill for the picker to attach to and offering the button
     would be a lie about what it will do. */
  const singleSelectedBill = useMemo(() => {
    if (selection.count !== 1) return null;
    const id = [...selection.selected][0];
    return bills.find((b) => b.id === id) ?? null;
  }, [bills, selection.count, selection.selected]);

  useEffect(() => {
    const wanted = visibleBillKey ? visibleBillKey.split(",") : [];
    /* An empty list needs no request and no state write: the derived map below already
       reads as "no counts", so clearing it here would only be a second render. */
    if (wanted.length === 0) return;
    let cancelled = false;
    getBillConnectionCounts(wanted)
      .then((next) => {
        if (!cancelled) setBillLinkCounts(next);
      })
      .catch(() => {
        if (!cancelled) setBillLinkCounts(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [visibleBillKey]);

  /** Open the "this bill's linked jobs" panel. */
  async function openConnections(bill: Bill) {
    setConnectionsFor(bill);
    setConnectionsBusy(true);
    try {
      setConnectionsList(await getBillConnections(bill.id));
    } catch {
      setConnectionsList([]);
      toast.error({
        title: "Could not read linked jobs",
        description: "The bill's connections are unchanged. Please try again.",
      });
    } finally {
      setConnectionsBusy(false);
    }
  }

  /** Unlink one job from the open bill. Neither entity is touched. */
  async function unlinkOne(connection: BillJobConnection) {
    if (!connectionsFor) return;
    const ok = await confirm({
      title: "Unlink this job?",
      message: (
        <>
          <strong className="text-text">
            {connection.job_no || "This job"}
          </strong>{" "}
          will be unlinked from{" "}
          <strong className="text-text">
            {connectionsFor.invoice_no || connectionsFor.sheet_name}
          </strong>
          .
          <strong className="block mt-2 text-text">
            Only the connection is removed. The bill and the job both stay exactly as they
            are.
          </strong>
        </>
      ),
      confirmLabel: "Unlink",
      tone: "danger",
    });
    if (!ok) return;

    setConnectionsBusy(true);
    try {
      await unlinkConnections([connection.job_id], [connectionsFor.id]);
      setConnectionsList((prev) => prev.filter((l) => l.job_id !== connection.job_id));
      setBillLinkCounts((prev) => {
        const next = new Map(prev);
        const current = next.get(connectionsFor.id);
        if (current) {
          next.set(connectionsFor.id, {
            total: Math.max(0, current.total - 1),
            labour:
              connection.job_type === "labour"
                ? Math.max(0, current.labour - 1)
                : current.labour,
            withMaterial:
              connection.job_type === "with_material"
                ? Math.max(0, current.withMaterial - 1)
                : current.withMaterial,
          });
        }
        return next;
      });
      toast.success({ title: "Unlinked", description: "The connection was removed." });
    } catch (err) {
      toast.error({
        title: "Could not unlink",
        description: err instanceof Error ? err.message : "The connection is unchanged.",
      });
    } finally {
      setConnectionsBusy(false);
    }
  }

  /** After the link picker reports what it did. */
  async function handleBillLinked(result: { linked: number; alreadyLinked: number }) {
    toast.success({
      title: result.alreadyLinked > 0 ? `Linked ${result.linked} new job(s)` : "Jobs linked",
      description:
        result.alreadyLinked > 0
          ? `${result.alreadyLinked} were already linked and were left as they were.`
          : "Open the bill's Connections cell to review them.",
    });
    if (linkJobsFor) {
      const bill = linkJobsFor;
      setLinkJobsFor(null);
      void openConnections(bill);
    }
    const wanted = visibleBillKey ? visibleBillKey.split(",") : [];
    if (wanted.length > 0) {
      setBillLinkCounts(await getBillConnectionCounts(wanted));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /** True while any bulk operation owns the screen. */
  const busy = bulk !== null;

  /**
   * Select every bill matching the current filters, across every page.
   *
   * The list is paginated, so "select all" over one page of 20 is not what the
   * user means when there are 400 bills and they want them in one folder. The ids
   * are fetched on demand rather than held permanently, because carrying 1000+
   * uuids on every render to support a button most sessions never press is the
   * wrong trade.
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
      selection.replace(ids);
      /* Recorded so the bar can say WHICH bills, not just how many. "412 bills
         selected" reads as 412 on this page, and the user is about to delete or file
         all of them. Cleared by anything that changes the selection. */
      setAllMatchingCount(ids.length);
      toast.success({
        title: `${ids.length} ${ids.length === 1 ? "bill" : "bills"} selected`,
        description:
          "Every bill matching the current filters is now selected, on any page.",
      });
    } catch (err) {
      toast.error({
        title: "The bills could not be selected",
        description:
          err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSelectingAll(false);
    }
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
   * The selection is already the exact set of ids — including the "every bill
   * matching these filters" case, which `handleSelectAllMatching` resolved by id
   * before it set the count — so there is nothing to gather here and nothing to
   * guess. That is why this can say which bills it is about to change before it
   * does: the answer is known, not estimated.
   *
   * The work underneath is one statement for the assignment and a bounded batch of
   * re-prints, both server-side, so four hundred bills cost the admin the same
   * two seconds as four. Progress is reported as it happens rather than faked,
   * because a bar that fills on a timer is a lie told to someone about their own
   * tax documents.
   */
  async function runBulkLogo(logoId: string | null) {
    const ids = [...selection.selected];
    if (ids.length === 0) return;

    if (logoId === null) {
      /* Removing is a real change to a financial document, so it asks first. It
         is the same operation as assigning and needs the same re-prints; the only
         difference is that the admin cannot see the result in a preview, because
         the result is the absence of something. */
      const ok = await confirm({
        title: "Remove the logo from these bills?",
        message: (
          <>
            The logo will be removed from{" "}
            <strong className="text-text">
              {ids.length} {ids.length === 1 ? "bill" : "bills"}
            </strong>{" "}
            and all three print copies of each will be re-printed without it. The logo
            itself stays in the Logo Library, so it can be put back at any time.
          </>
        ),
        confirmLabel: "Remove logo",
      });
      if (!ok) return;
    }

    setLogoBusy(true);
    try {
      const result = await applyLogoToBills(ids, logoId);
      if (!result.ok) {
        toast.error({
          title: logoId ? "The logo could not be assigned" : "The logo could not be removed",
          description: result.error ?? "Please try again.",
        });
        return;
      }

      /* Only the bills that really went are unticked. A bill that failed to
         re-print is still assigned and still selected, so a retry finds it without
         the admin having to hunt for it again. */
      if (result.failures.length > 0) {
        selection.prune(ids.filter((id) => !result.failures.some((f) => f.bill_id === id)));
      } else {
        setAllMatchingCount(null);
        selection.clear();
      }

      void load(true);

      if (result.failures.length > 0) {
        toast.error({
          title: `Logo ${logoId ? "assigned" : "removed"} on ${result.assigned} ${
            result.assigned === 1 ? "bill" : "bills"
          }, ${result.failures.length} could not be re-printed`,
          description: result.failures
            .slice(0, 3)
            .map((f) => `${f.invoice_no ?? "A bill"} — ${logoReprintFailureReason(f.reason)}`)
            .join("; "),
        });
        return;
      }

      toast.success({
        title:
          logoId === null
            ? `Logo removed from ${result.assigned} ${result.assigned === 1 ? "bill" : "bills"}`
            : `Logo assigned to ${result.assigned} ${result.assigned === 1 ? "bill" : "bills"}`,
        description:
          result.unchanged > 0
            ? `${result.unchanged} already had it and were left alone.`
            : "All three print copies were re-printed.",
      });
    } catch (err) {
      toast.error({
        title: logoId ? "The logo could not be assigned" : "The logo could not be removed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setLogoBusy(false);
    }
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
      /* Deleting one of them means the "every matching bill" set no longer describes
         the selection, whatever is left of it. */
      setAllMatchingCount(null);
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
    /* busy as well as an empty selection: a second click must not start a second
       deletion while the first is still working through the list. */
    if (selection.count === 0 || busy) return;

    /* The whole SELECTION, not just this page's rows.
     *
     * `selected` spans pages by design — "Select all N matching" holds every matching
     * id while `bills` holds one page. Deleting `selectedBills` would offer to destroy
     * 20 while the bar says 412 are ticked. */
    const ids = [...selection.selected];
    const onThisPage = new Map(bills.map((b) => [b.id, b.invoice_no || b.sheet_name]));
    const missing = ids.filter((id) => !onThisPage.has(id));
    const labels = new Map(onThisPage);
    if (missing.length > 0) {
      try {
        for (const row of await fetchBillLabels(missing)) labels.set(row.id, row.label);
      } catch {
        /* Fall through: the delete proceeds and reports ids for anything unnamed. A
           missing label is cosmetic; a missing delete would not be. */
      }
    }

    const ok = await confirm({
      title: ids.length === 1 ? "Delete this bill?" : `Delete ${ids.length} bills?`,
      message: (
        <>
          {ids.length === 1 ? (
            <>
              Invoice{" "}
              <strong className="text-text">{labels.get(ids[0]) ?? "selected"}</strong> and its
              three print copies will be deleted.
            </>
          ) : (
            <>
              These {ids.length} invoices and their print copies will be deleted:{" "}
              {/* Three names is enough to recognise the pattern. Listing 412 is
                  unreadable, but listing none makes a mis-selection indistinguishable
                  from the intended one. */}
              <strong className="text-text">
                {[...labels.values()].slice(0, 3).join(", ")}
                {labels.size > 3 ? ` and ${labels.size - 3} more` : ""}
              </strong>
              .
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

    /* Snapshot the ids and their labels. `selection` is derived state and the page
       reloads underneath the operation — reading it again per bill would silently
       shrink the job as rows disappear. */
    const targets = ids.map((id) => ({ id, label: labels.get(id) ?? id.slice(0, 8) }));

    setBulk({
      title: "Deleting bills",
      subtitle: `${targets.length} ${targets.length === 1 ? "bill" : "bills"} selected`,
      progressLabel: "Deleting",
      progress: { done: 0, total: targets.length },
    });

    try {
      /* Progress is real: deleteBill is a multi-statement cascade and these run
         one at a time, so done counts invoices genuinely finished. Nothing here
         is a timer, which is why the bar can read 18 / 37 and be right. */
      const result = await deleteBillsInBulk(targets, (progress: BulkProgress) =>
        setBulk((prev) => (prev ? { ...prev, progress } : prev))
      );

      /* Only bills that really went are dropped from the selection, so anything
         that failed stays ticked and can be retried without being hunted for
         again. The failures carry ids precisely so this can be exact. */
      const failedIds = new Set(result.failures.map((f) => f.id));
      selection.prune(ids.filter((id) => !failedIds.has(id)));
      /* Whatever survived the delete is, by definition, no longer the whole matching
         set, so the "every matching bill" claim has to stop being made. */
      setAllMatchingCount(null);

      if (result.failed === 0) {
        toast.success({
          title: ids.length === 1 ? "Bill deleted" : `${ids.length} bills deleted`,
          description: "The selected invoices and their print copies are gone.",
        });
      } else {
        /* Named, not summarised. "2 of 37 failed" without saying which 2 leaves
           the user unable to tell what is still on their books. */
        toast.error({
          title: `${result.deleted} of ${ids.length} deleted, ${result.failed} failed`,
          description: result.failures.map((f) => `${f.label}: ${f.error}`).join(" · "),
        });
      }
    } catch (err) {
      /* The service loop reports per-bill failures itself and returns rather than
         throwing, so reaching here means something unexpected. Either way the
         list is reloaded below, so the screen shows the database's real state. */
      toast.error({
        title: "The deletion did not finish",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBulk(null);
      setFolderPendingIds(null);
      await load(true);
    }
  }

  /*
   * The Billing section's own folders, armed with the selected bills.
   *
   * This is where the list's "Add to folder" goes rather than the generic
   * picker: filing 50 invoices should land in a Billing folder, not in a Labour
   * job folder that happens to exist.
   */
  function openBillingFolders() {
    if (busy) return;
    setDetailId(null);
    setFolderPendingIds([...selection.selected]);
    setBillingFoldersOpen(true);
  }

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

          {/* Select-all across EVERY page, offered only when there is more than this
              page to take.
              The header checkbox inside the table takes this page's 20; this takes all
              of them. Both mean different things, and with 400 bills only this one gets
              them all into a folder in a single operation — which is the reason the
              Billing section exists. Inert while a bulk operation runs. */}
          {bills.length > 0 &&
            !selectionStats(visibleIds, selection.selected).all &&
            total > visibleIds.length && (
              <div className="flex items-center gap-3 border-b border-border px-5 py-2">
                <button
                  type="button"
                  onClick={() => void handleSelectAllMatching()}
                  disabled={busy || selectingAll}
                  className="text-[11px] font-bold text-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline cursor-pointer"
                >
                  {selectingAll ? "Finding all bills…" : `Select all ${total} matching bills`}
                </button>
                <span className="text-[11px] text-text-muted">
                  across every page, not just this one
                </span>
              </div>
            )}

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
                      <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Logo
                      </th>
                      <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-3 py-3">
                        Connections
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
                              onChange={() => {
                                /* Unticking one bill out of an across-everything
                                   selection breaks it, so the record of it goes too.
                                   Left in place it would go on reporting "all 412
                                   matching" for a selection that is now 411 and
                                   deliberately so. */
                                setAllMatchingCount(null);
                                selection.toggle(bill.id);
                              }}
                              /* Locked while a bulk operation owns the screen: the
                                 overlay swallows the click, and refusing here too means
                                 a fast click cannot slip through a gap in the event
                                 handling and change the selection mid-delete. */
                              disabled={busy}
                              aria-label={`Select bill ${bill.invoice_no ?? bill.sheet_name}`}
                              className="w-4 h-4 rounded accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
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

                          {/* The logo column answers "will this print with a
                              letterhead?" at a glance, which is the question an
                              admin has when they are checking a list before
                              sending invoices out. It deliberately says "No Logo
                              Assigned" rather than showing a dash: the absence is
                              the state most bills are in, and a dash would read as
                              "not applicable" rather than "chosen, deliberately
                              none". */}
                          <td className="px-3 py-3">
                            {bill.logo_id ? (
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <LogoThumbnail
                                  logoId={bill.logo_id}
                                  size={26}
                                  className="border border-border"
                                />
                                <span className="text-sm text-text truncate max-w-[9rem] block">
                                  {logoNames.get(bill.logo_id)?.name ?? "Logo assigned"}
                                </span>
                              </span>
                            ) : (
                              <span className="text-sm text-text-muted/70">No Logo Assigned</span>
                            )}
                            {bill.logo_rendered_logo_id !== bill.logo_id && (
                              <p className="text-[11px] text-warning mt-0.5">
                                Re-printing PDF…
                              </p>
                            )}
                          </td>

                          {/* Bill ↔ Job connections. A count in words, split by job
                              type, because the bill side presents labour and
                              with-material as two separate lists. Clicking opens the
                              same panel the "Link Jobs" action does. */}
                          <td className="px-3 py-3">
                            {billLinkCounts.get(bill.id) ? (
                              <button
                                type="button"
                                onClick={() => setLinkJobsFor(bill)}
                                aria-label={`${jobCountLabel(
                                  billLinkCounts.get(bill.id)?.total ?? 0
                                )} linked. Manage connections`}
                                title="Manage linked jobs"
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-hover text-xs font-bold text-text-muted hover:text-connection transition-colors cursor-pointer"
                              >
                                <Link2 size={12} className="text-connection" aria-hidden="true" />
                                {jobCountLabel(billLinkCounts.get(bill.id)?.total ?? 0)}
                              </button>
                            ) : (
                              <span className="text-sm text-text-muted/70">
                                {jobCountLabel(0)}
                              </span>
                            )}
                            {billLinkCounts.get(bill.id) ? (
                              <p className="text-[11px] text-text-muted mt-0.5 whitespace-nowrap">
                                {billLinkCounts.get(bill.id)?.labour ?? 0} labour ·{" "}
                                {billLinkCounts.get(bill.id)?.withMaterial ?? 0} with material
                              </p>
                            ) : null}
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
                                label={`Link jobs to bill ${bill.invoice_no ?? bill.sheet_name}`}
                                size="sm"
                                tooltipPlacement="top-end"
                                icon={<Link2 size={15} />}
                                onClick={() => setLinkJobsFor(bill)}
                              />
                              <IconButton
                                label={`Edit bill ${bill.invoice_no ?? bill.sheet_name}`}
                                size="sm"
                                tooltipPlacement="top-end"
                                icon={<Pencil size={15} />}
                                onClick={() => setEditId(bill.id)}
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

      {/* Bulk actions. `context` says WHICH bills, not just how many — a bare "412
          bills selected" reads as 412 on this page, and the next click files or
          deletes all of them. */}
      <BulkActionBar
        count={selection.count}
        itemLabel={selection.count === 1 ? "bill" : "bills"}
        context={allMatchingSelected ? "every bill matching these filters" : undefined}
        onClear={() => {
          setAllMatchingCount(null);
          selection.clear();
        }}
      >
        <button
          type="button"
          onClick={openBillingFolders}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-muted text-primary text-xs font-bold hover:bg-primary hover:text-[var(--theme-primary-text)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add to folder
          {/* Files into a BILLING folder, not a job folder — see
              openBillingFolders for why these are two separate doors. */}
        </button>
        <button
          type="button"
          onClick={() => setAssignLogoOpen(true)}
          disabled={busy || logoBusy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-muted text-primary text-xs font-bold hover:bg-primary hover:text-[var(--theme-primary-text)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ImagePlus size={13} />
          Assign Logo
        </button>
        {/* Connections are per-BILL, so a multi-bill selection cannot offer a single
            "link jobs" action that would mean anything. Rather than guess which bill
            was meant, this is only offered when exactly one bill is selected, and the
            label says so. */}
        <button
          type="button"
          onClick={() => {
            if (singleSelectedBill) setLinkJobsFor(singleSelectedBill);
          }}
          disabled={busy || !singleSelectedBill}
          title={
            singleSelectedBill
              ? "Link jobs to the selected bill"
              : "Select exactly one bill on this page to link jobs to it"
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-connection-muted text-connection text-xs font-bold hover:bg-connection hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Link2 size={13} />
          Link Jobs
        </button>
        <button
          type="button"
          onClick={() => void runBulkLogo(null)}
          disabled={busy || logoBusy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover text-text-muted text-xs font-bold hover:bg-surface-hover hover:text-text transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ImageOff size={13} />
          Remove Logo
        </button>
        <button
          type="button"
          onClick={handleBulkDelete}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger-muted text-danger text-xs font-bold hover:bg-danger hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 size={13} />
          {selection.count === 1 ? "Delete bill" : `Delete ${selection.count} bills`}
        </button>
      </BulkActionBar>

      {/* Bulk assign. The SAME picker the bill editor and the Logo Library use, so
          there is one list of logos and one set of accepted formats in the whole
          app. "No logo" is deliberately absent here: this is the Assign action, and
          removal has its own button above — offering both from one list would mean
          an admin could remove 400 letterheads by clicking what reads as an assign
          control. */}
      <LogoPickerModal
        open={assignLogoOpen}
        onClose={() => setAssignLogoOpen(false)}
        onSelect={(logoId) => {
          if (logoId !== null) void runBulkLogo(logoId);
        }}
        allowNone={false}
        title={`Assign a logo to ${selection.count} ${
          selection.count === 1 ? "bill" : "bills"
        }`}
        subtitle="All three print copies of each bill are re-printed with the logo."
      />

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

      <BillConnectionsPanel
        open={!!connectionsFor}
        billLabel={
          connectionsFor
            ? (connectionsFor.invoice_no?.trim() ||
                connectionsFor.sheet_name?.trim() ||
                "this bill")
            : ""
        }
        connections={connectionsList}
        loading={connectionsBusy}
        onClose={() => setConnectionsFor(null)}
        onUnlink={(connection) => void unlinkOne(connection)}
        onAddJobs={() => {
          if (connectionsFor) setLinkJobsFor(connectionsFor);
        }}
      />

      <LinkBillsToJobsModal
        open={!!linkJobsFor}
        billId={linkJobsFor?.id ?? ""}
        billLabel={
          linkJobsFor
            ? (linkJobsFor.invoice_no?.trim() || linkJobsFor.sheet_name?.trim() || "this bill")
            : ""
        }
        onClose={() => setLinkJobsFor(null)}
        onLinked={(result) => void handleBillLinked(result)}
      />

      <BillDetailModal
        billId={detailId}
        onClose={() => setDetailId(null)}
        onOpenFolderPicker={() => {
          if (detailId) selection.replace([detailId]);
          setDetailId(null);
          setPickerOpen(true);
        }}
        onEdit={(bill) => {
          // Close the read-only view first: the editor reloads the same row, and
          // two modals stacked on one bill is a confusing thing to leave open.
          setDetailId(null);
          setEditId(bill.id);
        }}
      />

      {/* Editing re-prints this bill's three documents from the saved values, so the
          list is reloaded afterwards: the amounts, the copy column and the
          download links all have to show the new version, and a PDF path that
          changed under the row would otherwise be served from a stale link. */}
      {editId && (
        <BillEditModal
          billId={editId}
          onClose={() => setEditId(null)}
          onSaved={() => {
            void load(true);
          }}
        />
      )}

      {/* The Billing section's own folder workspace. 
          folderPendingIds is the armed selection; it is cleared when the sheet
          closes so a stale set of ids cannot be filed by the next visit. */}
      <BillingFolderSheet
        open={billingFoldersOpen}
        pendingBillIds={folderPendingIds}
        onClose={() => {
          setBillingFoldersOpen(false);
          setFolderPendingIds(null);
        }}
        onChanged={() => void load(true)}
        onOpenBill={(billId) => setDetailId(billId)}
        onError={(title, message) => toast.error({ title, description: message })}
        onNotice={(title, message) => toast.success({ title, description: message })}
      />

      {/* The loading state for the whole page. Rendered last so it paints over
          everything else, and it swallows pointer events — which is what makes a
          second Delete impossible while the first is running. */}
      <BulkOperationOverlay operation={bulk} />

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