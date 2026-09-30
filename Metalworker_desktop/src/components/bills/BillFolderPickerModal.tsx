// src/components/bills/BillFolderPickerModal.tsx
//
// "Add these bills to a folder", reachable from the Bills list and from a bill's
// detail view.
//
// It writes ONE `folder_items` row per bill (item_type 'bill'). The three print
// copies are deliberately not offered separately: a folder holds documents, and
// the copy you want is chosen later, per bill. Adding all three would also make
// the folder's bill count three times the truth.

import { useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";

import Modal from "../ui/Modal";
import SearchInput from "../ui/SearchInput";
import EmptyState from "../ui/EmptyState";
import { ErrorState } from "../ui/LoadingState";
import { useToast } from "../ui/Toast";
import { addMultipleItemsToFolder, fetchFolders } from "../../services/folders";
import type { AdminFolder } from "../../types/folder";

export function BillFolderPickerModal({
  open,
  billIds,
  title,
  onClose,
  onAdded,
}: {
  open: boolean;
  billIds: string[];
  /** What is being added, e.g. "1 bill" or "3 bills". */
  title: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [folders, setFolders] = useState<AdminFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Bumped by "Try again" so the effect below actually refetches. */
  const [reloadToken, setReloadToken] = useState(0);

  /* Reset on open/close during render (React's documented "adjust state when a
     prop changes" pattern) so the effect below never has to call setState
     synchronously, and so reopening the dialog never shows the previous
     search or a folder that is no longer the selection. */
  const [shownOpen, setShownOpen] = useState(open);
  if (open !== shownOpen) {
    setShownOpen(open);
    setFolders([]);
    setSearch("");
    setTarget(null);
    setError(null);
    setLoading(open);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchFolders()
      .then((f) => {
        if (!cancelled) setFolders(f);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Folders could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reloadToken]);

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? folders.filter((f) => f.name.toLowerCase().includes(needle))
    : folders;

  async function confirm() {
    if (!target || saving || billIds.length === 0) return;
    setSaving(true);
    try {
      const res = await addMultipleItemsToFolder(
        target,
        billIds.map((id) => ({ type: "bill" as const, id }))
      );
      if (!res.ok) {
        toast.error({
          title: "The bills were not added",
          description: res.error || "Please try again.",
        });
        return;
      }
      const folder = folders.find((f) => f.id === target);
      toast.success({
        title: `Added to ${folder?.name ?? "folder"}`,
        description: `${billIds.length} ${billIds.length === 1 ? "bill" : "bills"} linked.`,
      });
      onAdded();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Add ${title} to a folder`}
      subtitle="A bill is added once. The original, duplicate and triplicate PDFs stay with it."
      size="lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!target || saving || billIds.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            Add to folder
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-14" role="status" aria-live="polite">
          <Loader2 size={26} className="text-primary animate-spin" />
          <span className="sr-only">Loading folders</span>
        </div>
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null);
            setLoading(true);
            setReloadToken((n) => n + 1);
          }}
          title="Could not load folders"
        />
      ) : (
        <div className="space-y-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            scope="folders"
            unit="folder"
            resultCount={visible.length}
            totalCount={folders.length}
            placeholder="Search folders…"
            autoFocus
          />

          {visible.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<FolderOpen size={22} />}
              title={needle ? "No folder matches" : "No folders yet"}
              description={
                needle
                  ? `Nothing matches “${search.trim()}”.`
                  : "Create a folder on the Folders page first, then add bills to it."
              }
            />
          ) : (
            <ul className="space-y-1.5 max-h-[22rem] overflow-y-auto scrollbar-thin">
              {visible.map((folder) => {
                const selected = target === folder.id;
                return (
                  <li key={folder.id}>
                    <button
                      type="button"
                      onClick={() => setTarget(folder.id)}
                      aria-pressed={selected}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        selected
                          ? "border-primary bg-primary-muted"
                          : "border-border hover:bg-surface-hover"
                      }`}
                    >
                      <FolderOpen
                        size={17}
                        className={selected ? "text-primary shrink-0" : "text-text-muted shrink-0"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-text truncate">{folder.name}</span>
                        <span className="block text-xs text-text-muted">
                          {folder.itemCount ?? 0} items
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
