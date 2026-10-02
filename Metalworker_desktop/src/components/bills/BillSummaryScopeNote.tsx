// src/components/bills/BillSummaryScopeNote.tsx
//
// Which bills the folder's money figures actually cover.
//
// THE MIRROR OF THE ADMIN APP'S FILE OF THE SAME NAME
// Same purpose, same wording, same source: the desktop client renders the same
// folder summary from the same `get_folder_bill_summary` RPC (migration 0010) as
// the admin client. The markup differs because one side is React Native and the
// other is Tailwind on the web; the SENTENCES do not differ, and
// `verify-billing-folders.mjs` checks that they do not.
//
// WHY IT IS ITS OWN FILE
// The wording is the only thing that tells a user a folder total excludes some of
// its bills, and two screens need it. A sentence that quietly disagrees between
// screens is exactly the failure this is meant to prevent, so it is written once.
// These are presentation strings: this component reads `FolderBillSummary` and
// formats it. It performs no arithmetic on the figures.
//
// WHAT IT SAYS, AND WHY EACH PART IS HERE
//   * Always: how many bills, and how many of them have a recorded after-tax
//     total. That is the scope of everything below.
//   * When some are missing: that the money EXCLUDES them rather than counting
//     them as ₹0 — the two are completely different numbers and the user has to be
//     able to tell which one they are looking at.
//   * When ALL are missing: that the ₹0.00 figures below are an absence of data,
//     not a folder of free work. This is the case that must never be mistaken for
//     a real total, so it is stated in its own words rather than as a variation of
//     the partial case.
//
// THE RULES THEMSELVES ARE NOT HERE
// "Which bills count as priced" is decided once, in `get_folder_bill_summary`, and
// this component only reports what that RPC returned. See `FolderBillSummary` in
// `types/bill.ts` for the full population table.

import { AlertTriangle } from "lucide-react";

import type { FolderBillSummary } from "../../types/bill";

/**
 * The scope line plus any warning about bills that carry no recorded total.
 *
 * Renders nothing for an empty folder: the caller does not render a summary for
 * one, and "0 of 0 bills have no recorded total" is noise, not information.
 */
export function BillSummaryScopeNote({ summary }: { summary: FolderBillSummary }) {
  const { total_bills: total, bills_without_total: missing, bills_with_total: priced } = summary;

  if (total === 0) return null;

  /* `null` means the RPC predates the `bills_with_total` column, so the coverage
     is unknown — not zero. The line then states only what is known instead of
     implying complete coverage. */
  const pricedKnown = priced !== null;
  const pricedCount = pricedKnown ? priced : total - missing;

  const scope =
    pricedKnown && missing === 0
      ? `${total} ${total === 1 ? "bill" : "bills"} — all with a recorded after-tax total, so every figure below covers the whole folder`
      : pricedKnown
        ? `${total} ${total === 1 ? "bill" : "bills"} — ${pricedCount} with a recorded after-tax total${missing > 0 ? `, ${missing} without one` : ""}`
        : `${total} ${total === 1 ? "bill" : "bills"} in this folder`;

  return (
    <div className="mb-2">
      <p className="text-[11px] text-text-muted">{scope}.</p>

      {pricedKnown && pricedCount === 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-warning mt-0.5">
          <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden="true" />
          <span>
            No bill in this folder has a recorded after-tax total. Every money figure
            below reads ₹0.00 because nothing was recorded — not because this work was
            free. Only the bill count and the quantity are real numbers here.
          </span>
        </p>
      )}

      {pricedKnown && pricedCount > 0 && missing > 0 && (
        <p className="flex items-start gap-1.5 text-[11px] text-warning mt-0.5">
          <AlertTriangle size={13} className="shrink-0 mt-px" aria-hidden="true" />
          <span>
            {missing} of {total} bills have no recorded after-tax total. The money
            totals and the averages below cover only the {pricedCount} bills that do — a
            missing total is left out, not counted as ₹0.00. The bill count and the
            total quantity still include all {total}.
          </span>
        </p>
      )}
    </div>
  );
}