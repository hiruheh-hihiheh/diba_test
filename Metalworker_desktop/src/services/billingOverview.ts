// src/services/billingOverview.ts
//
// The arithmetic behind the two Billing Overview cards, and the bounded page reader
// the upload metadata uses — all pure, so both apps can share it and Node can test it.
//
// MANUAL BILLS ARE NOT WORKBOOKS
//
// `create-bill` inserts a synthetic `bill_uploads` row for every hand-built bill, with
// `creation_source = "manual"` and the filename "Created manually". Counting upload
// rows would therefore count hand-built bills as Excel workbooks, and their creation
// time would become the "latest upload" — both wrong, and both invisible because the
// numbers still look plausible. Provenance is the only reliable signal, so everything
// here filters on `creation_source`, never on the filename. Rows whose
// `creation_source` is null or absent are treated as workbook imports, which is what
// the column's default ('workbook') and every row written before it mean.

/** What one card shows. */
export interface BillingSummary {
  /** Excel-imported workbooks. Manual bills' synthetic upload rows are not counted. */
  workbooks: number;
  /** Bill rows, INCLUDING manually created bills. */
  bills: number;
  /** ISO timestamp of the newest real Excel upload, or null when there is none. */
  latestUpload: string | null;
}

/** The fields that decide whether an upload row is an Excel workbook. */
export interface ExcelUploadRow {
  id?: string;
  created_at?: string | null;
  creation_source?: "workbook" | "manual" | string | null;
}

/** What the overview card needs from the upload table, before the bill count. */
export interface ExcelUploadSummary {
  workbooks: number;
  latestUpload: string | null;
}

/** One page of rows, plus the total the server reports for the filtered set. */
export interface PageResult<T> {
  rows: T[];
  /** Total matching rows ignoring pagination, when the server reports one. */
  total?: number | null;
}

/** Reads one page. Injected so the paging loop can be tested without a database. */
export type PageReader<T> = (page: number, pageSize: number) => Promise<PageResult<T>>;

/** Upload rows read per request. Comfortably inside any PostgREST row cap. */
export const UPLOAD_PAGE_SIZE = 500;

/**
 * A row is an Excel workbook unless its provenance says it is manual.
 *
 * Not "is `creation_source === 'workbook'`", because a null/absent value means the row
 * predates provenance (or was written by an importer that did not set it) and must
 * keep behaving as the Excel import it is. The only value that changes the answer is
 * the one `create-bill` writes.
 */
export function isExcelUpload(row: ExcelUploadRow): boolean {
  return row.creation_source !== "manual";
}

/**
 * How many Excel workbooks there are, and when the newest one was uploaded.
 *
 * Manual rows are skipped entirely, so they affect neither figure. An unreadable
 * `created_at` still counts as a workbook but cannot become the latest date — better
 * than claiming a workbook arrived "now" because its timestamp did not parse.
 */
export function summarizeUploads(rows: readonly ExcelUploadRow[]): ExcelUploadSummary {
  let workbooks = 0;
  let latestUpload: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    if (!isExcelUpload(row)) continue;
    workbooks++;
    if (!row.created_at) continue;
    const ms = Date.parse(row.created_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestUpload = row.created_at;
    }
  }

  return { workbooks, latestUpload };
}

/**
 * Join the upload summary to a record count.
 *
 * The count is the section's own `fetchBills` total, so it includes manually created
 * bills exactly as the list does; only the workbook count and the upload date come
 * from the Excel rows.
 */
export function summarizeBilling(uploads: ExcelUploadSummary, bills: number): BillingSummary {
  const workbookCount = Math.trunc(Number(uploads.workbooks));
  const billCount = Math.trunc(Number(bills));

  return {
    workbooks: Number.isFinite(workbookCount) && workbookCount > 0 ? workbookCount : 0,
    bills: Number.isFinite(billCount) && billCount > 0 ? billCount : 0,
    latestUpload: uploads.latestUpload ?? null,
  };
}

/**
 * Read every page of a filtered set, in bounded requests.
 *
 * A single unbounded `select` silently loses whatever the backend's row cap left
 * behind, which is why an upload list must not be read that way. Two independent exits
 * are needed: the server's reported total (so an exact multiple of the page size does
 * not cost an extra empty request), and a short page (so a stale or absent total still
 * terminates). The hard page ceiling turns a server that ignores `range` into an error
 * instead of an infinite loop.
 */
export async function readAllPages<T>(
  read: PageReader<T>,
  pageSize = UPLOAD_PAGE_SIZE,
  maxPages = 200
): Promise<T[]> {
  const size = Math.max(1, Math.trunc(pageSize) || 1);
  const out: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const { rows, total } = await read(page, size);
    out.push(...rows);
    if (rows.length < size) return out;
    if (typeof total === "number" && Number.isFinite(total) && out.length >= total) return out;
  }

  throw new Error(
    `Reading more than ${(maxPages * size).toLocaleString()} records at once was refused. Narrow the filter or try again later.`
  );
}

/** "12 Oct 2026", or a dash when the date is missing or unreadable. */
export function formatUploadDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
