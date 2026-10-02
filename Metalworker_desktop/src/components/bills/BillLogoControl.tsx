// src/components/bills/BillLogoControl.tsx
//
// A bill's logo, and the three things you can do about it.
//
// WHY THIS IS A COMPONENT AND NOT PART OF EITHER SCREEN
// The bill editor and the read-only detail view both have to show which logo a bill
// carries, and both have to offer Assign / Change / Remove. Written twice they would
// drift — and the detail view is the one place an admin checks before printing, so
// a drift there is a drift in what they believe about a tax document.
//
// WHY THE PICKER IS THE SAME ONE THE LIBRARY USES
// There is no upload control here. Choosing a logo from a bill opens the same
// library picker used from the Logo Library, so there is exactly one list of logos,
// one set of accepted formats, and one way to add a new one. A bill editor with its
// own uploader would let the same image exist twice under two names, and nothing
// would say which was on which invoice.
//
// IT SAYS WHETHER THE PDF ACTUALLY HAS IT
// Assigning a logo writes the bill immediately, and the PDFs are re-printed
// separately. So for a moment — or, if a re-print failed, indefinitely — the stored
// PDF and the row can disagree. That is shown rather than hidden, because the whole
// point of this control is to answer "what will print", and an optimistic "done" on
// a document that has not been re-printed would be the one dishonest answer.

import { useEffect, useState } from "react";
import { AlertTriangle, ImageOff, Loader2 } from "lucide-react";

import {
  applyLogoToBills,
  fetchBillLogoState,
  fetchLogosByIds,
} from "../../services/invoiceLogos";
import { billLogoIsStale, type BillLogoState } from "../../types/invoiceLogo";
import LogoPickerModal from "./LogoPickerModal";
import { LogoThumbnail } from "./LogoThumbnail";
import { useToast } from "../ui/Toast";

interface BillLogoControlProps {
  billId: string;
  /**
   * The state, if the caller already has it.
   *
   * The Bills list already embeds the logo on every row, so re-fetching it here
   * would be a request for something already on screen. Omit it and this fetches
   * what it needs, which is the right default for a screen that opened straight
   * into one bill.
   */
  initialState?: BillLogoState | null;
  /** Called after any change, so the caller can refresh its own row. */
  onChanged?: () => void;
}

export function BillLogoControl({ billId, initialState = null, onChanged }: BillLogoControlProps) {
  const toast = useToast();
  const [state, setState] = useState<BillLogoState | null>(initialState);
  const [loading, setLoading] = useState(initialState === null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* A caller that already had the bill row has `logo_id` but not the logo's NAME,
     because names live in another table that the bills query does not join. That
     is enough to know whether there is a logo and not enough to say which, so the
     name is resolved here — one small request — rather than making every caller
     join a table it does not otherwise need. It runs only when the id is known and
     the name is not, so the bill editor's own path never makes it. */
  const stateLogoId = state?.logo_id ?? null;
  const stateLogoRef = state?.logo ?? null;
  useEffect(() => {
    if (!stateLogoId || stateLogoRef) return;
    let cancelled = false;
    fetchLogosByIds([stateLogoId])
      .then((next) => {
        const logo = next.get(stateLogoId);
        if (cancelled || !logo) return;
        setState((prev) => (prev ? { ...prev, logo } : prev));
      })
      .catch(() => {
        /* The name is a caption, not the fact. "Logo assigned" is still true, and
           the buttons still work; failing here would blank a working control. */
      });
    return () => {
      cancelled = true;
    };
  }, [stateLogoId, stateLogoRef]);

  async function load() {
    setLoading(true);
    try {
      setState(await fetchBillLogoState(billId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The logo could not be read.");
    } finally {
      setLoading(false);
    }
  }

  if (initialState === null && loading) {
    return (
      <div className="flex items-center gap-2.5 text-sm text-text-muted py-2">
        <Loader2 size={15} className="animate-spin" />
        Reading the logo…
      </div>
    );
  }

  async function apply(logoId: string | null) {
    setBusy(true);
    try {
      /* No progress callback here: this is one bill, so there is no batch to report
         progress across, and a percentage over a single re-print would be theatre.
         The button's busy state is the honest signal — the work is in flight. */
      const result = await applyLogoToBills([billId], logoId);

      if (!result.ok) {
        toast.error(result.error ?? "The logo could not be changed.");
        await load();
        return;
      }

      if (result.failures.length > 0) {
        toast.error(
          "The logo was saved, but this invoice's PDF could not be re-printed. It will be re-printed on the next attempt."
        );
      } else if (logoId === null) {
        toast.success("Logo removed from this bill.");
      } else if (result.unchanged === 1) {
        /* Assigned the logo it already had. The server correctly reported it as
           unchanged and did not re-print, so saying "assigned" would imply work
           that did not happen. */
        toast.success("This bill already has that logo.");
      } else {
        toast.success(logoId === null ? "Logo removed." : "Logo assigned and PDFs re-printed.");
      }

      /* Re-read rather than patching the guess made during the operation: the
         server's own record of what is now in the PDF is the only thing worth
         showing, and this is one request on a screen the admin is looking at. */
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The logo could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const hasLogo = !!state?.logo_id;
  const stale = state ? billLogoIsStale(state) : false;
  const logoName = state?.logo?.name ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3.5">
        {hasLogo && state?.logo_id ? (
          <LogoThumbnail
            logoId={state.logo_id}
            size={56}
            className="border border-border bg-surface-hover"
          />
        ) : (
          <div className="w-14 h-14 rounded-xl bg-surface-hover border border-border flex items-center justify-center shrink-0">
            <ImageOff size={19} className="text-text-muted/50" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-0.5">
            Invoice logo
          </p>
          <p className="text-sm font-semibold text-text truncate">
            {hasLogo ? logoName ?? "Logo assigned" : "No Logo Assigned"}
          </p>
          {!hasLogo && (
            <p className="text-xs text-text-muted mt-0.5">
              This invoice prints without a logo, exactly as it always has.
            </p>
          )}
          {hasLogo && stale && (
            <p className="text-xs text-warning mt-0.5 flex items-center gap-1.5">
              <AlertTriangle size={12} className="shrink-0" />
              The saved PDF is being re-printed with this logo.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={busy}
          className="px-3.5 py-2 rounded-xl border border-border text-sm font-semibold text-text hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin mr-1.5 inline" />
              Working…
            </>
          ) : hasLogo ? (
            "Change Logo"
          ) : (
            "Assign Logo"
          )}
        </button>

        {hasLogo && (
          <button
            type="button"
            onClick={() => void apply(null)}
            disabled={busy}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold text-danger hover:bg-danger-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Remove Logo
          </button>
        )}
      </div>

      <LogoPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(logoId) => {
          /* Choosing the logo a bill already has is a no-op, and the service would
             correctly report it as unchanged — but closing the dialog having changed
             nothing is a poor answer to a deliberate click. It is filtered here so
             the dialog does not even offer it as a way forward. */
          if (logoId !== state?.logo_id) void apply(logoId);
        }}
        currentLogoId={state?.logo_id ?? null}
        currentLogoName={logoName}
        title="Choose a logo for this invoice"
        subtitle="The logo prints in the header, above the invoice number."
      />
    </div>
  );
}

export default BillLogoControl;
