// src/services/billDocument.ts
//
// WHERE a bill's three print copies live, and WHAT they are called.
//
// These three functions used to sit inside `services/bills.ts`, which imports
// Supabase, the toast and the browser. They are the decision half of every
// download, view or print — and the bulk ZIP feature needs exactly the same
// decisions — so they live here, in a module that imports nothing but a type.
//
// Being pure is not tidiness for its own sake:
//   * `bulkBillZip.ts` can use them without dragging in a Supabase client, which
//     is what lets the bulk-ZIP self-test run them under plain Node; and
//   * the desktop and admin copies can be compared function-for-function.
//
// `services/bills.ts` re-exports all four names, so no call site had to change.

// `../types/bill.ts` — the explicit `.ts` extension is what lets this pure module be
// imported by the Node self-test as well as by the bundler; see the note in
// `folderSummaryExport.ts`.
import type { BillCopy } from "../types/bill.ts";

/** The three storage paths, i.e. everything needed to resolve a bill's documents. */
export interface BillDocumentSource {
  original_pdf_path: string | null;
  duplicate_pdf_path: string | null;
  triplicate_pdf_path: string | null;
  invoice_no?: string | null;
  sheet_name?: string | null;
  base_name?: string | null;
}

/**
 * The text-safe token used in a storage object name and in a download filename.
 *
 * One function, used by `billDocumentFilename` AND by the bulk-ZIP collision
 * disambiguator, so the archive's names are built from the same rules as the
 * stored ones. Mirrors `safeBillToken` in the edge function's `_shared/parseBill.ts`;
 * they must agree or a saved name would not match the stored object.
 *
 * Slashes become "_" so they cannot create a nested object path, while a hyphen
 * that is part of the number is kept: `SEW_301_2026-27` reads far better than
 * `SEW_301_2026_27`, and a hyphen is safe in both a storage key and a filename.
 */
export function safeBillToken(raw: string): string {
  return (
    raw
      .replace(/[\\/]+/g, "_")
      .replace(/[<>:"/\\|?*\s]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^[_.]+|[_.]+$/g, "")
      .slice(0, 60) || "bill"
  );
}

/** The storage path of one copy, or null when that copy was never produced. */
export function billCopyPath(source: BillDocumentSource, copy: BillCopy): string | null {
  switch (copy) {
    case "original":
      return source.original_pdf_path;
    case "duplicate":
      return source.duplicate_pdf_path;
    case "triplicate":
      return source.triplicate_pdf_path;
  }
}

/**
 * True when this row has no per-bill document of its own.
 *
 * Only rows written before migration 0007 are in this state, and for them the
 * only document that exists is the workbook-level one containing every invoice in
 * the upload. That is NOT silently substituted: the copy buttons stay disabled and
 * say why, because handing back a 20-page PDF in response to "download invoice
 * 301" is the bug being fixed, not a degraded version of it.
 */
export function isLegacyBill(source: BillDocumentSource): boolean {
  return !source.original_pdf_path && !source.duplicate_pdf_path && !source.triplicate_pdf_path;
}

/**
 * The download filename for one copy, derived from the BILL, not the workbook.
 *
 * `FIX/301/2026-27` -> `FIX_301_2026-27_original.pdf`, so a user who downloads
 * three bills has three sensibly named files rather than three files all called
 * after the source workbook.
 */
export function billDocumentFilename(source: BillDocumentSource, copy: BillCopy): string {
  const raw = (source.invoice_no ?? "").trim() || (source.sheet_name ?? "").trim() || "bill";
  return `${safeBillToken(raw)}_${copy}.pdf`;
}
