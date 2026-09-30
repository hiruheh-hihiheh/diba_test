// src/components/bills/BillCopyActions.tsx
//
// The three print copies of one bill, with the actions available on each.
//
// ORIGINAL / DUPLICATE / TRIPLICATE are three physical print copies of a single
// invoice, not three invoices. Every action here therefore operates on ONE copy
// of ONE bill, and the section never sums them together anywhere.

import { useState } from "react";
import { Eye, Download, Printer, Loader2, FileWarning } from "lucide-react";

import {
  billCopyPath,
  billDocumentFilename,
  isLegacyBill,
  downloadBillPdf,
  printBillPdf,
  viewBillPdf,
  formatMoney,
} from "../../services/bills";
import { BILL_COPIES, BILL_COPY_LABEL, type Bill, type BillCopy } from "../../types/bill";
import { useToast } from "../ui/Toast";
import IconButton from "../ui/IconButton";

type BillSource = Pick<
  Bill,
  "original_pdf_path" | "duplicate_pdf_path" | "triplicate_pdf_path" | "base_name"
>;

/**
 * One row per copy, with View / Download / Print.
 *
 * Every action resolves against THIS bill's own path, so a button can never hand
 * back a document containing other invoices from the same workbook.
 *
 * A copy that was never generated shows as unavailable and its buttons are
 * disabled, rather than offering a button that mints a signed URL for an object
 * that does not exist and then fails with a 404. A row uploaded before per-bill
 * documents existed is called out separately, because the only file that exists
 * for it is the whole-workbook one and substituting it would be the bug this
 * replaced.
 */
export function BillCopyActions({
  bill,
  layout = "row",
  showMoney = false,
}: {
  bill: BillSource & { invoice_no?: string | null; amount_after_tax?: number | null };
  layout?: "row" | "compact";
  showMoney?: boolean;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<BillCopy | null>(null);

  async function run(copy: BillCopy, action: "view" | "download" | "print") {
    setBusy(copy);
    try {
      if (action === "view") await viewBillPdf(bill, copy);
      else if (action === "download") await downloadBillPdf(bill, copy);
      else await printBillPdf(bill, copy);
    } catch (err) {
      toast.error({
        title: `The ${BILL_COPY_LABEL[copy].toLowerCase()} copy could not be opened`,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  /* A bill uploaded before each bill had its own document. The buttons stay
     disabled and the reason is shown, because the alternative — quietly handing
     back the workbook PDF — is exactly the behaviour this replaced. */
  const legacy = isLegacyBill(bill);

  if (layout === "compact") {
    /* Three small icons in a row — used in the list's "Copies" column, where the
       invoice total is already shown and repeating the amount per copy would be
       three times the same number. */
    return (
      <div className="flex items-center gap-0.5">
        {BILL_COPIES.map((copy) => {
          const available = !!billCopyPath(bill, copy);
          return (
            <IconButton
              key={copy}
              size="sm"
              variant={available ? "ghost" : "ghost"}
              disabled={!available}
              tooltipPlacement="top-end"
              label={
                available
                  ? `View the ${BILL_COPY_LABEL[copy].toLowerCase()} copy`
                  : legacy
                    ? `This bill predates per-bill documents (${BILL_COPY_LABEL[copy].toLowerCase()})`
                    : `The ${BILL_COPY_LABEL[copy].toLowerCase()} copy is not available`
              }
              icon={
                available ? (
                  <Eye size={14} />
                ) : (
                  <FileWarning size={14} className="opacity-50" />
                )
              }
              busy={busy === copy}
              onClick={() => run(copy, "view")}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {BILL_COPIES.map((copy) => {
        const available = !!billCopyPath(bill, copy);
        return (
          <div
            key={copy}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-bg-secondary"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-text">{BILL_COPY_LABEL[copy]}</p>
              <p className="text-xs text-text-muted truncate">
                {available
                  ? // Named after the BILL, not the workbook, so three downloaded
                    // bills are three distinguishable files.
                    billDocumentFilename(bill, copy)
                  : legacy
                    ? "This bill was uploaded before each bill had its own document"
                    : "Not generated for this bill"}
              </p>
            </div>

            {showMoney && (
              <p className="text-sm font-semibold text-text tabular-nums whitespace-nowrap hidden sm:block">
                {formatMoney(bill.amount_after_tax)}
              </p>
            )}

            <div className="flex items-center gap-1 shrink-0">
              <IconButton
                label={`View the ${BILL_COPY_LABEL[copy].toLowerCase()} copy`}
                tooltipPlacement="left"
                size="sm"
                icon={<Eye size={15} />}
                disabled={!available}
                busy={busy === copy}
                onClick={() => run(copy, "view")}
              />
              <IconButton
                label={`Download the ${BILL_COPY_LABEL[copy].toLowerCase()} copy`}
                tooltipPlacement="left"
                size="sm"
                icon={<Download size={15} />}
                disabled={!available}
                busy={busy === copy}
                onClick={() => run(copy, "download")}
              />
              <IconButton
                label={`Print the ${BILL_COPY_LABEL[copy].toLowerCase()} copy`}
                tooltipPlacement="left"
                size="sm"
                icon={<Printer size={15} />}
                disabled={!available}
                busy={busy === copy}
                onClick={() => run(copy, "print")}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Inline "waiting" glyph for the upload stepper. */
export function BillSpinner({ className = "" }: { className?: string }) {
  return <Loader2 size={14} className={`animate-spin ${className}`} aria-hidden="true" />;
}