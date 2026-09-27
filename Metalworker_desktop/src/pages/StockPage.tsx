// src/pages/StockPage.tsx
//
// One implementation for "Stock by Owner" (/stock/owner) and "Stock by Company"
// (/stock/company). The two pages were separate 240-line copies that differed
// only in their field list and labels; keeping them in sync by hand meant small
// improvements repeatedly landed on one page only.
//
// Field sets, search behaviour, record fields and the four service calls are
// passed in from OwnerStock.tsx / CompanyStock.tsx, so the data layer is
// untouched.
//
// UX problems fixed here:
//  * `window.alert` / `window.confirm` → in-app confirm dialog and toasts.
//  * A failed fetch silently showed an empty table, indistinguishable from "no
//    records". It now shows an error with a retry, or the create action.
//  * Record count showed the *filtered* count only, so a search made it look
//    like records had been deleted. It now reads "12 of 340 records".
//  * Row icons had `title` attributes but no accessible name, and were not
//    always visible. Now labelled `IconButton`s.
//  * Photo thumbnails were 160px and not openable. They now open a full-screen
//    lightbox.
//  * Success feedback was a bare "Updated." line that auto-closed the dialog
//    after 800ms — too fast to read and easy to miss. Now a toast, and the
//    dialog closes immediately.
//  * Save/delete had no per-row busy state, so double clicks could fire two
//    deletes.
//  * The table had no sticky header or sticky actions, so on a long list the
//    Edit/Delete buttons scrolled out of reach.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Plus,
  RefreshCw,
  Loader2,
  Eye,
  Pencil,
  Trash2,
  Upload,
  SearchX,
  Package,
  AlertTriangle,
  ImageOff,
  ImageIcon,
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

/* ── Config shapes ──────────────────────────────────── */

type Cell = string | number | null | undefined;

export interface StockFieldDef {
  /** Property name on the record / input objects. */
  key: string;
  label: string;
  type?: "text" | "number";
  placeholder?: string;
  /** Short hint shown under the input. */
  help?: string;
}

export interface StockColumnDef {
  header: string;
  cell: (row: Record<string, Cell>) => ReactNode;
  /** Hide on narrow viewports; the value stays in the preview dialog. */
  hideBelow?: "lg" | "xl";
}

interface Row {
  id: string;
  created_at: string;
  drawing_photo_url: string | null;
  metal_photo_url: string | null;
}

export interface StockPageConfig {
  heading: string;
  /** Plural noun for counts and the search scope, e.g. "owner stock records". */
  noun: string;
  /**
   * The same noun in the singular, e.g. "owner stock record". Needed because
   * `noun` is a plural phrase, so the naive `count === 1 ? noun : noun` printed
   * "1 owner stock records" on a list that held exactly one row.
   */
  nounSingular: string;
  icon: ReactNode;
  accent: "primary" | "purple";
  crumbs: { label: string }[];
  /** Singular label used in dialog titles, e.g. "Owner Stock". */
  recordLabel: string;
  addLabel: string;
  fields: StockFieldDef[];
  columns: StockColumnDef[];
  /** Short human label for a record, used in toasts, dialog titles and the
      delete confirmation, e.g. the source of the metal. */
  describe: (row: Record<string, Cell>) => string;
  /** Property names searched by the search box. */
  searchKeys: string[];
  /** Text explaining what this kind of record is for. */
  purpose: string;
}

const inputCls =
  "w-full px-4 py-2.5 rounded-xl bg-bg border border-border text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all";

const accentCls = {
  primary: { chip: "bg-primary-muted text-primary", text: "text-primary" },
  purple: { chip: "bg-purple-muted text-purple", text: "text-purple" },
} as const;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];

/**
 * The record types are interfaces, so they carry no index signature and cannot
 * be handed to the config's accessors directly. Going through `unknown` keeps
 * one cast in one place instead of five.
 */
function asCells<T extends Row>(row: T): Record<string, Cell> {
  return row as unknown as Record<string, Cell>;
}

/**
 * Stock quantities run to six figures or more. "500000" takes a moment to read
 * and is easy to miscount; "500,000" is one glance. Values that are not finite
 * numbers are shown as an em dash rather than "NaN".
 */
export function formatAmount(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN");
}

/* ── Page ────────────────────────────────────────────── */

export default function StockPage<T extends Row>({
  config,
  api,
}: {
  config: StockPageConfig;
  api: {
    list: () => Promise<T[]>;
    create: (input: Record<string, string | number | undefined>) => Promise<{ ok: boolean; error?: string }>;
    update: (
      id: string,
      input: Record<string, string | number | undefined>
    ) => Promise<{ ok: boolean; error?: string }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  };
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<T | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState<T | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [metalFile, setMetalFile] = useState<File | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<"drawing" | "metal" | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  const { accent, noun, nounSingular, recordLabel } = config;

  /* "1 owner stock record" / "4 owner stock records". The config noun is a
     plural phrase, so it cannot be reused for a count of one. */
  const countOf = (n: number) => `${n} ${n === 1 ? nounSingular : noun}`;

  /* ── Data ─────────────────────────────────────────── */

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const list = await api.list();
        setRows(list);
        setLoadError(null);
      } catch (err) {
        setLoadError(
          readableError(err, {
            subject: noun,
            fallback: `The ${noun} could not be loaded. Check your connection and try again.`,
            byKind: {
              connection: `Could not reach the server, so the ${noun} could not be loaded. Check your connection and try again.`,
              forbidden: `Your account does not have permission to view the ${noun}.`,
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
    if (!loadError) {
      toast.info({ title: "List refreshed", description: `${countOf(rows.length)} loaded.` });
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      config.searchKeys.some((k) => String(asCells(r)[k] ?? "").toLowerCase().includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, config.searchKeys]);

  const pagination = usePagination(filtered.length, 25);
  const pageRows = pagination.pageItems(filtered);

  usePageMeta(
    {
      title: config.heading,
      crumbs: config.crumbs,
      subtitle:
        search.trim() || filtered.length !== rows.length
          ? `${filtered.length} of ${rows.length} ${noun} match`
          : countOf(rows.length),
      /* The body header prints the same count under the actions. */
      selfTitles: true,
    },
    [config, rows.length, filtered.length, search, noun]
  );

  /* ── Form ─────────────────────────────────────────── */

  function blankForm(): Record<string, string> {
    const next: Record<string, string> = {};
    for (const f of config.fields) next[f.key] = "";
    return next;
  }

  function openAdd() {
    setEditing(null);
    setForm(blankForm());
    setFormError(null);
    setImageError(null);
    setDrawingFile(null);
    setMetalFile(null);
    setFormOpen(true);
  }

  function openEdit(row: T) {
    setEditing(row);
    const next: Record<string, string> = {};
    for (const f of config.fields) {
      const v = (asCells(row))[f.key];
      next[f.key] = v === null || v === undefined ? "" : String(v);
    }
    setForm(next);
    setFormError(null);
    setImageError(null);
    setDrawingFile(null);
    setMetalFile(null);
    setFormOpen(true);
  }

  function buildInput(): Record<string, string | number | undefined> {
    const out: Record<string, string | number | undefined> = {};
    for (const f of config.fields) {
      const raw = (form[f.key] ?? "").trim();
      if (raw === "") continue;
      out[f.key] = f.type === "number" ? Number(raw) : raw;
    }
    if (drawingUpload?.url) {
      out.drawing_photo_url = drawingUpload.url;
      out.drawing_photo_public_id = drawingUpload.publicId;
    }
    if (metalUpload?.url) {
      out.metal_photo_url = metalUpload.url;
      out.metal_photo_public_id = metalUpload.publicId;
    }
    return out;
  }

  async function handleSave() {
    if (saving) return;
    setFormError(null);
    setImageError(null);

    if (uploadingSlot) {
      setFormError("Wait for the photo upload to finish before saving.");
      return;
    }
    /* Photos staged in the file inputs but not uploaded yet are silently lost
       otherwise, because the form only ever sends what `uploadPhoto` returned. */
    if (drawingFile || metalFile) {
      setFormError("Upload the selected photo before saving, or clear it.");
      return;
    }

    const input = buildInput();

    setSaving(true);
    try {
      const res = editing ? await api.update(editing.id, input) : await api.create(input);
      if (!res.ok) {
        setFormError(res.error || "The record was not saved. Please try again.");
        return;
      }
      setFormOpen(false);
      await load(true);
      toast.success({
        title: editing ? `${recordLabel} updated` : `${recordLabel} added`,
        description: editing
          ? "Your changes have been saved."
          : "The new record is now listed below.",
      });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "The record was not saved. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  /* ── Photo uploads ────────────────────────────────── */

  const [drawingUpload, setDrawingUpload] = useState<{ url: string; publicId: string } | null>(null);
  const [metalUpload, setMetalUpload] = useState<{ url: string; publicId: string } | null>(null);

  function validateImage(file: File, slot: "Drawing" | "Metal") {
    if (!IMAGE_TYPES.includes(file.type)) {
      return `${slot} photos must be a JPG, PNG, WebP, GIF or HEIC image.`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the 10 MB limit.`;
    }
    return null;
  }

  async function handleUpload(slot: "drawing" | "metal") {
    const file = slot === "drawing" ? drawingFile : metalFile;
    if (!file) return;

    const problem = validateImage(file, slot === "drawing" ? "Drawing" : "Metal");
    if (problem) {
      setImageError(problem);
      if (slot === "drawing") setDrawingFile(null);
      else setMetalFile(null);
      return;
    }

    setUploadingSlot(slot);
    setImageError(null);
    try {
      const result = await uploadPhoto(file);
      if (slot === "drawing") {
        setDrawingUpload({ url: result.secureUrl, publicId: result.publicId });
        setDrawingFile(null);
      } else {
        setMetalUpload({ url: result.secureUrl, publicId: result.publicId });
        setMetalFile(null);
      }
    } catch (err) {
      const what = slot === "drawing" ? "Drawing" : "Metal";
      setImageError(
        readableError(err, {
          subject: `the ${what.toLowerCase()} photo`,
          fallback: `The ${what.toLowerCase()} photo could not be uploaded. Please try again.`,
          byKind: {
            connection: `The ${what.toLowerCase()} photo could not be uploaded because the server could not be reached. Check your connection and try again.`,
            forbidden: `Your account does not have permission to upload a ${what.toLowerCase()} photo.`,
          },
        }).message
      );
    } finally {
      setUploadingSlot(null);
    }
  }

  /* ── Delete ───────────────────────────────────────── */

  async function handleDelete(row: T) {
    const name = describe(row);
    const ok = await confirm({
      title: `Delete this ${recordLabel.toLowerCase()}?`,
      message: (
        <>
          <strong className="text-text">{name}</strong> is permanently removed, along with any
          photos attached to it.
          <strong className="block mt-2 text-text">This cannot be undone.</strong>
        </>
      ),
      confirmLabel: "Delete record",
    });
    if (!ok) return;

    setBusyId(row.id);
    try {
      const res = await api.remove(row.id);
      if (!res.ok) {
        toast.error({
          title: `Could not delete ${name}`,
          description: res.error || "The record was not deleted. Please try again.",
        });
        return;
      }
      /* Remove locally instead of re-fetching, so the table does not flash a
         loader and the user keeps their scroll position and page. */
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success({ title: `${recordLabel} deleted`, description: name });
    } catch (err) {
      toast.error({
        title: `Could not delete ${name}`,
        description:
          err instanceof Error ? err.message : "The record was not deleted. Please try again.",
      });
    } finally {
      setBusyId(null);
    }
  }

  function describe(row: T): string {
    const label = config.describe(asCells(row)).trim();
    return label || recordLabel;
  }

  /* ── Photos for the current form / preview ────────── */

  function formImage(slot: "drawing" | "metal"): string | null {
    if (slot === "drawing") return drawingUpload?.url ?? editing?.drawing_photo_url ?? null;
    return metalUpload?.url ?? editing?.metal_photo_url ?? null;
  }

  const previewImages = useMemo<LightboxImage[]>(() => {
    if (!preview) return [];
    const list: LightboxImage[] = [];
    if (preview.drawing_photo_url) {
      list.push({ id: `${preview.id}-d`, url: preview.drawing_photo_url, label: "Drawing photo" });
    }
    if (preview.metal_photo_url) {
      list.push({ id: `${preview.id}-m`, url: preview.metal_photo_url, label: "Metal photo" });
    }
    return list;
  }, [preview]);

  /* ── Render ───────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32" role="status" aria-live="polite">
        <Loader2 size={32} className="text-primary animate-spin" />
        <span className="sr-only">Loading {noun}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header
          No <h1>: the TopBar already shows the page name, so repeating it here
          made the screen read as double-titled. The count stays because it is
          the only place that reacts to the search box. */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${accentCls[accent].chip}`}
          >
            {config.icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">
              {search.trim() || filtered.length !== rows.length
                ? "Matching records"
                : `All ${noun}`}
            </p>
            <p className="text-sm text-text-muted mt-0.5">
              {search.trim() || filtered.length !== rows.length ? (
                <>
                  <strong className="text-text">{filtered.length}</strong> of {rows.length} {noun}{" "}
                  match
                </>
              ) : (
                <>{countOf(rows.length)}</>
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
        <ErrorState
          title={`Could not load ${noun}`}
          message={loadError}
          onRetry={() => load()}
        />
      ) : (
        <>
          <SearchInput
            value={search}
            onChange={setSearch}
            scope={noun}
            unit={nounSingular}
            resultCount={filtered.length}
            totalCount={rows.length}
            placeholder={`Search ${noun}…`}
            className="lg:max-w-md"
          />

          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <InlineRefreshBar show={refreshing} />

            {filtered.length === 0 ? (
              <EmptyState
                icon={search.trim() ? <SearchX size={24} /> : <Package size={24} />}
                title={search.trim() ? `No ${noun} match` : `No ${noun} yet`}
                description={
                  search.trim()
                    ? `Nothing matches “${search.trim()}”. There ${rows.length === 1 ? "is" : "are"} ${countOf(rows.length)} in total.`
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
                  <table className="w-full min-w-[40rem]">
                    <thead className="sticky-head">
                      <tr className="border-b border-border">
                        {config.columns.map((c) => (
                          <th
                            key={c.header}
                            className={`text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-5 py-3 ${
                              c.hideBelow === "lg"
                                ? "hidden lg:table-cell"
                                : c.hideBelow === "xl"
                                  ? "hidden xl:table-cell"
                                  : ""
                            }`}
                          >
                            {c.header}
                          </th>
                        ))}
                        <th className="hidden xl:table-cell text-left text-[11px] font-bold text-text-muted uppercase tracking-wider px-5 py-3">
                          Photos
                        </th>
                        <th className="sticky-actions sticky-head-cell text-right text-[11px] font-bold text-text-muted uppercase tracking-wider px-5 py-3 w-36">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageRows.map((row) => {
                        const imgs: LightboxImage[] = [];
                        if (row.drawing_photo_url) {
                          imgs.push({ id: `${row.id}-d`, url: row.drawing_photo_url, label: "Drawing" });
                        }
                        if (row.metal_photo_url) {
                          imgs.push({ id: `${row.id}-m`, url: row.metal_photo_url, label: "Metal" });
                        }
                        return (
                          <tr
                            key={row.id}
                            aria-busy={busyId === row.id}
                            className={`hover:bg-surface-hover/50 transition-colors ${
                              busyId === row.id ? "opacity-60" : ""
                            }`}
                          >
                            {config.columns.map((c) => (
                              <td
                                key={c.header}
                                className={`px-5 py-4 text-sm ${
                                  c.hideBelow === "lg"
                                    ? "hidden lg:table-cell"
                                    : c.hideBelow === "xl"
                                      ? "hidden xl:table-cell"
                                      : ""
                                }`}
                              >
                                {c.cell(asCells(row))}
                              </td>
                            ))}
                            <td className="hidden xl:table-cell px-5 py-4">
                              <div className="flex gap-1.5">
                                {imgs.length === 0 ? (
                                  <span className="text-xs text-text-muted inline-flex items-center gap-1">
                                    <ImageOff size={13} />
                                    None
                                  </span>
                                ) : (
                                  imgs.map((img) => (
                                    <button
                                      key={img.id}
                                      type="button"
                                      onClick={() => setLightbox({ images: imgs, index: imgs.indexOf(img) })}
                                      aria-label={`Open ${img.label.toLowerCase()} photo`}
                                      title={`Open ${img.label.toLowerCase()} photo`}
                                      className="w-9 h-9 rounded-lg object-cover border border-border hover:border-primary transition-colors cursor-pointer overflow-hidden"
                                    >
                                      <img src={img.url} alt="" className="w-full h-full object-cover" />
                                    </button>
                                  ))
                                )}
                              </div>
                            </td>
                            <td className="sticky-actions px-5 py-4">
                              <div className="flex items-center justify-end gap-1">
                                <IconButton
                                  label={`Preview ${describe(row)}`}
                                  size="sm"
                                  tooltipPlacement="top-end"
                                  icon={<Eye size={15} />}
                                  onClick={() => setPreview(row)}
                                />
                                <IconButton
                                  label={`Edit ${describe(row)}`}
                                  size="sm"
                                  tooltipPlacement="top-end"
                                  icon={<Pencil size={15} />}
                                  onClick={() => openEdit(row)}
                                  disabled={busyId === row.id}
                                />
                                <IconButton
                                  label={`Delete ${describe(row)}`}
                                  size="sm"
                                  tooltipPlacement="top-end"
                                  variant="danger"
                                  icon={<Trash2 size={15} />}
                                  onClick={() => handleDelete(row)}
                                  busy={busyId === row.id}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination {...pagination} itemLabel="records" />
              </>
            )}
          </div>
        </>
      )}

      {/* ── Add / edit ── */}
      <Modal
        open={formOpen}
        onClose={() => !saving && setFormOpen(false)}
        size="xl"
        title={`${editing ? "Edit" : "Add"} ${recordLabel}`}
        subtitle={editing ? describe(editing) : "Fields marked * are required."}
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
              disabled={saving || uploadingSlot !== null}
              className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center gap-2"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {saving ? "Saving…" : editing ? "Save changes" : config.addLabel}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {config.fields.map((f) => (
              <div key={f.key}>
                <label
                  htmlFor={`stock-${f.key}`}
                  className="block text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5"
                >
                  {f.label}
                </label>
                <input
                  id={`stock-${f.key}`}
                  type={f.type === "number" ? "number" : "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) => {
                    setForm((p) => ({ ...p, [f.key]: e.target.value }));
                    setFormError(null);
                  }}
                  placeholder={f.placeholder}
                  className={inputCls}
                />
                {f.help && <p className="text-xs text-text-muted mt-1.5">{f.help}</p>}
              </div>
            ))}
          </div>

          {/* Photos */}
          <fieldset className="border-t border-border pt-4">
            <legend className="sr-only">Photos</legend>
            <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-3">
              Photos
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(["drawing", "metal"] as const).map((slot) => {
                const url = formImage(slot);
                const pending = slot === "drawing" ? drawingFile : metalFile;
                const busy = uploadingSlot === slot;
                return (
                  <div key={slot}>
                    <p className="text-xs font-semibold text-text-muted mb-1.5">
                      {slot === "drawing" ? "Drawing Photo" : "Metal Photo"}
                    </p>
                    <div className="flex items-center gap-3">
                      {url ? (
                        <img
                          src={url}
                          alt={slot === "drawing" ? "Drawing" : "Metal"}
                          className="w-16 h-16 rounded-lg object-cover border border-border shrink-0"
                        />
                      ) : (
                        <span
                          className="w-16 h-16 rounded-lg border border-dashed border-border flex items-center justify-center text-text-muted/40 shrink-0"
                          aria-hidden="true"
                        >
                          <ImageIcon size={18} />
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <input
                          type="file"
                          accept="image/*"
                          aria-label={`Choose ${slot} photo`}
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            if (slot === "drawing") setDrawingFile(f);
                            else setMetalFile(f);
                            if (slot === "drawing") setDrawingUpload(null);
                            else setMetalUpload(null);
                            setImageError(null);
                          }}
                          className="block w-full text-xs text-text-muted file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border file:bg-bg file:text-xs file:font-semibold file:text-text file:cursor-pointer"
                        />
                        {pending && (
                          <button
                            type="button"
                            onClick={() => handleUpload(slot)}
                            disabled={busy}
                            className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
                          >
                            {busy ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Upload size={12} />
                            )}
                            {busy ? "Uploading…" : "Upload photo"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {imageError && (
              <p
                role="alert"
                className="mt-3 px-3.5 py-2.5 rounded-lg text-xs bg-danger-muted border border-danger/20 text-danger flex items-start gap-2"
              >
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                {imageError}
              </p>
            )}
          </fieldset>

          {formError && (
            <p
              role="alert"
              className="px-4 py-3 rounded-xl text-sm bg-danger-muted border border-danger/20 text-danger"
            >
              {formError}
            </p>
          )}
        </div>
      </Modal>

      {/* ── Preview ── */}
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        size="lg"
        title={preview ? describe(preview) : recordLabel}
        subtitle={recordLabel}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                const row = preview;
                setPreview(null);
                if (row) openEdit(row);
              }}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                const row = preview;
                setPreview(null);
                if (row) openAdd();
              }}
              className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors cursor-pointer"
            >
              Add another
            </button>
          </>
        }
      >
        {preview && (
          <div className="space-y-5">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {config.fields.map((f) => {
                const v = asCells(preview)[f.key];
                return (
                  <div key={f.key} className="min-w-0">
                    <dt className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                      {f.label}
                    </dt>
                    <dd className="text-sm font-medium text-text mt-0.5 break-words">
                      {v === null || v === undefined || v === "" ? "—" : String(v)}
                    </dd>
                  </div>
                );
              })}
            </dl>

            {previewImages.length > 0 ? (
              <div className="border-t border-border pt-4">
                <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-3">
                  Photos
                </p>
                <div className="flex flex-wrap gap-3">
                  {previewImages.map((img, i) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => setLightbox({ images: previewImages, index: i })}
                      aria-label={`Enlarge ${img.label.toLowerCase()}`}
                      title="Click to enlarge"
                      className="w-28 h-28 rounded-xl overflow-hidden border border-border hover:border-primary transition-colors cursor-pointer"
                    >
                      <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="border-t border-border pt-4 text-sm text-text-muted">
                No photos are attached to this record.
              </p>
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
        />
      )}
    </div>
  );
}
