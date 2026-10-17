// src/services/bulkBillZip.ts
//
// Bulk "Download ZIP": pick copy types, fetch the PDFs that are ALREADY stored for
// a set of selected bills, and pack them into ONE valid ZIP archive.
//
// THIS MODULE IS PURE
// It imports `fflate` and types only. Everything that touches the network
// (`download`) and everything that hands the finished bytes to the user (`save`)
// is injected by the platform wrapper in `services/bills.ts`. That is what lets the
// self-test build a real archive from synthetic PDFs under plain Node, and why the
// desktop and admin copies of this file can be compared function for function.
//
// NOTHING HERE REGENERATES A PDF.
// Every entry comes from a `*_pdf_path` already on the `bills` row, resolved by the
// same `billCopyPath` the single-bill download uses. A bulk download therefore
// cannot change a stored document, a logo assignment, a figure or a filename rule.
//
// THE ARCHIVE IS ASSEMBLED BY STREAMING
// Entries are compressed one at a time into an fflate `Zip` and each downloaded
// PDF is released as soon as it has been added, so peak memory is roughly the
// archive itself plus a small download window — not "every PDF at once". Deflate
// (level 6) is used because the generated PDFs carry UNCOMPRESSED content streams,
// so they shrink substantially; on already-random bytes it would cost CPU for
// nothing, which is why the level is stated here rather than left to chance.

import { Zip, ZipDeflate } from "fflate";

// The explicit `.ts` extensions are what let this pure module be imported by the Node
// self-test as well as by the bundler; see the note in `folderSummaryExport.ts`.
import { BILL_COPY_LABEL, BILL_COPIES, type BillCopy } from "../types/bill.ts";
import {
  billCopyPath,
  billDocumentFilename,
  isLegacyBill,
  safeBillToken,
  type BillDocumentSource,
} from "./billDocument.ts";

/* ──────────────────────────────────────────────
   Inputs and limits
   ────────────────────────────────────────────── */

/** One selected bill, reduced to exactly what the archive needs. */
export interface BulkZipBill extends BillDocumentSource {
  id: string;
  invoice_no: string | null;
  sheet_name: string | null;
}

export interface BulkZipLimits {
  /**
   * The most PDFs one archive may contain.
   *
   * A single archive is handed to the browser as one Blob and to Android as one
   * file in the share sheet; both get unreliable in the high hundreds of files.
   * 2000 documents is 666 bills with all three copies — far above any real
   * selection — so this is a guard rail, not a working constraint.
   */
  maxDocuments: number;
  /**
   * The most UNCOMPRESSED PDF bytes one archive may pull down.
   *
   * The archive is built in memory, so this bounds peak memory. 128 MiB is roughly
   * ten thousand 12 KiB invoices; a selection that reaches it is unusual, and when
   * it does the remainder is reported as skipped rather than truncated silently.
   */
  maxInputBytes: number;
  /** Simultaneous document downloads. Kept small: more sockets do not finish faster. */
  concurrency: number;
}

export const BULK_ZIP_LIMITS: BulkZipLimits = {
  maxDocuments: 2000,
  maxInputBytes: 128 * 1024 * 1024,
  concurrency: 4,
};

/* ──────────────────────────────────────────────
   Planning
   ────────────────────────────────────────────── */

export type BulkZipSkipReason = "legacy" | "missing-copy" | "size-limit";

export interface BulkZipSkip {
  billId: string;
  invoiceNo: string | null;
  copy: BillCopy;
  reason: BulkZipSkipReason;
  /** A sentence the UI can show verbatim. */
  detail: string;
}

export interface BulkZipEntry {
  billId: string;
  invoiceNo: string | null;
  copy: BillCopy;
  /** The storage object to fetch. */
  path: string;
  /** The name it will carry INSIDE the archive. */
  filename: string;
}

export interface BulkZipPlan {
  archiveName: string;
  entries: BulkZipEntry[];
  /** Requested copies that cannot be included, each with the reason. */
  skipped: BulkZipSkip[];
  /** `bills × copies`: the most PDFs this selection could possibly yield. */
  requested: number;
}

/** `[original, duplicate, triplicate]` order, de-duplicated: the print order. */
function orderedCopies(copies: readonly BillCopy[]): BillCopy[] {
  const wanted = new Set(copies);
  return BILL_COPIES.filter((copy) => wanted.has(copy));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `selected_bills_original_2026-10-17.zip`, and the same shape for any mix.
 *
 * One copy is named after itself; all three collapse to `all_copies` rather than
 * three words; a partial mix lists what it holds, in print order.
 */
export function bulkZipArchiveName(copies: readonly BillCopy[], when: Date): string {
  const ordered = orderedCopies(copies);
  const date = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`;
  const part =
    ordered.length === 1
      ? ordered[0]
      : ordered.length === BILL_COPIES.length
        ? "all_copies"
        : ordered.join("_");
  return `selected_bills_${part}_${date}.zip`;
}

/** `SEW_301_2026-27_original.pdf` -> `SEW_301_2026-27_original`. */
function withoutPdfExtension(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

/** A planned entry before its in-archive name has been proved unique. */
interface DraftEntry extends BulkZipEntry {
  sheetName: string | null;
}

/**
 * Give every entry a name that is unique inside the archive.
 *
 * Two bills can legitimately share an invoice number — the same number re-issued
 * from a different workbook, or a corrected upload — and `billDocumentFilename`
 * would then hand both the same name. ZIP readers do not agree on duplicates: some
 * keep the last, some the first, some show one and hide the other. Any of those
 * silently loses an invoice, so a collision is resolved here instead:
 *
 *   1. append the sheet name, when it differs from what is already in the name;
 *   2. otherwise append the first 8 characters of the bill id (always present, and
 *      the same id the single-bill download was issued for);
 *   3. and only if even that collides, a counter, so the loop is proved to end.
 */
function uniqueFilenames(entries: DraftEntry[]): BulkZipEntry[] {
  const used = new Set<string>();
  const out: BulkZipEntry[] = [];

  for (const entry of entries) {
    let filename = entry.filename;

    if (used.has(filename)) {
      const base = withoutPdfExtension(entry.filename);
      const sheetToken = entry.sheetName ? safeBillToken(entry.sheetName) : "";
      if (sheetToken && !base.includes(sheetToken)) {
        const candidate = `${base}_${sheetToken}.pdf`;
        if (!used.has(candidate)) filename = candidate;
      }
    }

    if (used.has(filename)) {
      const candidate = `${withoutPdfExtension(entry.filename)}_${entry.billId.slice(0, 8)}.pdf`;
      if (!used.has(candidate)) filename = candidate;
    }

    if (used.has(filename)) {
      const base = withoutPdfExtension(entry.filename);
      let n = 2;
      while (used.has(`${base}_${entry.billId.slice(0, 8)}_${n}.pdf`)) n++;
      filename = `${base}_${entry.billId.slice(0, 8)}_${n}.pdf`;
    }

    used.add(filename);
    out.push({
      billId: entry.billId,
      invoiceNo: entry.invoiceNo,
      copy: entry.copy,
      path: entry.path,
      filename,
    });
  }

  return out;
}

/**
 * Decide, without touching the network, exactly which PDFs an archive will hold.
 *
 * `BulkZipBill` rows can arrive for a selection that spans several pages and
 * filters; nothing here cares about pages, so a cross-page selection is planned
 * exactly like a single-page one.
 *
 * This deliberately does NOT enforce `BULK_ZIP_LIMITS.maxDocuments`: a plan is a
 * statement of what the selection contains, and silently dropping a bill to fit a
 * limit is the failure this feature exists to avoid. The caller compares
 * `entries.length` against the limit and refuses to start, with a message naming
 * the numbers, before any download begins.
 */
export function planBulkZip(
  bills: readonly BulkZipBill[],
  copies: readonly BillCopy[],
  when: Date = new Date()
): BulkZipPlan {
  const ordered = orderedCopies(copies);

  /* The selection is a set of ids, but a plan is cheap to make idempotent: the same
     bill supplied twice must not put the same invoice in the archive twice. */
  const uniqueBills: BulkZipBill[] = [];
  const seenBillIds = new Set<string>();
  for (const bill of bills) {
    if (seenBillIds.has(bill.id)) continue;
    seenBillIds.add(bill.id);
    uniqueBills.push(bill);
  }

  const skipped: BulkZipSkip[] = [];
  const draft: DraftEntry[] = [];

  for (const bill of uniqueBills) {
    for (const copy of ordered) {
      const invoiceNo = bill.invoice_no ?? null;

      if (isLegacyBill(bill)) {
        skipped.push({
          billId: bill.id,
          invoiceNo,
          copy,
          reason: "legacy",
          detail:
            "Uploaded before bills had their own documents, so it has no single-invoice PDF. Re-upload the workbook to generate one.",
        });
        continue;
      }

      const path = billCopyPath(bill, copy);
      if (!path) {
        skipped.push({
          billId: bill.id,
          invoiceNo,
          copy,
          reason: "missing-copy",
          detail: `The ${BILL_COPY_LABEL[copy]} copy was not generated for this bill.`,
        });
        continue;
      }

      draft.push({
        billId: bill.id,
        invoiceNo,
        copy,
        path,
        filename: billDocumentFilename(bill, copy),
        sheetName: bill.sheet_name ?? null,
      });
    }
  }

  const entries = uniqueFilenames(draft);

  return {
    archiveName: bulkZipArchiveName(ordered, when),
    entries,
    skipped,
    requested: uniqueBills.length * ordered.length,
  };
}

/* ──────────────────────────────────────────────
   Building
   ────────────────────────────────────────────── */

export interface BulkZipIncluded {
  billId: string;
  invoiceNo: string | null;
  copy: BillCopy;
  filename: string;
  bytes: number;
}

export interface BulkZipFailure {
  billId: string;
  invoiceNo: string | null;
  copy: BillCopy;
  filename: string;
  error: string;
}

export interface BulkZipProgress {
  /** Entries finished — downloaded and added, failed, or skipped by the size cap. */
  done: number;
  /** `plan.entries.length`: the documents this run will actually attempt. */
  total: number;
  billId: string;
  invoiceNo: string | null;
  copy: BillCopy;
}

export interface BulkZipOutcome {
  archiveName: string;
  /**
   * The finished archive. Typed as `Uint8Array<ArrayBuffer>` (not the wider
   * `Uint8Array<ArrayBufferLike>`) because it is a freshly allocated buffer with no
   * `SharedArrayBuffer` in it — which is what lets it be handed straight to a `Blob`
   * or to `File.write` without a defensive copy.
   */
  bytes: Uint8Array<ArrayBuffer>;
  included: BulkZipIncluded[];
  skipped: BulkZipSkip[];
  failed: BulkZipFailure[];
  /** Uncompressed bytes of the included PDFs. */
  totalInputBytes: number;
  /** True when `maxInputBytes` stopped entries being added. */
  truncated: boolean;
}

export type BulkZipDownloader = (path: string) => Promise<Uint8Array>;

export interface BuildBulkZipOptions {
  download: BulkZipDownloader;
  concurrency?: number;
  maxInputBytes?: number;
  /** Called once per entry, after it is resolved, with real completed counts. */
  onProgress?: (progress: BulkZipProgress) => void;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "The download failed.";
}

/**
 * Fetch every planned document and pack it into one ZIP.
 *
 * A document that cannot be fetched is recorded in `failed` and does NOT stop the
 * run: a partial archive of the invoices that did resolve is more useful than none,
 * and the caller reports the difference. The one case that raises is a compression
 * failure, because a ZIP that did not build must never be handed to the user.
 *
 * Downloads run through a pool of exactly `concurrency` slots, so at most that many
 * requests are ever open — not "hundreds of sockets", and not `concurrency * 2`
 * either. Each slot is refilled the moment its document resolves, and documents are
 * consumed strictly in plan order so the archive's contents do not depend on which
 * request happened to finish first. A finished body is compressed and released
 * immediately, so the retained bytes are the archive so far plus one body per slot.
 */
export async function buildBulkZip(
  plan: BulkZipPlan,
  options: BuildBulkZipOptions
): Promise<BulkZipOutcome> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? BULK_ZIP_LIMITS.concurrency));
  const maxInputBytes = options.maxInputBytes ?? BULK_ZIP_LIMITS.maxInputBytes;
  const entries = plan.entries;
  const total = entries.length;

  const chunks: Uint8Array[] = [];
  const zipState: { error: Error | null } = { error: null };
  const zip = new Zip((error, chunk) => {
    if (error) {
      zipState.error = new Error(error.message || "The ZIP archive could not be built.");
      return;
    }
    chunks.push(chunk);
  });

  const included: BulkZipIncluded[] = [];
  const failed: BulkZipFailure[] = [];
  const skipped: BulkZipSkip[] = plan.skipped;
  let totalInputBytes = 0;
  let truncated = false;
  let done = 0;

  /* The pool. `slots[i]` is the download for entry `i` once it has been started;
     the consumer awaits them in index order while `next` keeps the pool full. */
  const slots: (Promise<Uint8Array> | undefined)[] = new Array<Promise<Uint8Array> | undefined>(
    total
  );
  let next = 0;
  const startNext = (): void => {
    if (next >= total) return;
    const index = next++;
    slots[index] = options.download(entries[index].path);
  };

  for (let i = 0; i < Math.min(concurrency, total); i++) startNext();

  for (let i = 0; i < total; i++) {
    const entry = entries[i];

    let bytes: Uint8Array | null = null;
    try {
      const slot = slots[i];
      if (!slot) throw new Error("The document was never scheduled for download.");
      bytes = await slot;
    } catch (error) {
      failed.push({
        billId: entry.billId,
        invoiceNo: entry.invoiceNo,
        copy: entry.copy,
        filename: entry.filename,
        error: describeError(error),
      });
    }

    /* Refill before compressing, so the freed slot is used while the (synchronous)
       deflate for this document runs. A failed slot is freed the same way. */
    startNext();

    if (bytes) {
      if (totalInputBytes + bytes.byteLength > maxInputBytes) {
        truncated = true;
        skipped.push({
          billId: entry.billId,
          invoiceNo: entry.invoiceNo,
          copy: entry.copy,
          reason: "size-limit",
          detail: "Not added: this archive reached its size limit. Download the rest in a smaller batch.",
        });
      } else {
        const file = new ZipDeflate(entry.filename, { level: 6 });
        zip.add(file);
        file.push(bytes, true);
        totalInputBytes += bytes.byteLength;
        included.push({
          billId: entry.billId,
          invoiceNo: entry.invoiceNo,
          copy: entry.copy,
          filename: entry.filename,
          bytes: bytes.byteLength,
        });
      }
    }

    done++;
    options.onProgress?.({
      done,
      total,
      billId: entry.billId,
      invoiceNo: entry.invoiceNo,
      copy: entry.copy,
    });
  }

  zip.end();
  if (zipState.error) throw zipState.error;

  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }

  return {
    archiveName: plan.archiveName,
    bytes,
    included,
    skipped,
    failed,
    totalInputBytes,
    truncated,
  };
}

/* ──────────────────────────────────────────────
   Reporting
   ────────────────────────────────────────────── */

/** A short, honest account of what did NOT make it into the archive. */
export interface BulkZipShortfall {
  /** How many requested PDFs are missing (skipped + failed). */
  count: number;
  /** Up to `max` lines naming the reason, for the user to act on. */
  examples: string[];
}

function zipBillLabel(invoiceNo: string | null, billId: string): string {
  const name = (invoiceNo ?? "").trim();
  return name || `Bill ${billId.slice(0, 8)}`;
}

/**
 * Turn the parts of an outcome that are NOT PDFs in the archive into lines a user
 * can read, or `null` when everything requested went in.
 *
 * Kept here, beside the builder, so the desktop report and the mobile report are
 * worded from one place and a test can assert the wording. The caller still decides
 * the tone (success/warning/error) and how many lines to show.
 */
export function summarizeBulkZipShortfall(
  outcome: Pick<BulkZipOutcome, "included" | "skipped" | "failed">,
  max = 3
): BulkZipShortfall | null {
  const lines: string[] = [];
  for (const failure of outcome.failed) {
    lines.push(
      `${zipBillLabel(failure.invoiceNo, failure.billId)} · ${BILL_COPY_LABEL[failure.copy]} — ${failure.error}`
    );
  }
  for (const skip of outcome.skipped) {
    lines.push(
      `${zipBillLabel(skip.invoiceNo, skip.billId)} · ${BILL_COPY_LABEL[skip.copy]} — ${skip.detail}`
    );
  }
  if (lines.length === 0) return null;
  return { count: lines.length, examples: lines.slice(0, Math.max(0, max)) };
}

