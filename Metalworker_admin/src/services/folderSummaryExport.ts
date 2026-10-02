// src/services/folderSummaryExport.ts
//
// "Export Summary" for an opened billing folder.
//
// WHY HTML AND NOT A NEW LIBRARY
// The folder figures already reach the screen through `expo-print` (bill PDFs go
// through the same print pipeline), so rendering the summary as print HTML and
// handing it to `printToFileAsync` reuses the dependency, the code path and the
// user's own "Save as PDF" destination. It also gets correct page breaks for free,
// which a hand-rolled Excel writer would not.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP
// An exported figure must equal the figure on screen. Not "be close to", not "be
// computed the same way" — be the same string, produced by the same function.
//
// So this file computes NOTHING. It takes the `FolderBillSummary` that
// `fetchFolderBillSummary` already returned (which came from
// `get_folder_bill_summary`, migration 0010) and writes it out using
// `formatMoney`/`formatQuantity` from ./billFormat — the very functions the
// BillingFolderSheet renders with. A summary total recomputed here would be a
// second implementation of a financial figure, and the two would drift the first
// time someone changed a rule.
//
// The scope wording is reused for the same reason: an export that says
// "all bills included" while the screen says "9 of 12 included" is worse than no
// export at all. `scopeLines()` is the single source both read.

// This file is deliberately free of `react-native` and of any Supabase import, so
// `test-folder-summary-export.ts` can run it under plain Node and compare its output
// against a real `FolderBillSummary`. The platform-dependent half — rendering the
// HTML to a PDF and handing it to the share sheet — is `exportFolderSummaryPdf` in
// services/bills.ts, which already owns the other platform splits.

import { formatBillDate, formatJobKind, formatMoney, formatQuantity } from "./billFormat.ts";
import type { Bill, FolderBillSummary } from "../types/bill.ts";

/**
 * The scope and completeness wording, derived from the summary alone.
 *
 * This mirrors `BillSummaryScopeNote` exactly, and the two are compared by
 * `test-folder-summary-export.ts` so they cannot drift. An export is read later
 * than the screen and often by someone who never saw it, so it must carry its own
 * caveat rather than assuming the reader has the app open next to them.
 *
 * Returns an empty list for an empty folder: there is nothing to qualify.
 */
export function scopeLines(summary: FolderBillSummary): string[] {
  const total = summary.total_bills;
  if (total === 0) return [];

  const pricedKnown = summary.bills_with_total !== null;
  const priced = pricedKnown ? (summary.bills_with_total as number) : total - summary.bills_without_total;
  const missing = summary.bills_without_total;

  const lines: string[] = [];
  const bills = `${total} ${total === 1 ? "bill" : "bills"}`;

  if (pricedKnown && missing === 0) {
    lines.push(
      `${bills} — all with a recorded after-tax total, so every figure below covers the whole folder.`
    );
  } else if (pricedKnown) {
    lines.push(`${bills} — ${priced} with a recorded after-tax total, ${missing} without one.`);
  } else {
    lines.push(`${bills} in this folder.`);
  }

  if (pricedKnown && priced === 0) {
    lines.push(
      "No bill in this folder has a recorded after-tax total. Every money figure below reads ₹0.00 because nothing was recorded — not because this work was free. Only the bill count and the quantity are real numbers here."
    );
  } else if (pricedKnown && priced > 0 && missing > 0) {
    lines.push(
      `${missing} of ${total} bills have no recorded after-tax total. The money totals and the averages below cover only the ${priced} bills that do — a missing total is left out, not counted as ₹0.00. The bill count and the total quantity still include all ${total}.`
    );
  }

  return lines;
}

/** The heading + figure rows of one section, as display strings. */
export interface SummaryRow {
  label: string;
  value: string;
}

/**
 * Every figure the folder screen shows, in the screen's order, as strings.
 *
 * Returning data rather than HTML is what lets the test assert equality against
 * the summary object directly. The renderer below is then a dumb loop.
 */
export function summarySections(summary: FolderBillSummary): { title: string; rows: SummaryRow[] }[] {
  const sections: { title: string; rows: SummaryRow[] }[] = [];

  sections.push({
    title: "Totals",
    rows: [
      { label: "Total quantity", value: formatQuantity(summary.total_quantity) },
      { label: "Before tax", value: formatMoney(summary.total_amount_before_tax) },
      { label: "CGST", value: formatMoney(summary.total_cgst) },
      { label: "SGST", value: formatMoney(summary.total_sgst) },
      { label: "IGST", value: formatMoney(summary.total_igst) },
      { label: "GST", value: formatMoney(summary.total_gst) },
      { label: "After tax", value: formatMoney(summary.total_amount_after_tax) },
      { label: "Round off", value: formatMoney(summary.total_round_off) },
    ],
  });

  sections.push({
    title: "Average per bill",
    rows: [
      { label: "Quantity", value: formatQuantity(summary.average_quantity) },
      { label: "Before tax", value: formatMoney(summary.average_amount_before_tax) },
      { label: "CGST", value: formatMoney(summary.average_cgst) },
      { label: "SGST", value: formatMoney(summary.average_sgst) },
      { label: "IGST", value: formatMoney(summary.average_igst) },
      { label: "GST", value: formatMoney(summary.average_gst) },
      { label: "After tax", value: formatMoney(summary.average_bill_value) },
    ],
  });

  /* No `total_bills === 0` guard: a missing figure arrives as null and
     `formatMoney` already renders "—", which covers both the empty folder and the
     no-bill-has-a-total case. */
  sections.push({
    title: "Spread",
    rows: [
      { label: "Lowest bill", value: formatMoney(summary.min_amount_after_tax) },
      { label: "Highest bill", value: formatMoney(summary.max_amount_after_tax) },
      { label: "Lowest, before tax", value: formatMoney(summary.min_amount_before_tax) },
      { label: "Highest, before tax", value: formatMoney(summary.max_amount_before_tax) },
    ],
  });

  /* No category is invented: these are the raw `bills.job_kind` values that exist
     in this folder, cleaned up for display only. */
  if (summary.job_kind_breakdown.length > 0) {
    sections.push({
      title: "Bill breakdown",
      rows: summary.job_kind_breakdown.map((bucket) => ({
        label: bucket.job_kind ? formatJobKind(bucket.job_kind) ?? bucket.job_kind : "Unclassified",
        value: `${bucket.count} ${bucket.count === 1 ? "bill" : "bills"}`,
      })),
    });
  }

  return sections;
}

/** Escape text for HTML. Invoice numbers and filenames come from a workbook. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The printable document.
 *
 * A complete `<!DOCTYPE html>` document, which the iOS print formatter needs to
 * avoid a trailing blank page (see the expo-print page-margins note).
 */
export function buildFolderSummaryHtml(input: {
  folderName: string;
  summary: FolderBillSummary;
  /** The bills to list, if the caller wants the per-bill appendix. */
  bills?: Bill[];
  /** Injected rather than read from the clock, so the output is testable. */
  generatedAt?: Date;
}): string {
  const { folderName, summary, bills, generatedAt = new Date() } = input;

  const scope = scopeLines(summary)
    .map((line) => `<p class="scope">${esc(line)}</p>`)
    .join("\n");

  const sections = summarySections(summary)
    .map(
      (section) => `
      <h2>${esc(section.title)}</h2>
      <table>
        ${section.rows
          .map(
            (row) =>
              `<tr><td class="label">${esc(row.label)}</td><td class="value">${esc(row.value)}</td></tr>`
          )
          .join("\n        ")}
      </table>`
    )
    .join("\n");

  /* The appendix is optional because it can be long: a folder with 300 bills
     produces a 300-line table, and the figures above are the part anyone reconciles
     against. Each row is one `bills` row, so nothing is counted twice by having
     three print copies. */
  const appendix = bills && bills.length > 0
    ? `
      <h2>Bills in this folder</h2>
      <table class="bills">
        <tr class="head"><td>Invoice no</td><td>Date</td><td>Job type</td><td>Qty</td><td>After tax</td></tr>
        ${bills
          .map(
            (bill) => `<tr>
          <td>${esc(bill.invoice_no ?? "—")}</td>
          <td>${esc(formatBillDate(bill.invoice_date))}</td>
          <td>${esc(formatJobKind(bill.job_kind) ?? "Unclassified")}</td>
          <td class="num">${esc(formatQuantity(bill.total_quantity))}</td>
          <td class="num">${esc(formatMoney(bill.amount_after_tax))}</td>
        </tr>`
          )
          .join("\n        ")}
      </table>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(folderName)} — billing summary</title>
<style>
  @page { margin: 18mm 14mm; }
  body { font-family: -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .meta { color: #555; font-size: 11px; margin: 0 0 10px; }
  .scope { color: #444; font-size: 11px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 14px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  td.label { color: #333; }
  td.value, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  table.bills td, table.bills th { border-bottom: 1px solid #eee; }
  tr.head td { font-weight: 600; border-bottom: 1px solid #bbb; }
  /* A table that outgrows one page repeats its header instead of stranding it. */
  table.bills { page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 14px; color: #666; font-size: 10px; }
</style>
</head>
<body>
  <h1>${esc(folderName)}</h1>
  <p class="meta">Billing folder summary &middot; generated ${esc(
    `${String(generatedAt.getDate()).padStart(2, "0")} ${
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
        generatedAt.getMonth()
      ]} ${generatedAt.getFullYear()}`
    )}</p>
  ${scope}
  ${sections}
  ${appendix}
  <footer>
    One physical invoice is one bill; its original, duplicate and triplicate are three print copies of it and are counted once.
    Figures come from the folder summary shown in the app.
  </footer>
</body>
</html>`;
}

/** A filename that is safe on every platform and still recognisable. */
export function summaryFilename(folderName: string, when = new Date()): string {
  const safe = folderName
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const stamp = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, "0")}${String(
    when.getDate()
  ).padStart(2, "0")}`;
  return `${safe || "billing-folder"}-summary-${stamp}.pdf`;
}

/* The platform-dependent half of the export lives in services/bills.ts as
   `exportFolderSummaryPdf`, next to the other Platform splits, so that this module
   stays importable from a plain Node test. Everything it needs to build the
   document is above. */