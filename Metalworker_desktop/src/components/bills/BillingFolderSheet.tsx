// src/components/bills/BillingFolderSheet.tsx
//
// The Billing section's own folder workspace in the desktop app.
//
// THE MIRROR, NOT A SECOND IMPLEMENTATION
// This is the same workspace as the admin app's `BillingFolderSheet`, against the same
// `services/billingFolders.ts` rules and the same `get_folder_bill_summary` RPC. Two
// clients rendering the same folder from two different code paths is how a financial
// figure starts disagreeing between them, so the rules live in the service layer and
// the database, and both screens only ever format what those return.
//
// WHY BILLING FOLDERS ARE SEPARATE FROM JOB FOLDERS
// Bills are filed in their OWN folders. Dropping bill links into the `admin_folders`
// rows that the Jobs and Folders screens list would put a "September Analysis" folder
// among Labour jobs and have the worker app's job counts quietly include invoices. So
// these folders carry `folder_type = 'billing'`, which is what keeps them out of those
// screens — see `services/billingFolders.ts`.
//
// WHAT A FOLDER SHOWS
// Filing bills is not the point; comparing several imports at once is. So an opened
// folder leads with totals, then per-bill averages, then the spread, then the job-kind
// split. Every figure comes from the summary RPC — this component formats and never
// adds up, which is what keeps the two clients from disagreeing about one folder.
//
// ONE INVOICE IS ONE BILL
// The three print copies (original / duplicate / triplicate) are three PDFs on ONE bill
// row. They are not folder items and are never counted, listed or totalled separately.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FolderPlus, Loader2, Trash2 } from "lucide-react";

import {
  addBillsToBillingFolder,
  createBillingFolder,
  deleteBillingFolder,
  emptyBillingFolder,
  fetchBillingFolders,
  moveBillsBetweenBillingFolders,
  removeBillsFromBillingFolder,
  renameBillingFolder,
  type BillingFolder,
} from "../../services/billingFolders";
import {
  fetchBills,
  fetchFolderBillSummary,
  formatBillDate,
  formatJobKind,
  formatMoney,
  formatQuantity,
} from "../../services/bills";
import type { Bill, BulkProgress, FolderBillSummary } from "../../types/bill";
import { useSelection } from "../../hooks/useSelection";
import Modal from "../ui/Modal";
import Pagination from "../ui/Pagination";
import SelectAllCheckbox from "../ui/SelectAllCheckbox";
import BulkOperationOverlay, { type BulkOperation } from "./BulkOperationOverlay";

/** Bills per page inside an opened folder. Matches the Bills list's own page size. */
const PAGE_SIZE = 20;

interface BillingFolderSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * Bills to file when the sheet is opened from a selection on the Bills list.
   *
   * Carried as ids rather than as a count, because the operation has to name what it is
   * about to touch: "File 50 bills" with no record of which 50 is not a confirmation
   * anyone can check. `null` when the sheet was opened just to browse.
   */
  pendingBillIds?: string[] | null;
  onChanged: () => void;
  onOpenBill?: (billId: string) => void;
  onError: (title: string, message: string) => void;
  onNotice: (title: string, message: string) => void;
}

export default function BillingFolderSheet({
  open,
  onClose,
  pendingBillIds = null,
  onChanged,
  onOpenBill,
  onError,
  onNotice,
}: BillingFolderSheetProps) {
  const [folders, setFolders] = useState<BillingFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  /**
   * Has a read ever completed?
   *
   * Separate from `foldersLoading` because the two answer different questions:
   * `foldersLoading` is "a read the user asked for is running", `foldersLoaded` is
   * "there is a real answer on screen yet". The difference is what stops an empty
   * folder list from flashing "No billing folders yet" on every open.
   */
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkOperation | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  /** The folder list, and nothing else. No state is touched here. */
  const readFolders = useCallback(() => fetchBillingFolders(), []);

  /** Commit a read, or record why it failed. Always clears the spinner. */
  const commitFolders = useCallback((list: BillingFolder[]) => {
    setFolders(list);
    setFoldersError(null);
    setFoldersLoaded(true);
    setFoldersLoading(false);
  }, []);

  /**
   * Read the folder list whenever the sheet becomes visible.
   *
   * `readFolders` holds no `setState`, so the only writes happen inside the promise
   * callbacks below. That is what makes calling this from an effect safe rather than a
   * synchronous render cascade — and why this must be `readFolders`, not `loadFolders`.
   */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    readFolders().then(
      (list) => {
        if (cancelled) return;
        commitFolders(list);
      },
      (err: unknown) => {
        if (cancelled) return;
        /* Not fatal: the workspace still opens and the user can retry. An unreadable
           folder list must never be indistinguishable from an empty one. */
        setFoldersError(
          err instanceof Error ? err.message : "Billing folders could not be loaded."
        );
        setFoldersLoaded(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [open, readFolders, commitFolders]);

  /**
   * Re-read, showing the spinner.
   *
   * The click-driven counterpart, used after a create, a rename, a delete and by
   * "Try again". Never the effect's entry point.
   */
  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    setFoldersError(null);
    try {
      commitFolders(await readFolders());
    } catch (err) {
      setFoldersError(err instanceof Error ? err.message : "Billing folders could not be loaded.");
      setFoldersLoading(false);
    }
  }, [readFolders, commitFolders]);

  /** Close the sheet, leaving nothing behind for the next visit. */
  function handleClose() {
    setOpenId(null);
    setNewName("");
    setRenamingId(null);
    setRenameText("");
    setBulk(null);
    onClose();
  }

  /** Step back from an opened folder to the list. */
  function closeFolder() {
    setOpenId(null);
    setRenamingId(null);
    setRenameText("");
  }

  const openFolder = folders.find((f) => f.id === openId) ?? null;
  const pendingCount = pendingBillIds?.length ?? 0;

  async function handleCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await createBillingFolder(name);
      if (!res.ok) {
        onError("The folder was not created", res.error ?? "Please try again.");
        return;
      }
      setNewName("");
      onNotice("Billing folder created", `${name} is ready for bills.`);
      await loadFolders();
      onChanged();
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(folder: BillingFolder) {
    const name = renameText.trim();
    if (!name) return;
    const res = await renameBillingFolder(folder.id, name);
    if (!res.ok) {
      onError("The folder was not renamed", res.error ?? "Please try again.");
      return;
    }
    setRenamingId(null);
    setRenameText("");
    await loadFolders();
    onChanged();
  }

  async function handleDelete(folder: BillingFolder) {
    /* Spelled out at the point of action, not after: the whole point of billing
       folders is that unfiling and deleting are different things, so the distinction
       is stated before the click rather than discovered afterwards. */
    const detached = folder.billCount ?? 0;
    const ok = window.confirm(
      `Delete the billing folder "${folder.name}"?\n\n` +
        (detached === 0
          ? "The folder is empty."
          : `${detached} ${detached === 1 ? "bill is" : "bills are"} filed in it. `) +
        "\n\nThe BILLS ARE NOT DELETED. They stay in All Bills with their print copies; " +
        "only the filing is undone."
    );
    if (!ok) return;

    setBulk({ title: "Deleting billing folder", subtitle: folder.name });
    try {
      const res = await deleteBillingFolder(folder.id);
      if (!res.ok) {
        onError("The folder was not deleted", res.error ?? "Please try again.");
        await loadFolders();
        return;
      }
      setOpenId((id) => (id === folder.id ? null : id));
      onNotice(
        "Billing folder deleted",
        (res.bills_detached ?? 0) === 0
          ? "The folder was empty. No bills were affected."
          : `${res.bills_detached} ${
              (res.bills_detached ?? 0) === 1 ? "bill is" : "bills are"
            } still in All Bills — deleting a folder never deletes a bill.`
      );
      await loadFolders();
      onChanged();
    } finally {
      setBulk(null);
    }
  }

  async function handleEmpty(folder: BillingFolder) {
    const count = folder.billCount ?? 0;
    const ok = window.confirm(
      `Empty "${folder.name}"?\n\n` +
        `All ${count} ${count === 1 ? "bill" : "bills"} will be removed from the folder. ` +
        "The BILLS ARE NOT DELETED — they stay in All Bills with their print copies.\n\n" +
        "The folder itself is kept, so you can start filing into it again."
    );
    if (!ok) return;

    setBulk({ title: "Emptying billing folder", subtitle: folder.name });
    try {
      const res = await emptyBillingFolder(folder.id);
      if (!res.ok) {
        onError("The folder was not emptied", res.error ?? "Please try again.");
        return;
      }
      const removed = res.bills_removed ?? 0;
      onNotice(
        "Folder emptied",
        `Removed ${removed} ${removed === 1 ? "bill" : "bills"} from the folder. The bills themselves are untouched.`
      );
      setOpenId(null);
      await loadFolders();
      onChanged();
    } finally {
      setBulk(null);
    }
  }

  /** File the bills that arrived with the sheet. Progress is real: chunked inserts. */
  async function handleFilePending(folder: BillingFolder) {
    if (!pendingBillIds?.length) return;
    const total = pendingBillIds.length;
    setBulk({
      title: "Filing bills",
      subtitle: `${total} ${total === 1 ? "bill" : "bills"} → ${folder.name}`,
      progressLabel: "Filing",
      progress: { done: 0, total },
    });
    try {
      const res = await addBillsToBillingFolder(folder.id, pendingBillIds, (progress: BulkProgress) =>
        setBulk((prev) => (prev ? { ...prev, progress } : prev))
      );
      if (!res.ok) {
        onError("Filing did not finish", res.error ?? "Please try again.");
        await loadFolders();
        onChanged();
        return;
      }
      /* "already in there" is reported rather than hidden: the user asked to file N
         bills and needs to know why the number came out smaller. */
      const parts = [`Filed ${res.changed} in ${folder.name}.`];
      if (res.skipped > 0) {
        parts.push(
          `${res.skipped} ${res.skipped === 1 ? "was" : "were"} already in the folder.`
        );
      }
      onNotice("Bills filed", parts.join(" "));
      await loadFolders();
      onChanged();
    } finally {
      setBulk(null);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={openFolder ? openFolder.name : "Billing Folders"}
        subtitle={
          openFolder
            ? "Totals, averages and the job-kind split across the bills filed here."
            : "Bill folders, kept separate from job folders. A bill can be filed here and still appear in All Bills."
        }
        size="xl"
      >
        {openFolder ? (
          <div className="flex flex-col gap-3">
            {/* Stepping back to the list keeps the sheet open, which is different from
                closing it: the folder's rename box and the list's scroll position are
                still there, and the user is browsing rather than navigating away. */}
            <button
              type="button"
              onClick={closeFolder}
              className="self-start text-xs font-bold text-primary hover:underline cursor-pointer"
            >
              ← All billing folders
            </button>
            <BillingFolderDetail
              folder={openFolder}
              onChanged={async () => {
                await loadFolders();
                onChanged();
              }}
              onOpenBill={onOpenBill}
              onError={onError}
              onNotice={onNotice}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pendingCount > 0 && (
              <div className="rounded-lg border border-primary/40 bg-primary-muted px-3 py-2.5">
                <p className="text-xs font-bold text-text">
                  {pendingCount} {pendingCount === 1 ? "bill" : "bills"} ready to file
                </p>
                <p className="mt-0.5 text-[11px] text-text-secondary">
                  Pick a folder below. Or create one if it does not exist yet.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                placeholder="New billing folder name"
                aria-label="New billing folder name"
                className="flex-1 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating || newName.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-[var(--theme-primary-text)] transition-colors hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <FolderPlus size={14} />
                {creating ? "Creating…" : "Create"}
              </button>
            </div>

            {/* A spinner while a read is running AND the first read has not answered
                yet, or while a user-initiated reload is in flight. Showing a spinner
                over an already-known-good list would be a flash of the wrong thing. */}
            {foldersLoading && folders.length === 0 && (
              <div className="flex items-center justify-center py-10" role="status">
                <Loader2 size={24} className="text-primary animate-spin" />
                <span className="sr-only">Loading billing folders</span>
              </div>
            )}

            {!foldersLoading && foldersError && (
              <div className="rounded-lg border border-danger/50 bg-surface px-4 py-4 flex flex-col items-start gap-2">
                <p className="text-xs text-danger">{foldersError}</p>
                <button
                  type="button"
                  onClick={() => void loadFolders()}
                  className="text-xs font-bold text-primary hover:underline cursor-pointer"
                >
                  Try again
                </button>
              </div>
            )}

            {/* The empty state waits for a real answer. Without `foldersLoaded` this
                would flash "No billing folders yet" every time the sheet opened. */}
            {foldersLoaded && !foldersLoading && !foldersError && folders.length === 0 && (
              <div className="rounded-lg border border-border bg-surface px-6 py-10 text-center">
                <p className="text-sm font-semibold text-text">No billing folders yet</p>
                <p className="mt-1 text-xs text-text-muted">
                  Upload some bills, select them on the Bills list, then use “Add to
                  folder”. File a group of invoices here to compare their totals and
                  averages.
                </p>
              </div>
            )}

            {folders.map((folder) => (
              <div
                key={folder.id}
                className="rounded-lg border border-border bg-surface px-4 py-3 flex flex-col gap-2"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(folder.id)}
                  className="text-left hover:opacity-80 transition-opacity cursor-pointer"
                >
                  <span className="block text-sm font-semibold text-text">{folder.name}</span>
                  <span className="block text-[11px] text-text-muted">
                    {folder.billCount ?? 0} {folder.billCount === 1 ? "bill" : "bills"}
                  </span>
                </button>

                {renamingId === folder.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      aria-label={`New name for ${folder.name}`}
                      className="flex-1 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRename(folder)}
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-[var(--theme-primary-text)] hover:bg-primary-hover cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="text-xs font-semibold text-text-secondary hover:underline cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(folder.id);
                        setRenameText(folder.name);
                      }}
                      className="text-xs font-semibold text-text-secondary hover:underline cursor-pointer"
                    >
                      Rename
                    </button>
                    {/* Empty and Delete are separate controls, because they are
                        separate outcomes: one unfiles the bills, the other also removes
                        the folder. Offering only Delete would make the destructive one
                        the easy one to reach by accident. */}
                    <button
                      type="button"
                      onClick={() => void handleEmpty(folder)}
                      disabled={(folder.billCount ?? 0) === 0}
                      className="text-xs font-semibold text-text-secondary hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline cursor-pointer"
                    >
                      Empty
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(folder)}
                      className="text-xs font-bold text-danger hover:underline cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                )}

                {pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void handleFilePending(folder)}
                    className="self-start rounded-lg border border-primary px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary-muted transition-colors cursor-pointer"
                  >
                    File {pendingCount} here
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <BulkOperationOverlay operation={bulk} />
    </>
  );
}

/* ──────────────────────────────────────────────
   THE OPENED FOLDER
   ────────────────────────────────────────────── */

interface BillingFolderDetailProps {
  folder: BillingFolder;
  onChanged: () => Promise<void>;
  onOpenBill?: (billId: string) => void;
  onError: (title: string, message: string) => void;
  onNotice: (title: string, message: string) => void;
}

function BillingFolderDetail({
  folder,
  onChanged,
  onOpenBill,
  onError,
  onNotice,
}: BillingFolderDetailProps) {
  const selection = useSelection();
  const [summary, setSummary] = useState<FolderBillSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billTotal, setBillTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkOperation | null>(null);
  const [destinations, setDestinations] = useState<BillingFolder[]>([]);

  /**
   * The two reads, and nothing else. No state is touched here.
   *
   * Keeping this free of `setState` is what lets it be called from an effect: a
   * function that writes state, invoked in an effect body, renders a second time
   * before anything has been fetched. Splitting the read from the write means the
   * effect only writes inside a promise callback, which is a real response.
   *
   * Started together and neither blocks the other — the folder's money and its
   * contents are independent, so waiting for the slower one would blank the panel for
   * no reason.
   */
  const readFolder = useCallback(async () => {
    const [summaryResult, billPage] = await Promise.all([
      fetchFolderBillSummary(folder.id),
      fetchBills({ folderId: folder.id, page, pageSize: PAGE_SIZE }),
    ]);
    return { summaryResult, billPage };
  }, [folder.id, page]);

  /** Commit a read. Always takes the spinner down, so a failure cannot hang it. */
  const commit = useCallback(
    (result: { summaryResult: FolderBillSummary; billPage: { rows: Bill[]; total: number } }) => {
      setSummary(result.summaryResult);
      setBills(result.billPage.rows);
      setBillTotal(result.billPage.total);
      setSummaryError(null);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    readFolder().then(
      (result) => {
        /* A response that arrives after the user has moved on is dropped: writing it
           would put page 1's bills back under a header that says page 2. */
        if (cancelled) return;
        commit(result);
      },
      (err: unknown) => {
        if (cancelled) return;
        setSummaryError(err instanceof Error ? err.message : "This folder could not be read.");
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [readFolder, commit]);

  /**
   * Re-read after something the user just did, showing the spinner while it happens.
   *
   * The click-driven counterpart. Raising `loading` here responds to an action rather
   * than cascading a render. Clearing the error first matters: a stale message would
   * sit under the spinner and come back describing the PREVIOUS failure.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    setSummaryError(null);
    try {
      commit(await readFolder());
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "This folder could not be read.");
      setLoading(false);
    }
  }, [readFolder, commit]);

  /*
   * The selection is NOT pruned against the loaded page.
   *
   * An earlier version called `selection.prune` on every page load. That is wrong
   * twice over: it cannot tell "this bill was removed from the folder" from "this
   * bill is on page 2", so a selection made on page 1 was discarded the moment page 2
   * loaded; and the folder's bills are paged, exactly like the Bills list, so a
   * selection is expected to span pages.
   *
   * The selection is cleared only by the actions that could invalidate it, and each
   * of those clears it in full once the database has confirmed the change:
   * `handleRemoveSelected`, `handleMove` and `handleEmpty` all call `selection.clear()`.
   * So the count on the bar is always the number the next action will apply to.
   */

  useEffect(() => {
    void fetchBillingFolders()
      .then((all) => setDestinations(all.filter((f) => f.id !== folder.id)))
      .catch(() => setDestinations([]));
  }, [folder.id]);

  const totalPages = Math.max(1, Math.ceil(billTotal / PAGE_SIZE));
  const pageIds = bills.map((b) => b.id);

  /**
   * Turn the page.
   *
   * Raises `loading` first, because the effect that follows the page change calls
   * `load`, which no longer does. The spinner therefore appears on the click rather
   * than waiting for the request to be issued.
   */
  function goToPage(next: number) {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === page) return;
    setLoading(true);
    setPage(clamped);
  }

  async function handleRemoveSelected() {
    if (selection.count === 0) return;
    setBulk({
      title: "Removing bills from folder",
      subtitle: `${selection.count} ${selection.count === 1 ? "bill" : "bills"} · ${folder.name}`,
    });
    try {
      const res = await removeBillsFromBillingFolder(folder.id, [...selection.selected]);
      if (!res.ok) {
        onError("Nothing was removed", res.error ?? "Please try again.");
        return;
      }
      onNotice(
        `${res.changed} ${res.changed === 1 ? "bill" : "bills"} unfiled`,
        "The bills are still in All Bills — removing a bill from a folder never deletes it."
      );
      selection.clear();
      await refresh();
      await onChanged();
    } finally {
      setBulk(null);
    }
  }

  async function handleMove() {
    if (!moveTarget || selection.count === 0) return;
    const target = destinations.find((f) => f.id === moveTarget);
    if (!target) return;
    const count = selection.count;
    setBulk({
      title: "Moving bills",
      subtitle: `${count} ${count === 1 ? "bill" : "bills"} → ${target.name}`,
      progressLabel: "Moving",
      progress: { done: 0, total: count },
    });
    try {
      const res = await moveBillsBetweenBillingFolders(
        folder.id,
        target.id,
        [...selection.selected],
        (progress: BulkProgress) => setBulk((prev) => (prev ? { ...prev, progress } : prev))
      );
      if (!res.ok) {
        onError("The move did not finish", res.error ?? "Please try again.");
        await refresh();
        await onChanged();
        return;
      }
      onNotice(
        `${res.changed} ${res.changed === 1 ? "bill" : "bills"} moved`,
        `Now in ${target.name}.`
      );
      selection.clear();
      setMoveTarget(null);
      await refresh();
      await onChanged();
    } finally {
      setBulk(null);
    }
  }

  async function handleEmpty() {
    const ok = window.confirm(
      `Empty "${folder.name}"?\n\n` +
        `All ${billTotal} ${billTotal === 1 ? "bill" : "bills"} will be removed from the ` +
        "folder. The BILLS ARE NOT DELETED — they stay in All Bills with their print copies.\n\n" +
        "The folder itself is kept, so you can start filing into it again."
    );
    if (!ok) return;

    setBulk({ title: "Emptying billing folder", subtitle: folder.name });
    try {
      const res = await emptyBillingFolder(folder.id);
      if (!res.ok) {
        onError("The folder was not emptied", res.error ?? "Please try again.");
        return;
      }
      onNotice(
        "Folder emptied",
        `${res.bills_removed ?? 0} bills unfiled. The bills themselves are untouched.`
      );
      selection.clear();
      await refresh();
      await onChanged();
    } finally {
      setBulk(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-base font-bold text-text">
          {billTotal} {billTotal === 1 ? "bill" : "bills"}
        </p>
        {billTotal > 0 && (
          <p className="mt-0.5 text-[11px] text-text-muted">
            Each bill is one invoice. Its original, duplicate and triplicate are three
            print copies of it and are counted once here.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleEmpty()}
          disabled={billTotal === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-text-secondary hover:bg-surface-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Trash2 size={13} />
          Empty folder
        </button>
      </div>

      {summaryError && (
        <div className="rounded-lg border border-danger/50 bg-surface px-4 py-3 flex flex-col items-start gap-1.5">
          <p className="text-xs text-danger">{summaryError}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-xs font-bold text-primary hover:underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {loading && !summary && (
        <div className="flex items-center justify-center py-8" role="status">
          <Loader2 size={22} className="text-primary animate-spin" />
          <span className="sr-only">Loading folder totals</span>
        </div>
      )}

      {summary && (
        <>
          <SummarySection title="Totals">
            <Figure label="Total quantity" value={formatQuantity(summary.total_quantity)} />
            <Figure label="Before tax" value={formatMoney(summary.total_amount_before_tax)} />
            <Figure label="CGST" value={formatMoney(summary.total_cgst)} />
            <Figure label="SGST" value={formatMoney(summary.total_sgst)} />
            <Figure label="IGST" value={formatMoney(summary.total_igst)} />
            <Figure label="GST" value={formatMoney(summary.total_gst)} />
            <Figure label="After tax" value={formatMoney(summary.total_amount_after_tax)} />
            <Figure label="Round off" value={formatMoney(summary.total_round_off)} />
          </SummarySection>

          <SummarySection title="Average per bill">
            <Figure label="Quantity" value={formatQuantity(summary.average_quantity)} />
            <Figure label="Before tax" value={formatMoney(summary.average_amount_before_tax)} />
            <Figure label="CGST" value={formatMoney(summary.average_cgst)} />
            <Figure label="SGST" value={formatMoney(summary.average_sgst)} />
            <Figure label="IGST" value={formatMoney(summary.average_igst)} />
            <Figure label="GST" value={formatMoney(summary.average_gst)} />
            <Figure label="After tax" value={formatMoney(summary.average_bill_value)} />
          </SummarySection>

          <SummarySection title="Spread">
            <Figure
              label="Lowest bill"
              value={summary.total_bills === 0 ? "—" : formatMoney(summary.min_amount_after_tax)}
            />
            <Figure
              label="Highest bill"
              value={summary.total_bills === 0 ? "—" : formatMoney(summary.max_amount_after_tax)}
            />
            <Figure
              label="Lowest, before tax"
              value={
                summary.total_bills === 0 ? "—" : formatMoney(summary.min_amount_before_tax)
              }
            />
            <Figure
              label="Highest, before tax"
              value={
                summary.total_bills === 0 ? "—" : formatMoney(summary.max_amount_before_tax)
              }
            />
          </SummarySection>

          {/* Only real stored `job_kind` values, cleaned up for display. No category is
              invented, and nothing is folded into an "Other" the user cannot see. */}
          {summary.job_kind_breakdown.length > 0 && (
            <SummarySection title="Bill breakdown">
              {summary.job_kind_breakdown.map((bucket, index) => (
                <Figure
                  key={`${bucket.job_kind ?? "none"}-${index}`}
                  label={
                    bucket.job_kind ? formatJobKind(bucket.job_kind) ?? bucket.job_kind : "Unclassified"
                  }
                  value={`${bucket.count} ${bucket.count === 1 ? "bill" : "bills"}`}
                />
              ))}
            </SummarySection>
          )}

          {/* A folder whose totals were never imported reads as "no totals", not as
              "₹0.00". A zero is a real financial figure and this is not one. */}
          {summary.bills_without_total > 0 && (
            <p className="flex items-start gap-1.5 text-[11px] text-warning">
              <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden="true" />
              {summary.bills_without_total} of {summary.total_bills} bills have no recorded
              after-tax total, so the totals and averages above leave them out.
            </p>
          )}
        </>
      )}

      <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
        Bills in this folder
      </h3>

      {bills.length > 0 && (
        <div className="flex items-center gap-3">
          <SelectAllCheckbox
            ids={pageIds}
            selection={selection}
            label="Select every bill on this page"
          />
          {selection.count > pageIds.length && (
            <span className="text-[11px] text-text-muted">
              {selection.count} selected across pages
            </span>
          )}
        </div>
      )}

      {selection.count > 0 && (
        <div
          className="rounded-lg border border-border bg-surface-secondary px-3 py-2.5 flex flex-col gap-2"
          aria-live="polite"
        >
          <p className="text-xs font-bold text-text">
            {selection.count} {selection.count === 1 ? "bill" : "bills"} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRemoveSelected()}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-[var(--theme-primary-text)] hover:bg-primary-hover transition-colors cursor-pointer"
            >
              Remove from folder
            </button>
            <button
              type="button"
              onClick={() => setMoveTarget(moveTarget ? null : "choose")}
              className="rounded-lg bg-primary-muted px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary transition-colors cursor-pointer"
            >
              Move…
            </button>
            <button
              type="button"
              onClick={selection.clear}
              className="px-2 py-1.5 text-xs font-semibold text-text-secondary hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>

          {moveTarget === "choose" && (
            <div className="border-t border-border pt-2 flex flex-col gap-1.5">
              {destinations.length === 0 ? (
                <p className="text-[11px] text-warning">
                  There is no other billing folder to move these into. Create one from the
                  folder list first.
                </p>
              ) : (
                destinations.map((dest) => (
                  <label
                    key={dest.id}
                    className="flex items-center justify-between gap-2 text-xs text-text cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="billing-move-target"
                        checked={moveTarget === dest.id}
                        onChange={() => setMoveTarget(dest.id)}
                        className="accent-[var(--theme-primary)]"
                      />
                      {dest.name}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      {dest.billCount ?? 0} {dest.billCount === 1 ? "bill" : "bills"}
                    </span>
                  </label>
                ))
              )}
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => void handleMove()}
                  disabled={moveTarget === "choose"}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-[var(--theme-primary-text)] hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Move here
                </button>
                <button
                  type="button"
                  onClick={() => setMoveTarget(null)}
                  className="text-xs font-semibold text-text-secondary hover:underline cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {bills.map((bill) => {
          const isSelected = selection.isSelected(bill.id);
          const jobKind = formatJobKind(bill.job_kind);
          return (
            <div
              key={bill.id}
              className={`flex items-center gap-3 rounded-lg border bg-surface px-3 py-2.5 ${
                isSelected ? "border-primary" : "border-border"
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => selection.toggle(bill.id)}
                aria-label={`Select bill ${bill.invoice_no || bill.sheet_name}`}
                className="accent-[var(--theme-primary)] cursor-pointer"
              />
              {onOpenBill ? (
                <button
                  type="button"
                  onClick={() => onOpenBill(bill.id)}
                  className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity cursor-pointer"
                >
                  <span className="block text-xs font-semibold text-text truncate">
                    {bill.invoice_no || "No invoice number"}
                  </span>
                  <span className="block text-[11px] text-text-muted truncate">
                    {bill.party_name ? `${bill.party_name} · ` : ""}
                    {`${formatBillDate(bill.invoice_date)} · ${bill.original_filename}`}
                  </span>
                  {jobKind && <span className="block text-[11px] text-text-secondary">{jobKind}</span>}
                </button>
              ) : (
                <div className="flex-1 min-w-0">
                  <span className="block text-xs font-semibold text-text truncate">
                    {bill.invoice_no || "No invoice number"}
                  </span>
                  <span className="block text-[11px] text-text-muted truncate">
                    {`${formatBillDate(bill.invoice_date)} · ${bill.original_filename}`}
                  </span>
                </div>
              )}
              <div className="text-right shrink-0">
                <span className="block text-xs font-bold text-text tabular-nums">
                  {formatMoney(bill.amount_after_tax)}
                </span>
                <span className="block text-[11px] text-text-muted">
                  Qty {formatQuantity(bill.total_quantity)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        /* The same Pagination the Bills list uses, driven by the same prop names, so
           there is only one paging control in the app to get wrong.
           Page size is pinned rather than offered: a folder's page size is not the
           user's decision here, and letting it drift from PAGE_SIZE would desynchronise
           `totalPages` from what is actually loaded. */
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          setPage={goToPage}
          setPageSize={() => {
            /* Pinned. See above. */
          }}
          totalItems={billTotal}
          totalPages={totalPages}
          itemLabel="bills in this folder"
        />
      )}

      {loading && bills.length === 0 && (
        <div className="flex items-center justify-center py-8" role="status">
          <Loader2 size={22} className="text-primary animate-spin" />
          <span className="sr-only">Loading bills in this folder</span>
        </div>
      )}

      {!loading && bills.length === 0 && (
        <div className="rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm font-semibold text-text">This folder is empty</p>
          <p className="mt-1 text-xs text-text-muted">
            File bills into it from the Bills list, or use “File here” on the folder list.
          </p>
        </div>
      )}

      <BulkOperationOverlay operation={bulk} />
    </div>
  );
}

/* ──────────────────────────────────────────────
   FORMATTING PIECES
   ────────────────────────────────────────────── */

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface px-4 py-3">
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {title}
      </h3>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/**
 * One label / value line.
 *
 * No arithmetic happens here: `value` is always a figure that already came out of the
 * summary RPC. Summing in the view is how a total and its own parts drift apart.
 */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-[3px]">
      <span className="flex-1 text-xs text-text-secondary">{label}</span>
      <span className="text-xs font-semibold text-text tabular-nums">{value}</span>
    </div>
  );
}