// src/components/bills/LogoPickerModal.tsx
//
// ONE picker, used from three places: the Logo Library, the bill editor, and the
// bills list. There is no second upload path inside a bill and no second way to
// choose a logo — the bill editor and the bills list both open this.
//
// WHY ONE COMPONENT
// Three copies of "pick a logo" would be three places that could disagree about
// which formats are accepted, which logos are safe to delete, and what the empty
// state says. More importantly it would make "the same logo library" a claim
// rather than a fact: an admin who assigned a logo from the library and then
// uploaded a different image from the bill editor would end up with two nearly
// identical logos and no way to tell which is on which invoice.
//
// WHAT IT OFFERS
//   - every logo in the library, with its name and how many bills use it
//   - a "no logo" choice, which is a real state and not an absence of one
//   - a search box, because a library that has grown past a handful is exactly
//     when a list is hard to use and a search box is worth its pixels
//   - adding a new logo from inside the picker, because "I need one that is not
//     here yet" is the most common reason someone opened it
//
// THE PREVIEW IS THE DELIVERABLE
// The dialog shows each logo at the shape it will print at, fitted not stretched,
// so the admin is choosing a letterhead rather than guessing from a filename.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, SearchX, UploadCloud } from "lucide-react";

import {
  addInvoiceLogo,
  fetchInvoiceLogos,
  pickInvoiceLogo,
  INVOICE_LOGO_ACCEPT,
  type PickedInvoiceLogo,
} from "../../services/invoiceLogos";
import type { InvoiceLogo } from "../../types/invoiceLogo";
import Modal, { ModalCancel } from "../ui/Modal";
import EmptyState from "../ui/EmptyState";
import SearchInput from "../ui/SearchInput";
import { useLogoImageUrls } from "./useLogoImageUrls";
import { useToast } from "../ui/Toast";

export interface LogoPickerModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called with the chosen logo id, or `null` for "no logo".
   *
   * `null` is a first-class result rather than a cancel: removing a logo is a real
   * operation with real consequences for the printed invoice, and it has to be
   * reachable from the same place as choosing one.
   */
  onSelect: (logoId: string | null) => void;
  /** The bill's current logo, preselected. Null when there is no current logo. */
  currentLogoId?: string | null;
  /** The name of the currently assigned logo, shown so the selection is legible. */
  currentLogoName?: string | null;
  /** Titles the dialog for its caller, e.g. "Assign a logo to 24 bills". */
  title?: string;
  subtitle?: string;
  /**
   * Hides the "no logo" row.
   *
   * Only for a picker that must choose something. The bill editor and the library
   * both want removal available, and offering it in the same list as the choices is
   * why an admin never has to look for a separate "Remove" button that might not
   * be there.
   */
  allowNone?: boolean;
}

export function LogoPickerModal({
  open,
  onClose,
  onSelect,
  currentLogoId = null,
  currentLogoName = null,
  title = "Choose a logo",
  subtitle,
  allowNone = true,
}: LogoPickerModalProps) {
  const toast = useToast();
  const [logos, setLogos] = useState<InvoiceLogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(currentLogoId);
  const [adding, setAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Re-read the library each time the dialog opens rather than caching it across
     opens: an admin can add or delete a logo in another tab, and a picker that
     offered a logo which no longer exists would fail at the point of assignment
     instead of at the point of choosing. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setSearch("");
    setChosen(currentLogoId);

    fetchInvoiceLogos()
      .then((rows) => {
        if (cancelled) return;
        setLogos(rows);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "The logo library could not be loaded.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    /* `currentLogoId` is deliberately NOT a dependency: it changes when the bill's
       logo changes, and re-reading the whole library then would be a fetch the
       admin did not ask for. It is read on open, which is when it matters. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return logos;
    return logos.filter((logo) => logo.name.toLowerCase().includes(term));
  }, [logos, search]);

  const chosenLogo = useMemo(
    () => (chosen ? logos.find((logo) => logo.id === chosen) ?? null : null),
    [chosen, logos]
  );

  async function handleAdd(file: File) {
    setAdding(true);
    try {
      const picked = await pickInvoiceLogo(file);
      const created = await addInvoiceLogo(picked, picked.name);
      /* The new logo is selected and the dialog stays open, so an admin adding a
         logo can carry straight on to the next bill without reopening anything.
         The row is prepended rather than appended so it is visible immediately —
         the list is ordered newest-first, and a new logo that lands off-screen
         would look like the add had failed. */
      setLogos((prev) => [created, ...prev]);
      setChosen(created.id);
      setSearch("");
      toast.success(`Added "${created.name}" to the logo library.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That logo could not be added.");
    } finally {
      setAdding(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function confirm() {
    if (chosen === null && !allowNone) return;
    onSelect(chosen);
    onClose();
  }

  const nothingToShow = !loading && !loadError && visible.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="lg"
      footer={
        <>
          <ModalCancel onClick={onClose} />
          <button
            type="button"
            onClick={confirm}
            disabled={chosen === null && !allowNone}
            className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {chosen === null ? "Remove logo" : "Use this logo"}
          </button>
        </>
      }
    >
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

      <div className="flex flex-col gap-4">
        {logos.length > 3 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            scope="logos"
            unit="logo"
            resultCount={visible.length}
            totalCount={logos.length}
            placeholder="Search logos by name…"
          />
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2.5 py-12 text-text-muted">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading the logo library…</span>
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

        {!loading && !loadError && (
          <div className="flex flex-col gap-1.5 max-h-[45vh] overflow-y-auto -mx-1 px-1">
            {allowNone && (
              <LogoRow
                name="No logo"
                detail="This invoice prints exactly as it does today."
                thumb={null}
                selected={chosen === null}
                onSelect={() => setChosen(null)}
              />
            )}

            {visible.map((logo) => (
              <LogoRow
                key={logo.id}
                name={logo.name}
                detail={
                  logo.bill_count === 0
                    ? "Not used on any bill yet"
                    : `Used on ${logo.bill_count} ${logo.bill_count === 1 ? "bill" : "bills"}`
                }
                thumb={<PickerThumb logoId={logo.id} />}
                selected={chosen === logo.id}
                onSelect={() => setChosen(logo.id)}
              />
            ))}

            {nothingToShow &&
              (search.trim() ? (
                <EmptyState
                  size="sm"
                  icon={<SearchX size={22} />}
                  title="No logo matches that search"
                  description="Try a different name, or add a new logo."
                />
              ) : (
                <EmptyState
                  size="sm"
                  icon={<ImagePlus size={22} />}
                  title="No invoice logos have been added yet."
                  description="Add a logo once and it can be used on any number of invoices. It prints in the header, above the invoice number."
                />
              ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={adding}
            className="px-3.5 py-2 rounded-xl border border-border text-sm font-semibold text-text hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
          >
            {adding ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
            {adding ? "Adding…" : "Add a new logo"}
          </button>

          <p className="text-xs text-text-muted text-right truncate">
            {chosenLogo ? (
              <>
                Will print: <span className="font-semibold text-text">{chosenLogo.name}</span>
              </>
            ) : currentLogoName && chosen === null ? (
              <>Currently: {currentLogoName}</>
            ) : null}
          </p>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One selectable row.
 *
 * The whole row is the control, not just a radio dot, because the row carries the
 * preview and the count and a small target next to all of that is fiddly to hit.
 * `aria-checked` is on the row so a screen reader announces the selection state
 * along with the name, which is what makes this legible without the visual.
 */
function LogoRow({
  name,
  detail,
  thumb,
  selected,
  onSelect,
}: {
  name: string;
  detail: string;
  thumb: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`w-full flex items-center gap-3.5 px-3 py-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-surface-hover"
      }`}
    >
      {thumb}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text truncate">{name}</span>
        <span className="block text-xs text-text-muted truncate">{detail}</span>
      </span>
      {selected && <Check size={17} className="text-primary shrink-0" />}
    </button>
  );
}

/** The preview tile, at the shape the logo prints at. */
function PickerThumb({ logoId }: { logoId: string }) {
  const urls = useLogoImageUrls([logoId]);
  const url = urls.get(logoId);
  return (
    <div className="w-14 h-10 rounded-lg bg-surface-hover border border-border flex items-center justify-center shrink-0 overflow-hidden">
      {url ? (
        <img src={url} alt="" className="max-w-full max-h-full object-contain" />
      ) : (
        <Loader2 size={14} className="text-text-muted/40 animate-spin" />
      )}
    </div>
  );
}

export default LogoPickerModal;
export type { PickedInvoiceLogo };
