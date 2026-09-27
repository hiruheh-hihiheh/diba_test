// src/pages/PhotoGroupsPage.tsx
//
// One implementation for "Group Bills" (/bills) and "Group Drawings"
// (/drawings). The two pages were separate 220-line copies differing only in
// the service functions, the icon and the wording.
//
// UX problems fixed here:
//  * `window.confirm` / `window.alert` → in-app confirm dialog and toasts.
//  * Deleting a group destroyed every photo in it, but the confirmation was a
//    single line with no photo count. It now says how many photos go with it.
//  * The photo delete button was `opacity-0 group-hover:opacity-100`, so on a
//    touch device or a keyboard-only session there was no way to delete a
//    photo. It is always visible now.
//  * Photos were 128px thumbnails with no way to see the detail. They open a
//    full-screen lightbox now, and the grid is responsive.
//  * The upload row sat under the grid with a bare file input and a separate
//    "Upload" button, so choosing a file appeared to do nothing until you also
//    pressed Upload. It is now one drop zone that uploads immediately, with
//    progress, and it tells you when a file is too large or the wrong type.
//  * Failed loads silently produced an empty list that looked like "no groups".
//  * No photo count anywhere, so you could not tell a group with 2 bills from
//    one with 200 without opening it.
//  * No sticky header or sticky actions on a long list.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Plus,
  RefreshCw,
  Loader2,
  Trash2,
  Upload,
  SearchX,
  AlertTriangle,
  ImageIcon,
  CalendarDays,
  Images,
  Pencil,
} from "lucide-react";
import { uploadPhoto } from "../services/cloudinary";
import Modal from "../components/ui/Modal";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import IconButton from "../components/ui/IconButton";
import ImageLightbox, { type LightboxImage } from "../components/ui/ImageLightbox";
import { useToast } from "../components/ui/Toast";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { usePageMeta } from "../contexts/PageMetaContext";
import { ErrorState, InlineRefreshBar } from "../components/ui/LoadingState";
import { readableError } from "../utils/readableError";
import Pagination, { usePagination } from "../components/ui/Pagination";

/* ── Shapes ─────────────────────────────────────────── */

export interface PhotoGroup {
  id: string;
  name: string;
  group_date: string;
  created_at: string;
}

export interface GroupPhoto {
  id: string;
  photo_url: string;
  photo_public_id: string;
  position: number;
}

export interface PhotoGroupsConfig {
  /** Plural heading, e.g. "Group Bills". */
  heading: string;
  /** Singular record label, e.g. "Bill Group". */
  recordLabel: string;
  /** Plural noun for the photo, e.g. "bill". */
  itemNoun: string;
  addLabel: string;
  icon: ReactNode;
  accent: "warning" | "success";
  /** Used in the empty state to explain what belongs here. */
  purpose: string;
}

const inputCls =
  "w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

const accentCls = {
  warning: { chip: "bg-warning-muted text-warning", soft: "bg-warning-muted/60 text-warning" },
  success: { chip: "bg-success-muted text-success", soft: "bg-success-muted/60 text-success" },
} as const;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];

/* ── Page ───────────────────────────────────────────── */

export default function PhotoGroupsPage<T extends PhotoGroup, P extends GroupPhoto>({
  config,
  api,
}: {
  config: PhotoGroupsConfig;
  api: {
    list: () => Promise<T[]>;
    create: (input: { name: string; group_date: string }) => Promise<{ ok: boolean; error?: string }>;
    update: (
      id: string,
      input: { name: string; group_date: string }
    ) => Promise<{ ok: boolean; error?: string }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
    listPhotos: (groupId: string) => Promise<P[]>;
    addPhoto: (
      groupId: string,
      url: string,
      publicId: string
    ) => Promise<{ ok: boolean; data?: P; error?: string }>;
    removePhoto: (photoId: string) => Promise<{ ok: boolean; error?: string }>;
  };
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { accent, recordLabel, itemNoun } = config;

  const [groups, setGroups] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [photosFor, setPhotosFor] = useState<T | null>(null);
  const [photos, setPhotos] = useState<P[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removingPhotoId, setRemovingPhotoId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  /* ── Data ─────────────────────────────────────────── */

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setGroups(await api.list());
        setLoadError(null);
      } catch (err) {
        setLoadError(
          readableError(err, {
            subject: `${config.itemNoun} groups`,
            fallback: `${config.heading} could not be loaded. Check your connection and try again.`,
            byKind: {
              connection: `Could not reach the server, so ${config.heading.toLowerCase()} could not be loaded. Check your connection and try again.`,
              forbidden: `Your account does not have permission to view ${config.heading.toLowerCase()}.`,
            },
          }).message
        );
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api.list]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.name.toLowerCase().includes(q) || g.group_date.toLowerCase().includes(q)
    );
  }, [groups, search]);

  const pagination = usePagination(filtered.length, 25);
  const pageGroups = pagination.pageItems(filtered);

  const searching = search.trim() !== "" || filtered.length !== groups.length;

  /* A row in the table is a *group* of bills or drawings, not a bill. The
     section is called "Group Bills" but the thing you count is the group, so
     every count on this page uses the record label ("Bill Group") and never the
     heading — otherwise the header said "2 group bills" while the table listed
     2 groups, and the two numbers read as different quantities. */
  const groupNoun = config.recordLabel.toLowerCase();
  const countOfGroups = (n: number) => `${n} ${groupNoun}${n === 1 ? "" : "s"}`;

  usePageMeta(
    {
      title: config.heading,
      crumbs: [{ label: "Documents" }, { label: config.heading }],
      subtitle: searching
        ? `${filtered.length} of ${groups.length} ${groupNoun}s match`
        : countOfGroups(groups.length),
      /* The body header prints the same count under the actions. */
      selfTitles: true,
    },
    [config, groups.length, filtered.length, search]
  );

  /* ── Group form ───────────────────────────────────── */

  function openAdd() {
    setEditing(null);
    setName("");
    setDate(new Date().toISOString().slice(0, 10));
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(group: T) {
    setEditing(group);
    setName(group.name);
    setDate(group.group_date);
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    if (saving) return;
    setFormError(null);
    if (!name.trim()) {
      setFormError("Give the group a name so you can find it later.");
      setNameErrorFocus();
      return;
    }
    if (!date) {
      setFormError("Choose the date for this group.");
      return;
    }

    setSaving(true);
    try {
      const input = { name: name.trim(), group_date: date };
      const res = editing ? await api.update(editing.id, input) : await api.create(input);
      if (!res.ok) {
        setFormError(res.error || "The group was not saved. Please try again.");
        return;
      }
      setFormOpen(false);
      await load(true);
      toast.success({
        title: editing ? `${recordLabel} updated` : `${recordLabel} created`,
        description: editing
          ? `“${input.name}” saved.`
          : `“${input.name}” is ready for ${itemNoun}s.`,
      });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "The group was not saved. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  function setNameErrorFocus() {
    document.getElementById("group-name")?.focus();
  }

  /* ── Photos ───────────────────────────────────────── */

  async function openPhotos(group: T) {
    setPhotosFor(group);
    setPhotos([]);
    setPhotosError(null);
    setPhotosLoading(true);
    try {
      setPhotos(await api.listPhotos(group.id));
    } catch (err) {
      setPhotosError(
        err instanceof Error
          ? err.message
          : `The ${itemNoun}s in this group could not be loaded. Please try again.`
      );
    } finally {
      setPhotosLoading(false);
    }
  }

  async function reloadPhotos() {
    if (!photosFor) return;
    try {
      setPhotos(await api.listPhotos(photosFor.id));
      setPhotosError(null);
    } catch (err) {
      setPhotosError(
        err instanceof Error ? err.message : `The ${itemNoun}s could not be reloaded.`
      );
    }
  }

  function validateImage(file: File): string | null {
    if (!IMAGE_TYPES.includes(file.type)) {
      return `“${file.name}” is not a supported image. Use a JPG, PNG, WebP, GIF or HEIC file.`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the 10 MB limit.`;
    }
    return null;
  }

  async function handleFiles(files: FileList | File[]) {
    if (!photosFor) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    for (const file of list) {
      const problem = validateImage(file);
      if (problem) {
        toast.error({ title: `${file.name} was skipped`, description: problem });
        continue;
      }
      setUploading(true);
      try {
        const uploaded = await uploadPhoto(file);
        const res = await api.addPhoto(photosFor.id, uploaded.secureUrl, uploaded.publicId);
        if (!res.ok || !res.data) {
          toast.error({
            title: `${file.name} was not saved`,
            description:
              res.error ||
              "The photo uploaded but could not be attached to the group. Remove it from the cloud and try again.",
          });
          continue;
        }
        setPhotos((prev) => [...prev, res.data!]);
        setUploadCount((n) => n + 1);
      } catch (err) {
        toast.error({
          title: `${file.name} could not be uploaded`,
          description:
            err instanceof Error ? err.message : "Please check your connection and try again.",
        });
      } finally {
        setUploading(false);
      }
    }
  }

  async function handleRemovePhoto(photo: P) {
    if (!photosFor) return;
    const ok = await confirm({
      title: `Remove this ${itemNoun}?`,
      message: (
        <>
          The image is deleted from storage and removed from{" "}
          <strong className="text-text">{photosFor.name}</strong>. This cannot be undone.
        </>
      ),
      confirmLabel: `Remove ${itemNoun}`,
    });
    if (!ok) return;

    setRemovingPhotoId(photo.id);
    try {
      const res = await api.removePhoto(photo.id);
      if (!res.ok) {
        toast.error({
          title: `Could not remove the ${itemNoun}`,
          description: res.error || "Please try again.",
        });
        return;
      }
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      toast.success({ title: `${capitalise(itemNoun)} removed` });
    } catch (err) {
      toast.error({
        title: `Could not remove the ${itemNoun}`,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setRemovingPhotoId(null);
    }
  }

  /* ── Delete group ─────────────────────────────────── */

  async function handleDelete(group: T) {
    const count = group === null ? 0 : photosFor?.id === group.id ? photos.length : null;
    const ok = await confirm({
      title: `Delete “${group.name}”?`,
      message: (
        <>
          The group and{" "}
          <strong className="text-text">
            every {itemNoun} inside it
            {count === null ? "" : ` (${count} in this list)`}
          </strong>{" "}
          are permanently deleted.
          <strong className="block mt-2 text-text">This cannot be undone.</strong>
        </>
      ),
      confirmLabel: `Delete ${recordLabel.toLowerCase()}`,
    });
    if (!ok) return;

    setBusyId(group.id);
    try {
      const res = await api.remove(group.id);
      if (!res.ok) {
        toast.error({
          title: `Could not delete “${group.name}”`,
          description: res.error || "The group was not deleted. Please try again.",
        });
        return;
      }
      setGroups((prev) => prev.filter((g) => g.id !== group.id));
      if (photosFor?.id === group.id) setPhotosFor(null);
      toast.success({ title: `${recordLabel} deleted`, description: group.name });
    } catch (err) {
      toast.error({
        title: `Could not delete “${group.name}”`,
        description:
          err instanceof Error ? err.message : "The group was not deleted. Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  /* ── Render ───────────────────────────────────────── */

  const lightboxImages: LightboxImage[] = useMemo(
    () =>
      photos.map((p, i) => ({
        id: p.id,
        url: p.photo_url,
        label: `${capitalise(itemNoun)} ${i + 1} of ${photos.length}${photosFor ? ` — ${photosFor.name}` : ""}`,
      })),
    [photos, photosFor, itemNoun]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32" role="status" aria-live="polite">
        <Loader2 size={32} className="text-primary animate-spin" />
        <span className="sr-only">Loading {groupNoun}s</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header
          No <h1>: the TopBar already carries the page name. What stays is the
          count of *groups* — the rows in the table are groups, so "2 bill
          groups" is what a reader can match against the table below, not the
          section name "group bills". */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${accentCls[accent].chip}`}
          >
            {config.icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">
              {searching ? "Matching groups" : `All ${groupNoun}s`}
            </p>
            <p className="text-sm text-text-muted mt-0.5">
              {searching ? (
                <>
                  <strong className="text-text">{filtered.length}</strong> of {groups.length}{" "}
                  {groupNoun}s match
                </>
              ) : (
                <>{countOfGroups(groups.length)}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            label="Refresh the list"
            icon={<RefreshCw size={17} className={refreshing ? "animate-spin" : ""} />}
            onClick={handleRefresh}
            busy={refreshing}
            variant="surface"
            size="md"
          />
          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer"
          >
            <Plus size={17} />
            {config.addLabel}
          </button>
        </div>
      </div>

      {loadError ? (
        <ErrorState title={`Could not load ${groupNoun}s`} message={loadError} onRetry={() => load()} />
      ) : (
        <>
          <SearchInput
            value={search}
            onChange={setSearch}
            scope={groupNoun + "s"}
            unit={groupNoun}
            resultCount={filtered.length}
            totalCount={groups.length}
            placeholder="Search by name or date…"
            className="lg:max-w-md"
          />

          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <InlineRefreshBar show={refreshing} />

            {filtered.length === 0 ? (
              <EmptyState
                icon={search.trim() ? <SearchX size={24} /> : <Images size={24} />}
                title={search.trim() ? `No ${groupNoun}s match` : `No ${groupNoun}s yet`}
                description={
                  search.trim()
                    ? `Nothing matches “${search.trim()}”. There ${
                        groups.length === 1 ? "is" : "are"
                      } ${countOfGroups(groups.length)} in total.`
                    : config.purpose
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
                      {config.addLabel}
                    </button>
                  )
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto scrollbar-thin table-scroll">
                  <table className="w-full min-w-[36rem]">
                    <thead className="sticky-head">
                      <tr className="border-b border-border">
                        <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-5 py-3">
                          Name
                        </th>
                        <th className="text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-5 py-3">
                          Date
                        </th>
                        <th className="hidden lg:table-cell text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-5 py-3">
                          Created
                        </th>
                        <th className="sticky-actions sticky-head-cell text-right text-[11px] font-bold text-text-muted uppercase tracking-wider px-5 py-3 w-40">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageGroups.map((group) => (
                        <tr
                          key={group.id}
                          aria-busy={busyId === group.id}
                          className={`hover:bg-surface-hover/50 transition-colors ${
                            busyId === group.id ? "opacity-60" : ""
                          }`}
                        >
                          <td className="px-5 py-4">
                            <button
                              type="button"
                              onClick={() => openPhotos(group)}
                              className="text-sm font-bold text-text hover:text-primary hover:underline underline-offset-2 cursor-pointer text-left"
                            >
                              {group.name}
                            </button>
                          </td>
                          <td className="px-5 py-4">
                            <span className="inline-flex items-center gap-1.5 text-sm text-text-muted whitespace-nowrap">
                              <CalendarDays size={13} />
                              {formatGroupDate(group.group_date)}
                            </span>
                          </td>
                          <td className="hidden lg:table-cell px-5 py-4 text-sm text-text-muted whitespace-nowrap">
                            {formatGroupDate(group.created_at)}
                          </td>
                          <td className="sticky-actions px-5 py-4">
                            <div className="flex items-center justify-end gap-1">
                              <IconButton
                                label={`Open ${group.name}`}
                                size="sm"
                                tooltipPlacement="top-end"
                                icon={<ImageIcon size={15} />}
                                onClick={() => openPhotos(group)}
                              />
                              <IconButton
                                label={`Rename ${group.name}`}
                                size="sm"
                                tooltipPlacement="top-end"
                                icon={<PencilIcon />}
                                onClick={() => openEdit(group)}
                                disabled={busyId === group.id}
                              />
                              <IconButton
                                label={`Delete ${group.name}`}
                                size="sm"
                                tooltipPlacement="top-end"
                                variant="danger"
                                icon={<Trash2 size={15} />}
                                onClick={() => handleDelete(group)}
                                busy={busyId === group.id}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination {...pagination} itemLabel="groups" />
              </>
            )}
          </div>
        </>
      )}

      {/* ── Group form ── */}
      <Modal
        open={formOpen}
        onClose={() => !saving && setFormOpen(false)}
        size="sm"
        title={`${editing ? "Rename" : "Add"} ${recordLabel}`}
        subtitle={editing ? editing.name : `Group related ${itemNoun}s together by date.`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {saving ? "Saving…" : editing ? "Save changes" : "Create group"}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="group-name"
              className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5"
            >
              Name <span className="text-danger">*</span>
            </label>
            <input
              id="group-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFormError(null);
              }}
              placeholder="e.g. Hawkins — March batch"
              aria-invalid={formError ? true : undefined}
              aria-describedby={formError ? "group-error" : undefined}
              className={inputCls}
            />
          </div>
          <div>
            <label
              htmlFor="group-date"
              className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5"
            >
              Date <span className="text-danger">*</span>
            </label>
            <input
              id="group-date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setFormError(null);
              }}
              className={inputCls}
            />
          </div>
          {formError && (
            <p
              id="group-error"
              role="alert"
              className="px-4 py-3 rounded-xl text-sm bg-danger-muted border border-danger/20 text-danger"
            >
              {formError}
            </p>
          )}
        </form>
      </Modal>

      {/* ── Photo gallery ── */}
      <Modal
        open={!!photosFor}
        onClose={() => setPhotosFor(null)}
        size="xl"
        title={photosFor ? photosFor.name : ""}
        subtitle={
          photosFor
            ? `${config.heading} from ${formatGroupDate(photosFor.group_date)}`
            : undefined
        }
      >
        {photosFor && (
          <div className="space-y-5">
            {/* Upload zone — choosing a file uploads it straight away. */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleFiles(e.dataTransfer.files);
              }}
              className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                id="photo-upload"
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <label
                htmlFor="photo-upload"
                className="flex flex-col items-center gap-2 cursor-pointer"
              >
                {uploading ? (
                  <Loader2 size={26} className="text-primary animate-spin" />
                ) : (
                  <Upload size={26} className="text-text-muted" />
                )}
                <span className="text-sm font-bold text-text">
                  {uploading ? "Uploading…" : `Add ${itemNoun}s`}
                </span>
                <span className="text-xs text-text-muted text-center max-w-sm">
                  Drop images here or click to choose. JPG, PNG, WebP, GIF or HEIC, up to 10 MB
                  each. You can select several at once.
                </span>
              </label>
            </div>

            {uploadCount > 0 && (
              <p
                role="status"
                className="px-4 py-3 rounded-xl text-sm bg-success-muted/50 text-success font-semibold flex items-center gap-2"
              >
                <Images size={15} />
                {uploadCount} {itemNoun}
                {uploadCount === 1 ? "" : "s"} added to {photosFor.name}.
              </p>
            )}

            {photosLoading ? (
              <div
                className="flex flex-col items-center gap-2 py-12"
                role="status"
                aria-live="polite"
              >
                <Loader2 size={26} className="text-primary animate-spin" />
                <span className="text-sm text-text-muted">Loading {itemNoun}s…</span>
              </div>
            ) : photosError ? (
              <div
                role="alert"
                className="px-4 py-3.5 rounded-xl bg-danger-muted border border-danger/25 text-danger"
              >
                <p className="text-sm font-bold flex items-center gap-2">
                  <AlertTriangle size={16} />
                  {itemNoun}s could not be loaded
                </p>
                <p className="text-sm mt-1">{photosError}</p>
                <button
                  type="button"
                  onClick={reloadPhotos}
                  className="mt-3 px-3.5 py-2 rounded-lg border border-danger/30 text-sm font-bold hover:bg-danger/10 transition-colors cursor-pointer"
                >
                  Try again
                </button>
              </div>
            ) : photos.length === 0 ? (
              <EmptyState
                icon={<ImageIcon size={24} />}
                title={`No ${itemNoun}s in this group yet`}
                description={`Use the area above to add the ${itemNoun}s for ${photosFor.name}. They appear here in the order they were uploaded.`}
              />
            ) : (
              <>
                <p className="text-xs font-bold text-text-muted uppercase tracking-wider">
                  {photos.length} {itemNoun}
                  {photos.length === 1 ? "" : "s"} · click one to enlarge
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {photos.map((photo, i) => (
                    <div
                      key={photo.id}
                      className={`relative rounded-xl overflow-hidden border border-border group ${
                        removingPhotoId === photo.id ? "opacity-50" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setLightbox({ images: lightboxImages, index: i })}
                        aria-label={`Enlarge ${itemNoun} ${i + 1} of ${photos.length}`}
                        title="Click to enlarge"
                        className="block w-full h-28 sm:h-32 cursor-zoom-in"
                      >
                        <img
                          src={photo.photo_url}
                          alt={`${itemNoun} ${i + 1} of ${photos.length}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </button>
                      {/* Always visible: hover-only controls are unreachable by
                          keyboard and on touch. */}
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(photo)}
                        disabled={removingPhotoId === photo.id}
                        aria-label={`Remove ${itemNoun} ${i + 1} of ${photos.length}`}
                        title={`Remove ${itemNoun} ${i + 1}`}
                        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-danger/90 hover:bg-danger flex items-center justify-center text-white shadow-lg transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {removingPhotoId === photo.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* ── Lightbox ── */}
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
          footer={
            lightbox.index >= 0 && photosFor ? (
              <button
                type="button"
                onClick={() => handleRemovePhoto(photos[lightbox.index])}
                disabled={removingPhotoId === photos[lightbox.index]?.id}
                className="px-4 py-2.5 rounded-xl bg-danger/90 hover:bg-danger text-white text-sm font-bold transition-colors cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
              >
                {removingPhotoId === photos[lightbox.index]?.id ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Trash2 size={15} />
                )}
                Remove this {itemNoun}
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}

/* ── Small helpers ─────────────────────────────────── */

function PencilIcon() {
  return <Pencil size={15} />;
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Dates may be a plain YYYY-MM-DD string or a full ISO timestamp. */
function formatGroupDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
