// src/pages/Folders.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FolderOpen,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  Pencil,
  Package,
  Building2,
  FileText,
  PenTool,
  ChevronRight,
  CornerRightDown,
  GripVertical,
  ExternalLink,
  AlertTriangle,
  Briefcase,
  FolderSearch,
} from "lucide-react";
import {
  fetchFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  fetchAllItems,
  addFolderItem,
} from "../services/folders";
import type { AdminFolder, FolderItemType } from "../types/folder";
import { usePageMeta } from "../contexts/PageMetaContext";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import Modal from "../components/ui/Modal";
import IconButton from "../components/ui/IconButton";
import Pagination, { usePagination } from "../components/ui/Pagination";
import { ErrorState, InlineRefreshBar } from "../components/ui/LoadingState";
import { readableError } from "../utils/readableError";

interface LibraryItem {
  type: FolderItemType;
  id: string;
  label: string;
}

const inputCls =
  "w-full px-4 py-3 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

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
  }
}

/** Where each item type actually lives, so "Preview" leads somewhere real. */
const itemRoute: Record<FolderItemType, { path: string; label: string }> = {
  owner_stock: { path: "/stock-owner", label: "Open Stock by Owner" },
  company_stock: { path: "/stock-company", label: "Open Stock by Company" },
  bill_group: { path: "/group-bills", label: "Open Group Bills" },
  drawing_group: { path: "/group-drawings", label: "Open Group Drawings" },
  job: { path: "/jobs/labour", label: "Open Jobs" },
};

const ITEM_FILTERS: ("all" | FolderItemType)[] = [
  "all",
  "owner_stock",
  "company_stock",
  "bill_group",
  "drawing_group",
];

export default function FoldersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [availableItems, setAvailableItems] = useState<LibraryItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [itemsSearch, setItemsSearch] = useState("");
  const [itemsFilter, setItemsFilter] = useState<"all" | FolderItemType>("all");

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingFolder, setEditingFolder] = useState<AdminFolder | null>(null);
  const [formName, setFormName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [draggedItem, setDraggedItem] = useState<LibraryItem | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [movingItem, setMovingItem] = useState(false);

  const [previewItem, setPreviewItem] = useState<LibraryItem | null>(null);
  const libraryRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [list, items] = await Promise.all([fetchFolders(), fetchAllItems()]);
      setFolders(list);
      setAvailableItems(items);
      setError(null);
    } catch (e) {
      setError(
        readableError(e, {
          subject: "the folder list",
          fallback:
            "The folder list could not be loaded. Check your connection and try again.",
        }).message
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const q = search.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  const filteredItems = useMemo(() => {
    return availableItems.filter((item) => {
      if (itemsFilter !== "all" && item.type !== itemsFilter) return false;
      if (itemsSearch.trim() && !item.label.toLowerCase().includes(itemsSearch.toLowerCase()))
        return false;
      return true;
    });
  }, [availableItems, itemsSearch, itemsFilter]);

  const itemCountsByType = useMemo(() => {
    const counts = new Map<FolderItemType, number>();
    for (const i of availableItems) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
    return counts;
  }, [availableItems]);

  /* The library can hold every job in the system, so it is paginated rather
     than rendering thousands of rows at once. */
  const itemPagination = usePagination(filteredItems.length, 25);
  const pageItems = useMemo(
    () => itemPagination.pageItems(filteredItems),
    [itemPagination.pageItems, filteredItems]
  );

  usePageMeta(
    {
      title: "Folders",
      crumbs: [{ label: "Folders" }],
      subtitle: `${folders.length} folder${folders.length === 1 ? "" : "s"} · ${
        availableItems.length
      } item${availableItems.length === 1 ? "" : "s"} in the library`,
      /* The body header reports the same figures next to the actions. */
      selfTitles: true,
    },
    [folders.length, availableItems.length]
  );

  function openAdd() {
    setEditingFolder(null);
    setFormName("");
    setFormError(null);
    setShowFormModal(true);
  }

  function openEdit(folder: AdminFolder) {
    setEditingFolder(folder);
    setFormName(folder.name);
    setFormError(null);
    setShowFormModal(true);
  }

  async function handleSave() {
    const name = formName.trim();
    if (!name) {
      setFormError("Enter a name for the folder.");
      return;
    }
    setFormError(null);
    setFormLoading(true);
    try {
      if (editingFolder) {
        const res = await updateFolder(editingFolder.id, name);
        if (!res.ok) {
          setFormError(
            res.error || "The folder name was not changed. The name may already be in use."
          );
          return;
        }
        toast.success({ title: "Folder renamed", description: `Now called “${name}”.` });
      } else {
        const res = await createFolder(name, "general");
        if (!res.ok) {
          setFormError(
            res.error || "The folder was not created. The name may already be in use."
          );
          return;
        }
        toast.success({
          title: "Folder created",
          description: `“${name}” was created and is empty.`,
        });
      }
      await load(true);
      setShowFormModal(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "The folder could not be saved. Please try again."
      );
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(folder: AdminFolder) {
    const count = folder.itemCount ?? 0;
    const ok = await confirm({
      title: `Delete “${folder.name}”?`,
      message: (
        <>
          The folder is removed and its {count} item{count === 1 ? "" : "s"} are unlinked.
          <strong className="block mt-2 text-text">
            Nothing inside is deleted — the jobs, stock, bills and drawings all stay in the system
            and remain in the Item Library.
          </strong>
        </>
      ),
      confirmLabel: "Delete folder",
    });
    if (!ok) return;

    try {
      const res = await deleteFolder(folder.id);
      if (res.ok) {
        await load(true);
        toast.success({
          title: "Folder deleted",
          description: `“${folder.name}” was removed. Its ${count} item${
            count === 1 ? "" : "s"
          } were kept.`,
        });
      } else {
        toast.error({
          title: "Could not delete folder",
          description: res.error || "The folder was not deleted. Please try again.",
        });
      }
    } catch (err) {
      toast.error({
        title: "Could not delete folder",
        description:
          err instanceof Error ? err.message : "The folder was not deleted. Please try again.",
      });
    }
  }

  /* --- Drag and drop --- */

  function handleDragStart(e: React.DragEvent, item: LibraryItem) {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  }

  function handleDragOver(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    if (draggedItem) setDragOverFolder(folderId);
  }

  function handleDragLeave(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    if (dragOverFolder === folderId) setDragOverFolder(null);
  }

  async function handleDrop(e: React.DragEvent, folder: AdminFolder) {
    e.preventDefault();
    setDragOverFolder(null);
    if (!draggedItem || movingItem) return;

    const item = draggedItem;
    setMovingItem(true);
    const result = await addFolderItem(folder.id, item.type, item.id);
    setMovingItem(false);
    setDraggedItem(null);

    if (result.ok) {
      await load(true);
      toast.success({
        title: "Added to folder",
        description: `${item.label} was added to ${folder.name}.`,
      });
    } else {
      toast.error({
        title: "Could not add item",
        description:
          result.error || `${item.label} was not added to ${folder.name}. Please try again.`,
      });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={32} className="text-primary animate-spin" />
        <span className="sr-only">Loading folders</span>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* ── Header ──
          No <h1>: the TopBar already says "Folders". The line that remains
          explains what a folder is *for*, which the top bar cannot. */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center shrink-0">
            <FolderOpen size={24} className="text-primary" />
          </div>
          <p className="text-sm text-text-muted min-w-0 max-w-xl">
            Group jobs and library items together so a batch can be reviewed, moved
            or exported as a unit.{" "}
            <span className="text-text font-semibold">
              {folders.length} folder{folders.length !== 1 ? "s" : ""}
            </span>{" "}
            holding{" "}
            <span className="text-text font-semibold">
              {availableItems.length} item{availableItems.length !== 1 ? "s" : ""}
            </span>
            .
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || movingItem}
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-surface border border-border text-sm font-semibold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer"
          >
            <Plus size={18} /> New Folder
          </button>
        </div>
      </div>

      {error && (
        <ErrorState
          message={error}
          onRetry={() => load()}
          title="Could not load folders"
        />
      )}

      {!error && (
        <>
          {/* ── Folder grid ── */}
          <div className="space-y-4">
            <SearchInput
              value={search}
              onChange={setSearch}
              scope="folders"
              resultCount={filteredFolders.length}
              totalCount={folders.length}
              placeholder="Search folders by name…"
              className="max-w-md"
            />

            {filteredFolders.length === 0 ? (
              <div className="bg-surface/50 border-2 border-dashed border-border rounded-2xl">
                <EmptyState
                  icon={<FolderSearch size={26} />}
                  title={
                    search.trim() ? "No folders match your search" : "No folders created yet"
                  }
                  description={
                    search.trim() ? (
                      <>
                        No folder name contains “{search.trim()}”. There{" "}
                        {folders.length === 1 ? "is" : "are"} {folders.length} folder
                        {folders.length === 1 ? "" : "s"} in total.
                      </>
                    ) : (
                      <>
                        Folders collect jobs, stock, bills and drawings in one place. Create an
                        empty folder, or let an Excel import create one for you.
                      </>
                    )
                  }
                  action={
                    search.trim() ? (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                      >
                        Clear search
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={openAdd}
                        className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                      >
                        Create your first folder
                      </button>
                    )
                  }
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                {filteredFolders.map((folder) => {
                  const isDragTarget = dragOverFolder === folder.id;
                  const count = folder.itemCount ?? 0;

                  return (
                    <div
                      key={folder.id}
                      onDragOver={(e) => handleDragOver(e, folder.id)}
                      onDragLeave={(e) => handleDragLeave(e, folder.id)}
                      onDrop={(e) => handleDrop(e, folder)}
                      className={`
                        bg-surface border rounded-2xl p-5 transition-all flex flex-col
                        ${
                          isDragTarget
                            ? "border-primary bg-primary-muted/20 scale-[1.02] shadow-xl shadow-primary/10"
                            : "border-border hover:border-border-hover"
                        }
                      `}
                    >
                      {isDragTarget && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/70 backdrop-blur-sm rounded-2xl animate-fade-in pointer-events-none relative">
                          <div className="bg-primary text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-lg">
                            <CornerRightDown size={18} /> Add to this folder
                          </div>
                        </div>
                      )}

                      <div className="flex items-start justify-between mb-4">
                        <button
                          type="button"
                          onClick={() => navigate(`/folders/${folder.id}`)}
                          aria-label={`Open folder ${folder.name}`}
                          className="w-12 h-12 rounded-xl bg-primary-muted flex items-center justify-center shrink-0 hover:bg-primary/20 transition-colors cursor-pointer"
                        >
                          <FolderOpen size={24} className="text-primary" />
                        </button>
                        {/* Always visible — these were hover-only, so they were
                            invisible to touch users and easy to miss. */}
                        <div className="flex items-center gap-1">
                          <IconButton
                            label={`Rename ${folder.name}`}
                            size="sm"
                            tooltipPlacement="top-end"
                            icon={<Pencil size={15} />}
                            onClick={() => openEdit(folder)}
                          />
                          <IconButton
                            label={`Delete ${folder.name}`}
                            size="sm"
                            tooltipPlacement="top-end"
                            variant="danger"
                            icon={<Trash2 size={15} />}
                            onClick={() => handleDelete(folder)}
                          />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-bold text-text mb-1.5 truncate" title={folder.name}>
                          {folder.name}
                        </h3>
                        <p className="text-[13px] text-text-muted font-medium flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-md bg-surface-hover text-text">
                            {count} item{count === 1 ? "" : "s"}
                          </span>
                          <span className="text-xs">
                            {new Date(folder.created_at).toLocaleDateString()}
                          </span>
                        </p>
                        {count === 0 && (
                          <p className="text-xs text-text-muted/70 mt-1.5">
                            Empty — drag items up from the library
                          </p>
                        )}
                      </div>

                      {/* A real link, not a button that calls navigate(). Opening a
                          folder is navigation, so it should behave like it: middle
                          click and ⌘-click open a new tab, the address can be
                          copied, and it shows up in browser history the way a link
                          does. */}
                      <Link
                        to={`/folders/${folder.id}`}
                        className="mt-4 w-full py-2.5 rounded-xl bg-surface-hover/50 hover:bg-primary hover:text-white text-sm font-bold text-text transition-colors flex items-center justify-center gap-2"
                      >
                        Open Folder <ChevronRight size={16} />
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="h-px bg-border/50" />

          {/* ── Item library ── */}
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-text">Item Library</h2>
              <p className="text-sm text-text-muted mt-1">
                Every record in the system. Drag a row onto a folder above, or open it to manage it.
              </p>
            </div>

            <div className="flex flex-col lg:flex-row gap-4">
              <SearchInput
                value={itemsSearch}
                onChange={setItemsSearch}
                scope="library items"
                resultCount={filteredItems.length}
                totalCount={availableItems.length}
                placeholder="Search the library…"
                className="flex-1 lg:max-w-md"
              />

              <div
                className="flex items-center gap-1.5 bg-surface border border-border rounded-xl p-1.5 overflow-x-auto scrollbar-none"
                role="group"
                aria-label="Filter library by type"
              >
                {ITEM_FILTERS.map((type) => {
                  const active = itemsFilter === type;
                  const n = type === "all" ? availableItems.length : itemCountsByType.get(type) ?? 0;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setItemsFilter(type)}
                      aria-pressed={active}
                      className={`px-3.5 py-2 rounded-lg text-[13px] font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                        active
                          ? "bg-primary text-white"
                          : "text-text-muted hover:text-text hover:bg-surface-hover"
                      }`}
                    >
                      {type === "all" ? "All Items" : getItemTypeLabel(type)}
                      <span className={active ? "opacity-80" : "opacity-60"}>({n})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              ref={libraryRef}
              className="bg-surface border border-border rounded-2xl overflow-hidden flex flex-col"
            >
              <InlineRefreshBar show={refreshing} />

              {filteredItems.length === 0 ? (
                <EmptyState
                  icon={<Package size={24} />}
                  title={
                    availableItems.length === 0
                      ? "The library is empty"
                      : "No items match"
                  }
                  description={
                    availableItems.length === 0
                      ? "Jobs, stock, bills and drawings appear here as soon as they are created. Import an Excel file or add stock to get started."
                      : itemsSearch.trim()
                        ? `Nothing matches “${itemsSearch.trim()}”${
                            itemsFilter !== "all" ? ` in ${getItemTypeLabel(itemsFilter)}` : ""
                          }.`
                        : `There are no ${getItemTypeLabel(
                            itemsFilter as FolderItemType
                          ).toLowerCase()} records yet.`
                  }
                  action={
                    itemsSearch.trim() || itemsFilter !== "all" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setItemsSearch("");
                          setItemsFilter("all");
                        }}
                        className="px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                      >
                        Reset filters
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <div className="overflow-auto scrollbar-thin table-scroll">
                    <table className="w-full min-w-[34rem]">
                      <thead className="sticky-head">
                        <tr className="border-b border-border">
                          <th className="w-9" />
                          <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">
                            Type
                          </th>
                          <th className="text-left text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3">
                            Identifier / Name
                          </th>
                          <th className="text-right text-[12px] font-bold text-text-muted uppercase tracking-[0.1em] px-4 py-3 w-[9rem]">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {pageItems.map((item) => (
                          <tr
                            key={`${item.type}-${item.id}`}
                            className="hover:bg-surface-hover/30 transition-colors"
                          >
                            <td className="px-2 py-3">
                              {/* Drag handle doubles as the accessible label
                                  for the drag source. */}
                              <span
                                draggable
                                onDragStart={(e) => handleDragStart(e, item)}
                                onDragEnd={() => setDraggedItem(null)}
                                title="Drag onto a folder to add it"
                                aria-label={`Drag ${item.label} to a folder`}
                                role="button"
                                tabIndex={-1}
                                className="inline-flex cursor-grab active:cursor-grabbing text-text-muted/50 hover:text-text transition-colors"
                              >
                                <GripVertical size={16} />
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-bg border border-border flex items-center justify-center shrink-0">
                                  {getItemIcon(item.type)}
                                </div>
                                <span className="text-[13px] font-bold text-text-muted">
                                  {getItemTypeLabel(item.type)}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm font-bold text-text">{item.label}</span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setPreviewItem(item)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border text-xs font-bold text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
                                >
                                  Details
                                </button>
                                {/* Jumps to the record's own page, so it is a link. */}
                                <Link
                                  to={itemRoute[item.type].path}
                                  title={`Go to ${getItemTypeLabel(item.type).toLowerCase()}`}
                                  aria-label={`Go to ${getItemTypeLabel(item.type).toLowerCase()}`}
                                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-surface border border-border text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
                                >
                                  <ExternalLink size={14} />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    {...itemPagination}
                    itemLabel="library items"
                    scrollTargetRef={libraryRef}
                  />
                </>
              )}
            </div>

            {draggedItem && (
              <p
                className="text-sm text-text-muted flex items-center gap-2"
                role="status"
                aria-live="polite"
              >
                <AlertTriangle size={15} className="text-warning" />
                Dragging “{draggedItem.label}” — drop it on a folder above to add it.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Create / rename dialog ── */}
      <Modal
        open={showFormModal}
        onClose={() => !formLoading && setShowFormModal(false)}
        size="md"
        title={editingFolder ? "Rename Folder" : "New Folder"}
        subtitle={
          editingFolder
            ? `Currently “${editingFolder.name}”`
            : "A general folder can hold any type of item."
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowFormModal(false)}
              disabled={formLoading}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={formLoading}
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              {formLoading && <Loader2 size={16} className="animate-spin" />}
              {formLoading
                ? "Saving…"
                : editingFolder
                  ? "Save Changes"
                  : "Create Folder"}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <label
            htmlFor="folder-name"
            className="block text-xs font-semibold text-text-secondary mb-1.5"
          >
            Folder name <span className="text-danger">*</span>
          </label>
          <input
            id="folder-name"
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="e.g. March 2026 — Client Order"
            required
            className={inputCls}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? "folder-name-error" : undefined}
          />
          {formError && (
            <p id="folder-name-error" role="alert" className="text-sm text-danger mt-2">
              {formError}
            </p>
          )}
          <p className="text-xs text-text-muted mt-3">
            {editingFolder
              ? "Renaming does not change anything inside the folder."
              : "The folder is created empty. Add items from the library below, or from the folder itself."}
          </p>
        </form>
      </Modal>

      {/* ── Item details ── */}
      <Modal
        open={!!previewItem}
        onClose={() => setPreviewItem(null)}
        size="sm"
        title={previewItem ? getItemTypeLabel(previewItem.type) : "Item"}
        subtitle="Details for this library item"
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
    </div>
  );
}
