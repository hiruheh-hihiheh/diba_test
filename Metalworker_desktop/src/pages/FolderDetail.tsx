// src/pages/FolderDetail.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  FolderOpen,
  Loader2,
  RefreshCw,
  Eye,
  Trash2,
  Plus,
  GripVertical,
  Package,
  Building2,
  FileText,
  PenTool,
  Briefcase,
  Layers,
  Receipt,
  ExternalLink,
} from "lucide-react";
import {
  fetchFolder,
  fetchFolderItems,
  resolveFolderItemLabels,
  fetchAvailableItems,
  addFolderItem,
  removeFolderItem,
  addMultipleItemsToFolder,
  removeMultipleItemsFromFolder,
  reorderFolderItems,
} from "../services/folders";
import type { AdminFolder, FolderItemDisplay, FolderItemType } from "../types/folder";
import { usePageMeta } from "../contexts/PageMetaContext";
import { useSelection } from "../hooks/useSelection";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import Modal from "../components/ui/Modal";
import IconButton from "../components/ui/IconButton";
import SelectAllCheckbox from "../components/ui/SelectAllCheckbox";
import BulkActionBar from "../components/ui/BulkActionBar";
import { ErrorState, InlineRefreshBar } from "../components/ui/LoadingState";
import { BillDetailModal } from "../components/bills/BillDetailModal";
import {
  fetchFolderBillSummary,
  formatMoney,
  formatQuantity,
} from "../services/bills";
import type { FolderBillSummary } from "../types/bill";
import { readableError } from "../utils/readableError";

interface LibItem {
  type: FolderItemType;
  id: string;
  label: string;
}

function getItemIcon(type: FolderItemType) {
  switch (type) {
    case "owner_stock":
      return <Package size={16} className="text-purple" />;
    case "company_stock":
      return <Building2 size={16} className="text-primary" />;
    case "bill_group":
      return <FileText size={16} className="text-warning" />;
    case "drawing_group":
      return <PenTool size={16} className="text-success" />;
    case "job":
      return <Briefcase size={16} className="text-danger" />;
    case "bill":
      return <Receipt size={16} className="text-success" />;
  }
}

function getItemTypeLabel(type: FolderItemType) {
  switch (type) {
    case "owner_stock":
      return "Owner Stock";
    case "company_stock":
      return "Company Stock";
    case "bill_group":
      return "Bill Group";
    case "drawing_group":
      return "Drawing Group";
    case "job":
      return "Job";
    case "bill":
      return "Bill";
  }
}

/** Where each item type is managed, so the details dialog can link out. */
const itemRoute: Record<FolderItemType, { path: string; label: string }> = {
  owner_stock: { path: "/stock-owner", label: "Open Stock by Owner" },
  company_stock: { path: "/stock-company", label: "Open Stock by Company" },
  bill_group: { path: "/group-bills", label: "Open Group Bills" },
  drawing_group: { path: "/group-drawings", label: "Open Group Drawings" },
  job: { path: "/jobs/labour", label: "Open Jobs" },
  bill: { path: "/bills", label: "Open Bills" },
};

const ITEM_FILTERS: ("all" | FolderItemType)[] = [
  "all",
  "owner_stock",
  "company_stock",
  "bill_group",
  "drawing_group",
  // Jobs are valid folder items (itemRoute and getItemTypeLabel both handle
  // them). Omitting "job" here hid every job from the filter chips even
  // though the page renders them.
  "job",
  // `bill` is the tax-invoice record from the Bills section. It is a separate
  // thing from `bill_group`, which is the older photo-group feature, so it gets
  // its own chip rather than being folded in with it.
  "bill",
];

/** How many "available items" rows are mounted at once. See visibleCount. */
const AVAILABLE_PAGE = 60;

export default function FolderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [folder, setFolder] = useState<AdminFolder | null>(null);
  const [folderItems, setFolderItems] = useState<FolderItemDisplay[]>([]);
  const [availableItems, setAvailableItems] = useState<LibItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** False for "gone" / "not allowed", where a retry button cannot help. */
  const [errorRetryable, setErrorRetryable] = useState(true);

  /* Search over the items *inside* the folder, which did not exist before. */
  const [insideSearch, setInsideSearch] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | FolderItemType>("all");

  /* The old UI hid every checkbox behind a "Select Multiple" toggle, so bulk
     work needed an extra mode switch. Selection is now always available. */
  const insideSelection = useSelection();
  const availableSelection = useSelection();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [addingOneId, setAddingOneId] = useState<string | null>(null);
  const [removingOneId, setRemovingOneId] = useState<string | null>(null);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [previewItem, setPreviewItem] = useState<LibItem | null>(null);

  /* A bill opened from inside a folder gets the full bill dialog; the small
     "this record lives on its own page" box is not enough for an invoice with
     line items and three PDFs. */
  const [billPreviewId, setBillPreviewId] = useState<string | null>(null);

  /* Financial totals for the bills in this folder. Null until loaded, and null
     again on failure, so the panel can say "could not load" instead of printing
     a confident row of zeros that look like real figures. */
  const [billSummary, setBillSummary] = useState<FolderBillSummary | null>(null);
  const [billSummaryError, setBillSummaryError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setLoading(true);
      try {
        const [fData, fItemsData, aItemsData] = await Promise.all([
          fetchFolder(id),
          fetchFolderItems(id),
          fetchAvailableItems(id),
        ]);
        setFolder(fData);
        setFolderItems(await resolveFolderItemLabels(fItemsData));
        setAvailableItems(aItemsData);
        insideSelection.prune(fItemsData.map((i) => i.id));
        availableSelection.prune(aItemsData.map((i) => i.id));
        setError(null);
        setErrorRetryable(true);
      } catch (e) {
        /* This used to print the raw database message, so a folder whose row
           could not be read showed "Cannot coerce the result to a single JSON
           object" above a "Try again" button that could never succeed. */
        const r = readableError(e, {
          subject: "this folder",
          fallback:
            "This folder could not be opened. It may have been deleted, or it may not be visible to your account.",
          byKind: {
            "not-found":
              "This folder no longer exists — it was probably deleted. Nothing inside it was affected.",
            forbidden:
              "Your account does not have permission to open this folder.",
            connection:
              "Could not reach the server, so this folder could not be loaded. Check your connection and try again.",
          },
        });
        setError(r.message);
        setErrorRetryable(r.retryable);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id]
  );

  useEffect(() => {
    load();
  }, [load]);

  /* Bill totals are loaded on their own, deliberately separate from `load`.
     A folder that predates migration 0006, or an RPC that has not been
     deployed, must still open and still show its items: folding the summary
     into the main load would turn "no summary available" into "this folder is
     broken". */
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchFolderBillSummary(id)
      .then((s) => {
        if (!cancelled) {
          setBillSummary(s);
          setBillSummaryError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBillSummary(null);
        setBillSummaryError(
          err instanceof Error ? err.message : "The bill totals could not be loaded."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id, folderItems.length]);

  usePageMeta(
    {
      title: folder?.name ?? "Folder",
      crumbs: [{ label: "Folders", to: "/folders" }, { label: folder?.name ?? "…" }],
      subtitle: folder
        ? `${folderItems.length} item${folderItems.length === 1 ? "" : "s"} inside`
        : undefined,
      /* The body header reports the same count and the folder type. */
      selfTitles: true,
    },
    [folder?.id, folder?.name, folderItems.length]
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  const filteredInside = useMemo(() => {
    if (!insideSearch.trim()) return folderItems;
    const q = insideSearch.toLowerCase();
    return folderItems.filter(
      (i) => i.label.toLowerCase().includes(q) || getItemTypeLabel(i.item_type).toLowerCase().includes(q)
    );
  }, [folderItems, insideSearch]);

  const filteredAvailable = useMemo(() => {
    return availableItems.filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;
      if (search.trim() && !item.label.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [availableItems, search, filter]);

  /* ── Available items: bounded rendering ──────────────
     The library holds every record in the system, so this panel can face
     thousands of items. Mounting them all made the folder page slow to open
     and left a scroll area tens of thousands of pixels tall. Rows are revealed
     in blocks instead, which also keeps the "Select all shown" checkbox honest
     — it selects exactly the rows on screen, which is what the label promises. */

  const [visibleCount, setVisibleCount] = useState(AVAILABLE_PAGE);
  const availableKey = `${filter}|${search.trim().toLowerCase()}`;
  const [lastAvailableKey, setLastAvailableKey] = useState(availableKey);
  if (availableKey !== lastAvailableKey) {
    // A new search or filter is a new result set: start it from the top.
    setLastAvailableKey(availableKey);
    setVisibleCount(AVAILABLE_PAGE);
  }

  const visibleAvailable = useMemo(
    () => filteredAvailable.slice(0, visibleCount),
    [filteredAvailable, visibleCount]
  );
  const remainingAvailable = filteredAvailable.length - visibleAvailable.length;

  const insideIds = useMemo(() => filteredInside.map((i) => i.id), [filteredInside]);
  const availableIds = useMemo(() => visibleAvailable.map((i) => i.id), [visibleAvailable]);

  /* ── Reordering ────────────────────────────────────── */

  function handleDragStart(e: React.DragEvent, index: number) {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newItems = [...folderItems];
    const [moved] = newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, moved);
    setDraggedIndex(index);
    setFolderItems(newItems);
  }

  async function handleDragEnd() {
    if (draggedIndex === null) return;
    setDraggedIndex(null);
    // Pass the folder id so the service can prefer the transactional
    // `reorder_folder_items` RPC (all-or-nothing) over the multi-update
    // fallback that can partially persist.
    const res = await reorderFolderItems(
      folderItems.map((item, index) => ({ id: item.id, position: index })),
      id
    );
    if (!res.ok) {
      toast.error({
        title: "Could not save the new order",
        description: res.error || "The order was restored to the previous sequence.",
      });
      await load(true);
    } else {
      toast.success({ title: "Order saved" });
    }
  }

  /* ── Single item actions ───────────────────────────── */

  /**
   * Open the details dialog for a folder item.
   *
   * Bills get the real bill dialog — amounts, line items and the three print
   * copies — because a one-line "this record is managed on its own page" box
   * would tell an operator nothing about the money in the folder. Every other
   * type keeps the small box with a link to its page, which is all it has ever
   * shown.
   */
  function openPreview(item: LibItem) {
    if (item.type === "bill") {
      setBillPreviewId(item.id);
      return;
    }
    setPreviewItem(item);
  }

  async function handleAddSingle(item: LibItem) {
    if (!id) return;
    setAddingOneId(item.id);
    const res = await addFolderItem(id, item.type, item.id);
    setAddingOneId(null);
    if (res.ok) {
      await load(true);
      toast.success({
        title: "Added to folder",
        description: `${item.label} was added to ${folder?.name}.`,
      });
    } else {
      toast.error({
        title: "Could not add item",
        description: res.error || `${item.label} was not added. Please try again.`,
      });
    }
  }

  async function handleRemoveSingle(row: FolderItemDisplay) {
    const ok = await confirm({
      title: "Remove from folder?",
      message: (
        <>
          <strong className="text-text">{row.label}</strong> will be removed from{" "}
          <strong className="text-text">{folder?.name}</strong>.
          <strong className="block mt-2 text-text">
            The record itself is not deleted — it stays in the Item Library.
          </strong>
        </>
      ),
      confirmLabel: "Remove from folder",
      tone: "primary",
    });
    if (!ok) return;

    setRemovingOneId(row.id);
    const res = await removeFolderItem(row.id);
    setRemovingOneId(null);

    if (res.ok) {
      setFolderItems((prev) => {
        const next = prev.filter((i) => i.id !== row.id);
        insideSelection.prune(next.map((i) => i.id));
        return next;
      });
      await load(true);
      toast.success({
        title: "Removed from folder",
        description: `${row.label} is no longer in ${folder?.name}. The record itself is untouched.`,
      });
    } else {
      toast.error({
        title: "Could not remove item",
        description: res.error || "The item is still in the folder. Please try again.",
      });
    }
  }

  /* ── Bulk actions ──────────────────────────────────── */

  async function handleBulkRemove() {
    const ids = Array.from(insideSelection.selected);
    if (ids.length === 0) return;

    const ok = await confirm({
      title: `Remove ${ids.length} item${ids.length === 1 ? "" : "s"} from folder?`,
      message: (
        <>
          The selected items are unlinked from <strong className="text-text">{folder?.name}</strong>.
          <strong className="block mt-2 text-text">
            No record is deleted — everything stays in the Item Library.
          </strong>
        </>
      ),
      confirmLabel: `Remove ${ids.length} from folder`,
      tone: "primary",
    });
    if (!ok) return;

    setBulkBusy(true);
    const res = await removeMultipleItemsFromFolder(ids);
    setBulkBusy(false);

    if (res.ok) {
      insideSelection.clear();
      await load(true);
      toast.success({
        title: `${ids.length} item${ids.length === 1 ? "" : "s"} removed`,
        description: `Unlinked from ${folder?.name}. No records were deleted.`,
      });
    } else {
      toast.error({
        title: "Could not remove items",
        description: res.error || "Nothing was removed. Please try again.",
      });
    }
  }

  async function handleBulkAdd() {
    const ids = Array.from(availableSelection.selected);
    if (ids.length === 0 || !id) return;

    setBulkBusy(true);
    const itemsToAdd = availableItems
      .filter((i) => availableSelection.selected.has(i.id))
      .map((i) => ({ type: i.type, id: i.id }));
    const res = await addMultipleItemsToFolder(id, itemsToAdd);
    setBulkBusy(false);

    if (res.ok) {
      availableSelection.clear();
      await load(true);
      toast.success({
        title: `${ids.length} item${ids.length === 1 ? "" : "s"} added`,
        description: `Added to ${folder?.name}.`,
      });
    } else {
      toast.error({
        title: "Could not add items",
        description: res.error || "Nothing was added. Please try again.",
      });
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <Loader2 size={32} className="animate-spin text-primary" />
        <span className="sr-only">Loading folder</span>
      </div>
    );
  }

  if (error || !folder) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => navigate("/folders")}
          className="flex items-center gap-2.5 text-sm font-bold text-text-muted hover:text-text transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} /> Back to Folders
        </button>
        <ErrorState
          message={error ?? "This folder no longer exists."}
          title={errorRetryable ? "Could not open folder" : "Folder not found"}
          /* Only offer a retry when retrying could actually work. A folder that
             is gone or forbidden stays gone, and a button that provably cannot
             work is worse than no button. */
          onRetry={errorRetryable ? () => load() : undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-24">
      {/* ── Header ──
          No <h1>: the TopBar and the breadcrumb trail already name the folder,
          and printing the name a third time meant a long folder name was
          truncated twice. The line that remains says what kind of folder this
          is, which is the detail that is not visible anywhere else. */}
      <div>
        <Link
          to="/folders"
          className="inline-flex items-center gap-2.5 text-sm font-bold text-text-muted hover:text-text transition-colors mb-5"
        >
          <ArrowLeft size={18} /> Back to Folders
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center shrink-0">
              <FolderOpen size={24} className="text-primary" />
            </div>
            <p className="text-sm text-text-muted min-w-0">
              <span className="text-text font-semibold">
                {folderItems.length} item{folderItems.length === 1 ? "" : "s"}
              </span>{" "}
              inside ·{" "}
              {folder.folder_type
                ? `${folder.folder_type.replace(/_/g, " ")} folder`
                : "general folder"}
            </p>
          </div>
          <IconButton
            label={refreshing ? "Refreshing…" : "Refresh folder"}
            icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
            onClick={handleRefresh}
            busy={refreshing}
            variant="surface"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Items inside the folder ── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-text">Items inside folder</h2>
            {folderItems.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-text cursor-pointer">
                <SelectAllCheckbox
                  ids={insideIds}
                  selection={insideSelection}
                  label={`Select all ${insideIds.length} items shown`}
                />
                Select all shown
              </label>
            )}
          </div>

          <SearchInput
            value={insideSearch}
            onChange={setInsideSearch}
            scope="items in this folder"
            unit="item"
            resultCount={filteredInside.length}
            totalCount={folderItems.length}
            placeholder="Search inside this folder…"
          />

          <div className="bg-surface border border-border rounded-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-22rem)]">
            <InlineRefreshBar show={refreshing} />

            {filteredInside.length === 0 ? (
              <EmptyState
                icon={<FolderOpen size={24} />}
                title={
                  insideSearch.trim()
                    ? "No items match"
                    : folderItems.length === 0
                      ? "This folder is empty"
                      : "Nothing shown"
                }
                description={
                  insideSearch.trim()
                    ? `No item in this folder matches “${insideSearch.trim()}”.`
                    : folderItems.length === 0
                      ? "Use the Available Items panel to bring jobs, stock, bills or drawings into this folder."
                      : undefined
                }
                action={
                  insideSearch.trim() ? (
                    <button
                      type="button"
                      onClick={() => setInsideSearch("")}
                      className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                    >
                      Clear search
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-y-auto scrollbar-thin divide-y divide-border/50">
                {filteredInside.map((item) => {
                  const checked = insideSelection.isSelected(item.id);
                  const busy = removingOneId === item.id;
                  return (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, folderItems.indexOf(item))}
                      onDragOver={(e) => handleDragOver(e, folderItems.indexOf(item))}
                      onDragEnd={handleDragEnd}
                      aria-busy={busy}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors group ${
                        busy ? "opacity-60" : checked ? "bg-primary/5" : "hover:bg-surface-hover/30"
                      }`}
                    >
                      <span
                        className="shrink-0 text-border cursor-grab active:cursor-grabbing"
                        title="Drag to reorder"
                        aria-label="Drag to reorder this item"
                      >
                        <GripVertical size={18} />
                      </span>

                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => insideSelection.toggle(item.id)}
                        aria-label={`Select ${item.label}`}
                        className="w-4 h-4 rounded accent-primary cursor-pointer shrink-0"
                      />

                      <div className="w-10 h-10 rounded-xl bg-bg border border-border flex items-center justify-center shrink-0">
                        {getItemIcon(item.item_type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-text truncate" title={item.label}>
                          {item.label}
                        </p>
                        {/* Job classification for a bill, under the untouched label. */}
                        {item.subtitle && (
                          <p className="text-xs font-bold text-primary truncate" title={item.subtitle}>
                            {item.subtitle}
                          </p>
                        )}
                        <p className="text-xs text-text-muted font-medium mt-0.5">
                          {getItemTypeLabel(item.item_type)}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <IconButton
                          label={`Details for ${item.label}`}
                          size="sm"
                          icon={<Eye size={14} />}
                          onClick={() =>
                            openPreview({
                              type: item.item_type,
                              id: item.item_id,
                              label: item.label,
                            })
                          }
                        />
                        <IconButton
                          label={`Remove ${item.label} from ${folder.name} (record is kept)`}
                          size="sm"
                          variant="danger"
                          icon={<Trash2 size={14} />}
                          onClick={() => handleRemoveSingle(item)}
                          busy={busy}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {insideSelection.count > 0 && folderItems.length > 0 && (
              <div className="px-4 py-2 border-t border-border bg-surface-hover/30 flex items-center justify-between gap-3 shrink-0">
                <span className="text-xs text-text-muted">
                  {insideSelection.count} of {filteredInside.length} shown selected
                </span>
                <button
                  type="button"
                  onClick={insideSelection.clear}
                  className="text-xs font-bold text-primary hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Available items ── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-text">Available items</h2>
            {availableIds.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-text cursor-pointer">
                <SelectAllCheckbox
                  ids={availableIds}
                  selection={availableSelection}
                  label={`Select all ${availableIds.length} available items shown`}
                />
                Select all shown
              </label>
            )}
          </div>

          {/* Height is derived from the viewport, not the hard-coded 600px that
              pushed the panel off a short window. */}
          <div className="bg-surface border border-border rounded-2xl flex flex-col overflow-hidden lg:max-h-[calc(100dvh-20rem)]">
            <div className="p-4 border-b border-border space-y-3 shrink-0 bg-surface">
              <SearchInput
                value={search}
                onChange={setSearch}
                scope="available items"
                resultCount={filteredAvailable.length}
                totalCount={availableItems.length}
                placeholder="Search available items…"
              />
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label="Filter by type">
                {ITEM_FILTERS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFilter(t)}
                    aria-pressed={filter === t}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      filter === t
                        ? "bg-primary text-white"
                        : "bg-bg text-text-muted hover:text-text hover:bg-surface-hover border border-border"
                    }`}
                  >
                    {t === "all" ? "All" : getItemTypeLabel(t)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-2 min-h-[min(16rem,45dvh)]">
              {filteredAvailable.length === 0 ? (
                <EmptyState
                  icon={<Layers size={22} />}
                  title={
                    availableItems.length === 0
                      ? "Nothing left to add"
                      : "No items match"
                  }
                  description={
                    availableItems.length === 0
                      ? `Every record in the system is already in ${folder.name}.`
                      : `Nothing matches${
                          search.trim() ? ` “${search.trim()}”` : ""
                        }${filter !== "all" ? ` in ${getItemTypeLabel(filter)}` : ""}.`
                  }
                  action={
                    availableItems.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch("");
                          setFilter("all");
                        }}
                        className="text-xs font-bold text-primary hover:underline cursor-pointer"
                      >
                        Reset filters
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="space-y-1">
                  {visibleAvailable.map((item) => {
                    const checked = availableSelection.isSelected(item.id);
                    const busy = addingOneId === item.id;
                    return (
                      <div
                        key={`${item.type}-${item.id}`}
                        className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${
                          checked
                            ? "bg-primary-muted/20 border border-primary/30"
                            : "hover:bg-surface-hover/50 border border-transparent"
                        } ${busy ? "opacity-60" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => availableSelection.toggle(item.id)}
                          aria-label={`Select ${item.label}`}
                          className="w-4 h-4 rounded accent-primary cursor-pointer shrink-0"
                        />
                        <div className="w-9 h-9 rounded-lg bg-bg border border-border flex items-center justify-center shrink-0">
                          {getItemIcon(item.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-text truncate" title={item.label}>
                            {item.label}
                          </p>
                          <p className="text-[11px] text-text-muted font-medium mt-0.5">
                            {getItemTypeLabel(item.type)}
                          </p>
                        </div>
                        {/* Always visible; previously hover-only. */}
                        <div className="flex items-center gap-1 shrink-0">
                          <IconButton
                            label={`Details for ${item.label}`}
                            size="sm"
                            icon={<Eye size={14} />}
                            onClick={() => openPreview(item)}
                          />
                          <IconButton
                            label={`Add ${item.label} to ${folder.name}`}
                            size="sm"
                            variant="primary"
                            icon={<Plus size={15} />}
                            onClick={() => handleAddSingle(item)}
                            busy={busy}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* How much of the list is on screen, and how to get the rest. Without
                this the panel gave no hint that 268 items existed behind the
                268 rendered rows, and there was no way to tell scrolling had a
                bottom. */}
            {remainingAvailable > 0 && (
              <div className="px-4 py-2.5 border-t border-border bg-bg/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <span className="text-xs text-text-muted">
                  Showing{" "}
                  <span className="font-semibold text-text">
                    {visibleAvailable.length.toLocaleString()}
                  </span>{" "}
                  of{" "}
                  <span className="font-semibold text-text">
                    {filteredAvailable.length.toLocaleString()}
                  </span>{" "}
                  available
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCount((c) => Math.min(c + AVAILABLE_PAGE, filteredAvailable.length))
                    }
                    className="text-xs font-bold text-primary hover:underline cursor-pointer"
                  >
                    Show {Math.min(AVAILABLE_PAGE, remainingAvailable)} more
                  </button>
                  <span className="text-border">·</span>
                  <button
                    type="button"
                    onClick={() => setVisibleCount(filteredAvailable.length)}
                    className="text-xs font-bold text-text-muted hover:text-text cursor-pointer"
                  >
                    Show all
                  </button>
                </div>
              </div>
            )}

            {availableSelection.count > 0 && (
              <div className="px-4 py-2.5 border-t border-border bg-primary/5 flex items-center justify-between gap-3 shrink-0">
                <span className="text-xs font-semibold text-text">
                  {availableSelection.count} selected
                </span>
                <button
                  type="button"
                  onClick={availableSelection.clear}
                  className="text-xs font-bold text-text-muted hover:text-text cursor-pointer"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── Bulk bar: viewport-anchored (was a document-positioned `fixed`
             element hidden below long lists) ── */}
      <BulkActionBar
        count={insideSelection.count}
        itemLabel="items"
        context={folder.name}
        onClear={insideSelection.clear}
      >
        <button
          type="button"
          onClick={handleBulkRemove}
          disabled={bulkBusy}
          className="px-3.5 py-2 rounded-lg bg-danger-muted text-danger text-xs font-bold border border-danger/25 hover:bg-danger hover:text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 flex items-center gap-1.5"
        >
          {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Remove from folder
        </button>
      </BulkActionBar>

      <BulkActionBar
        count={availableSelection.count}
        itemLabel="items"
        context={`adding to ${folder.name}`}
        onClear={availableSelection.clear}
        clearLabel="Clear selection"
      >
        <button
          type="button"
          onClick={handleBulkAdd}
          disabled={bulkBusy}
          className="px-3.5 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary-hover transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 flex items-center gap-1.5"
        >
          {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Add to folder
        </button>
      </BulkActionBar>

      {/* ── Folder bill summary ──
          Every figure below is over UNIQUE bills. The original, duplicate and
          triplicate PDFs are three print copies of one invoice, and only the
          invoice is stored once, so adding the three would triple every total.
          The RPC (migration 0006) does the de-duplication; this block only
          presents what it returns. */}
      {billSummary && billSummary.total_bills > 0 && (
        <section className="bg-surface border border-border rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-xl bg-primary-muted flex items-center justify-center shrink-0">
              <Receipt size={17} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-text">Bill summary</h2>
              <p className="text-xs text-text-muted">
                {billSummary.total_bills}{" "}
                {billSummary.total_bills === 1 ? "bill" : "bills"} in this folder · each
                invoice counted once, not once per print copy
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <SummaryFigure label="Total quantity" value={formatQuantity(billSummary.total_quantity)} />
            <SummaryFigure label="Amount before tax" value={formatMoney(billSummary.total_amount_before_tax)} />
            <SummaryFigure label="CGST" value={formatMoney(billSummary.total_cgst)} />
            <SummaryFigure label="SGST" value={formatMoney(billSummary.total_sgst)} />
            <SummaryFigure label="IGST" value={formatMoney(billSummary.total_igst)} />
            <SummaryFigure label="Total GST" value={formatMoney(billSummary.total_gst)} />
            <SummaryFigure label="Round off" value={formatMoney(billSummary.total_round_off)} />
            <SummaryFigure
              label="Amount after tax"
              value={formatMoney(billSummary.total_amount_after_tax)}
              emphasis
            />
            <SummaryFigure label="Average bill value" value={formatMoney(billSummary.average_bill_value)} />
            <SummaryFigure label="Average quantity" value={formatQuantity(billSummary.average_quantity)} />
            <SummaryFigure
              label="Average before tax"
              value={formatMoney(billSummary.average_amount_before_tax)}
            />
          </div>
        </section>
      )}

      {billSummaryError && (
        <p className="text-xs text-text-muted px-1">
          Bill totals are unavailable: {billSummaryError}
        </p>
      )}

      {/* ── Item details ── */}
      <Modal
        open={!!previewItem}
        onClose={() => setPreviewItem(null)}
        size="sm"
        title={previewItem ? getItemTypeLabel(previewItem.type) : "Item"}
        subtitle="This record is managed on its own page"
        footer={
          <>
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Close
            </button>
            {previewItem && (
              <button
                type="button"
                onClick={() => {
                  const target = itemRoute[previewItem.type];
                  setPreviewItem(null);
                  navigate(target.path);
                }}
                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-colors cursor-pointer flex items-center gap-2"
              >
                {itemRoute[previewItem.type].label}
                <ExternalLink size={14} />
              </button>
            )}
          </>
        }
      >
        {previewItem && (
          <div className="flex items-center gap-4 bg-bg border border-border p-5 rounded-2xl">
            <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0">
              {getItemIcon(previewItem.type)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-text-muted uppercase tracking-[0.1em] mb-1">
                {getItemTypeLabel(previewItem.type)}
              </p>
              <p className="text-base font-bold text-text break-words">{previewItem.label}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Bill details, opened from inside a folder ── */}
      <BillDetailModal
        billId={billPreviewId}
        onClose={() => setBillPreviewId(null)}
        onOpenFolderPicker={() => setBillPreviewId(null)}
      />
    </div>
  );
}

/** One figure in the folder bill summary. */
function SummaryFigure({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`px-3 py-2 rounded-xl ${
        emphasis ? "bg-primary-muted" : "bg-bg-secondary border border-border"
      }`}
    >
      <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider">{label}</p>
      <p
        className={`text-sm font-bold tabular-nums mt-0.5 ${
          emphasis ? "text-primary" : "text-text"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
