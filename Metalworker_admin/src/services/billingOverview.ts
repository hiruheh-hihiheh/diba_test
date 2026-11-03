// src/services/billingOverview.ts
//
// The arithmetic behind the two Billing Overview cards, as one pure function.
//
// A card answers three questions with data the section already reads: how many Excel
// workbooks are in this section, how many records they produced, and when the newest
// workbook arrived. Keeping that here (rather than in the screen) means the phone and
// the desktop describe the same numbers the same way, and the self-test can prove the
// counts do not mix document types without a database.

/** What one card shows. */
export interface BillingSummary {
  /** Uploaded Excel workbooks. */
  workbooks: number;
  /** Bill rows those workbooks produced. */
  bills: number;
  /** ISO timestamp of the newest upload, or null when there are none. */
  latestUpload: string | null;
}

/** The shape the summary reads from an upload row. */
interface UploadLike {
  created_at?: string | null;
}

/**
 * Summarise ONE document type's uploads and record count.
 *
 * The caller passes the uploads of a single document type — that is what
 * `fetchBillUploads(type)` returns — so a Tax Invoice card cannot count a challan
 * workbook even if its caller made a mistake: there is nothing here to filter,
 * because nothing else was handed in.
 *
 * An unreadable `created_at` is skipped rather than becoming "now", which would
 * claim a workbook had just been uploaded when the timestamp was simply missing.
 */
export function summarizeBilling(uploads: readonly UploadLike[], bills: number): BillingSummary {
  let latestUpload: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const upload of uploads) {
    if (!upload.created_at) continue;
    const ms = Date.parse(upload.created_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestUpload = upload.created_at;
    }
  }

  const count = Math.trunc(Number(bills));

  return {
    workbooks: uploads.length,
    bills: Number.isFinite(count) && count > 0 ? count : 0,
    latestUpload,
  };
}

/** "12 Oct 2026", or a dash when the date is missing or unreadable. */
export function formatUploadDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
