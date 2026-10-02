// src/pages/InvoiceLogos.tsx
//
// The Logo Library: the letterheads this company prints on its invoices.
//
// WHAT THIS SCREEN IS FOR
// Storing a logo once, so it can be used on any number of invoices. A logo is an
// asset the company owns, not part of any bill's data — which is why it lives
// here and is referenced by id, rather than being uploaded per bill.
//
// THE TWO THINGS AN ADMIN COMES HERE TO DO
//   1. add or rename a logo, and
//   2. put one on invoices that do not have it (or on a different one).
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not show a bill's figures, and it does not decide which invoices get a
// logo. The bill list does the deciding, one selection at a time, and this screen
// hands off to the same picker it uses.
//
// THE USAGE COUNT IS THE POINT OF THE LIBRARY
// "Used on 24 bills" is what makes a logo a shared asset rather than a picture
// that happened to be uploaded twice. It is also what makes deletion a decision
// rather than an accident: a logo nothing uses is safe to remove, and one that is
// on two hundred invoices is not, and the screen says which before anyone taps.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ImagePlus,
  Loader2,
  Pencil,
  SearchX,
  Trash2,
  UploadCloud,
} from "lucide-react";

import {
  addInvoiceLogo,
  deleteInvoiceLogo,
  fetchInvoiceLogos,
  fetchLogoUsage,
  pickInvoiceLogo,
  renameInvoiceLogo,
  INVOICE_LOGO_ACCEPT,
  type LogoUsageSummary,
  type PickedInvoiceLogo,
} from "../services/invoiceLogos";
import type { InvoiceLogo } from "../types/invoiceLogo";
import { usePageMeta } from "../contexts/PageMetaContext";
import { useToast } from "../components/ui/Toast";
import EmptyState from "../components/ui/EmptyState";
import SearchInput from "../components/ui/SearchInput";
import Modal, { ModalCancel } from "../components/ui/Modal";
import IconButton from "../components/ui/IconButton";
import { ErrorState } from "../components/ui/LoadingState";
import { LogoThumbnail } from "../components/bills/LogoThumbnail";
import { useLogoImageUrls } from "../components/bills/useLogoImageUrls";
import { BillLogoAssignModal } from "../components/bills/BillLogoAssignModal";

const inputCls =
  "bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary";

export default function InvoiceLogosPage() {
  const toast = useToast();

  const [logos, setLogos] = useState<InvoiceLogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  /** The logo being renamed, held as the target so the dialog can name it. */
  const [renameTarget, setRenameTarget] = useState<InvoiceLogo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  /**
   * A delete awaiting confirmation.
   *
   * Held as the logo plus its measured usage rather than as a boolean, because the
   * dialog has to say how many bills are involved and the answer is not known until
   * it is asked for. `usage` is null while that question is in flight.
   */
  const [deleteTarget, setDeleteTarget] = useState<InvoiceLogo | null>(null);
  const [usage, setUsage] = useState<LogoUsageSummary | null>(null);
  /** True when the usage question could not be answered at all. */
  const [usageFailed, setUsageFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** The logo whose "Assign to Bills" dialog is open. */
  const [assignTarget, setAssignTarget] = useState<InvoiceLogo | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* The page title and count come from the loaded library rather than being typed
     into the markup, so the header can never disagree with what is on screen. */
  usePageMeta(
    {
      title: "Logo Library",
      crumbs: [{ label: "Documents" }, { label: "Bills" }, { label: "Logos" }],
      subtitle:
        logos.length === 0
          ? "Reusable letterheads for your invoices"
          : `${logos.length} ${logos.length === 1 ? "logo" : "logos"} · ${logos.reduce(
              (sum, logo) => sum + logo.bill_count,
              0
            )} ${logos.reduce((sum, logo) => sum + logo.bill_count, 0) === 1 ? "bill" : "bills"} carrying one`,
    },
    [logos]
  );

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const rows = await fetchInvoiceLogos();
        setLogos(rows);
        setLoadError(null);
        setLoadedOnce(true);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "The logo library could not be loaded."
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return logos;
    return logos.filter((logo) => logo.name.toLowerCase().includes(term));
  }, [logos, search]);

  /* One request for every thumbnail on the page, rather than one per row. */
  const thumbIds = useMemo(() => logos.map((l) => l.id), [logos]);
  useLogoImageUrls(thumbIds);

  async function handleAdd(file: File) {
    setAdding(true);
    try {
      const picked: PickedInvoiceLogo = await pickInvoiceLogo(file);
      const created = await addInvoiceLogo(picked, picked.name);
      setLogos((prev) => [created, ...prev]);
      toast.success(`Added "${created.name}" to the logo library.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That logo could not be added.");
    } finally {
      setAdding(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function openRename(logo: InvoiceLogo) {
    setRenameTarget(logo);
    setRenameValue(logo.name);
  }

  async function submitRename() {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      toast.error("A logo needs a name.");
      return;
    }
    if (name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }

    setRenaming(true);
    try {
      const saved = await renameInvoiceLogo(renameTarget.id, name);
      /* Only the name and timestamp change, so the row is patched in place. A full
         refetch would also work, but it would re-mint every signed URL and make the
         whole grid flicker for a one-word edit. */
      setLogos((prev) =>
        prev.map((logo) =>
          logo.id === saved.id
            ? { ...logo, name: saved.name, updated_at: saved.updated_at }
            : logo
        )
      );
      setRenameTarget(null);
      toast.success("Logo renamed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That logo could not be renamed.");
    } finally {
      setRenaming(false);
    }
  }

  /**
   * Ask what a delete would destroy BEFORE showing the dialog.
   *
   * The count is measured rather than read off the list on screen, because the list
   * could be minutes old and a stale "not used" must not become a delete that
   * silently strips a letterhead off two hundred invoices. The delete itself
   * re-checks; this is so the dialog can be specific rather than generic.
   */
  async function openDelete(logo: InvoiceLogo) {
    setDeleteTarget(logo);
    setUsage(null);
    setUsageFailed(false);
    try {
      setUsage(await fetchLogoUsage(logo.id));
    } catch (err) {
      /* Recorded as FAILED rather than left as "not yet known", because the two
         need different words on screen: one means "still asking", the other means
         "the question could not be answered, so the only safe answer is no". The
         delete itself would still refuse, but the admin deserves to be told why
         rather than left watching a spinner that will never resolve. */
      setUsageFailed(true);
      toast.error(
        err instanceof Error
          ? `The usage of this logo could not be checked: ${err.message}`
          : "The usage of this logo could not be checked."
      );
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteInvoiceLogo(deleteTarget.id);
      setLogos((prev) => prev.filter((logo) => logo.id !== deleteTarget.id));
      toast.success(`Deleted "${deleteTarget.name}".`);
      setDeleteTarget(null);
      setUsage(null);
      setUsageFailed(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That logo could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  const showEmpty = !loading && !loadError && loadedOnce && logos.length === 0;
  const showNoMatches = !loading && !loadError && logos.length > 0 && visible.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleAdd(file);
        }}
        className="hidden"
        accept={INVOICE_LOGO_ACCEPT}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text">Logo Library</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Add a letterhead once, then print it on any number of invoices.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {logos.length > 3 && (
            <div className="w-56">
              <SearchInput
                value={search}
                onChange={setSearch}
                scope="logos"
                unit="logo"
                resultCount={visible.length}
                totalCount={logos.length}
                placeholder="Search logos…"
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={adding}
            className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            {adding ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
            {adding ? "Adding…" : "Add logo"}
          </button>
        </div>
      </div>

      {loadError && !loadedOnce && (
        <ErrorState message={loadError} onRetry={() => void load()} />
      )}

      {refreshing && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 size={13} className="animate-spin" />
          Refreshing…
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────── */}
      {loading && !loadedOnce && (
        <div className="flex items-center justify-center gap-2.5 py-20 text-text-muted">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading the logo library…</span>
        </div>
      )}

      {/* ── Empty ──────────────────────────────────────────────── */}
      {showEmpty && (
        <div className="bg-surface border border-border rounded-2xl">
          <EmptyState
            icon={<ImagePlus size={30} />}
            title="No invoice logos have been added yet."
            description="A logo is stored once here and can then be printed in the header of any invoice you choose. Nothing changes for invoices that have no logo — they print exactly as they do today."
            action={
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={adding}
                className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2"
              >
                {adding ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                Add your first logo
              </button>
            }
          />
        </div>
      )}

      {showNoMatches && (
        <div className="bg-surface border border-border rounded-2xl">
          <EmptyState
            size="sm"
            icon={<SearchX size={24} />}
            title="No logo matches that search"
            description={`Nothing in the library is called "${search.trim()}".`}
          />
        </div>
      )}

      {/* ── The library ────────────────────────────────────────── */}
      {visible.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          {visible.map((logo) => (
            <article
              key={logo.id}
              className="bg-surface border border-border rounded-2xl p-4 flex flex-col gap-3.5"
            >
              <div className="flex items-start gap-3.5">
                <LogoThumbnail
                  logoId={logo.id}
                  size={72}
                  className="border border-border bg-surface-hover"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-bold text-text truncate" title={logo.name}>
                    {logo.name}
                  </h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    {logo.bill_count === 0 ? (
                      "Not used on any bill yet"
                    ) : (
                      <>
                        Used on{" "}
                        <span className="font-semibold text-text tabular-nums">
                          {logo.bill_count}
                        </span>{" "}
                        {logo.bill_count === 1 ? "bill" : "bills"}
                      </>
                    )}
                  </p>
                  {logo.pixel_width && logo.pixel_height && (
                    <p className="text-[11px] text-text-muted/70 mt-0.5 tabular-nums">
                      {logo.pixel_width} x {logo.pixel_height}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <button
                  type="button"
                  onClick={() => setAssignTarget(logo)}
                  className="px-3 py-2 rounded-xl border border-border text-xs font-semibold text-text hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  Assign to Bills
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <IconButton
                    icon={<Pencil size={15} />}
                    label={`Rename ${logo.name}`}
                    onClick={() => openRename(logo)}
                  />
                  <IconButton
                    icon={<Trash2 size={15} />}
                    label={`Delete ${logo.name}`}
                    variant="danger"
                    onClick={() => void openDelete(logo)}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── Rename ─────────────────────────────────────────────── */}
      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename logo"
        subtitle={renameTarget?.name}
        size="sm"
        footer={
          <>
            <ModalCancel onClick={() => setRenameTarget(null)} disabled={renaming} />
            <button
              type="button"
              onClick={() => void submitRename()}
              disabled={renaming || !renameValue.trim()}
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {renaming ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <p className="text-sm text-text-muted mb-3">
          This only changes the name. The image is not re-uploaded and no invoice changes.
        </p>
        <input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitRename();
          }}
          autoFocus
          maxLength={120}
          placeholder="Logo name"
          aria-label="Logo name"
          className={inputCls}
        />
      </Modal>

      {/* ── Delete ─────────────────────────────────────────────── */}
      {/* EVERYTHING here keys off `usage`, the measured count, and never off the
          number on the card. The card's count came from the library query and may
          be minutes old — and a stale zero must not produce a Delete button on a
          logo that is on two hundred invoices. While `usage` is null nothing is
          offered at all, because "I do not know yet" is not "it is safe". */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setUsage(null);
          setUsageFailed(false);
        }}
        title={usage && usage.bill_count > 0 ? "This logo is in use" : "Delete this logo?"}
        tone={usage && usage.bill_count > 0 ? "danger" : "primary"}
        size="sm"
        footer={
          <>
            <ModalCancel
              onClick={() => {
                setDeleteTarget(null);
                setUsage(null);
                setUsageFailed(false);
              }}
              disabled={deleting}
            />
            {usage && usage.bill_count === 0 && (
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={deleting}
                className="px-4 py-2.5 rounded-xl bg-danger hover:bg-danger/90 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {deleting ? "Deleting…" : "Delete logo"}
              </button>
            )}
          </>
        }
      >
        {deleteTarget && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3">
              <LogoThumbnail
                logoId={deleteTarget.id}
                size={52}
                className="border border-border bg-surface-hover"
              />
              <p className="text-sm text-text font-semibold truncate">{deleteTarget.name}</p>
            </div>

            {usageFailed ? (
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-danger-muted border border-danger/25 text-danger text-sm">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>
                  Which invoices use this logo could not be checked, so it cannot safely be
                  deleted from here. Close this and try again.
                </span>
              </div>
            ) : usage === null ? (
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-surface-hover text-sm text-text-muted">
                <Loader2 size={15} className="animate-spin shrink-0" />
                Checking which invoices use this logo…
              </div>
            ) : usage.bill_count === 0 ? (
              <p className="text-sm text-text-muted leading-relaxed">
                This logo is not on any invoice, so deleting it changes nothing that has been
                or will be printed. This cannot be undone.
              </p>
            ) : (
              <>
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-warning-muted border border-warning/25 text-warning text-sm">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>
                    This logo is on{" "}
                    <span className="font-bold tabular-nums">{usage.bill_count}</span>{" "}
                    {usage.bill_count === 1 ? "invoice" : "invoices"}. Deleting it would leave
                    those invoices with no letterhead, so it is not allowed.
                  </span>
                </div>

                {usage.sample_bills.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      Invoices using it
                    </p>
                    <ul className="flex flex-col gap-1">
                      {usage.sample_bills.map((bill) => (
                        <li key={bill.id} className="text-sm text-text truncate">
                          {bill.label}
                        </li>
                      ))}
                      {usage.bill_count > usage.sample_bills.length && (
                        <li className="text-xs text-text-muted">
                          and {usage.bill_count - usage.sample_bills.length} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                <p className="text-sm text-text-muted leading-relaxed">
                  Remove it from those invoices first — from the Bills screen, select them and
                  choose <span className="font-semibold text-text">Remove Logo</span> — then
                  come back and delete the logo.
                </p>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* ── Assign to bills ────────────────────────────────────── */}
      <BillLogoAssignModal
        logo={assignTarget}
        onClose={() => setAssignTarget(null)}
        onApplied={(assigned) => {
          /* The counts on every card come from one count query, so after an
             assignment that changes which bills carry which logo, those numbers are
             now stale. A silent refetch is the right response: the admin did not ask
             for a reload, and a wrong count on a card they are about to act on would
             be worse than a brief refresh. */
          void load(true);
          if (assignTarget) {
            toast.success(
              assigned === 1
                ? "Logo assigned to 1 bill."
                : `Logo assigned to ${assigned} bills.`
            );
          }
          setAssignTarget(null);
        }}
      />
    </div>
  );
}
