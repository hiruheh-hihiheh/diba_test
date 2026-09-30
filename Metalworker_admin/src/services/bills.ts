// src/services/bills.ts
//
// Data access for the Bills section (Expo admin app).
//
// Everything that needs the service role (parsing the workbook, rendering PDFs,
// writing to the private `bills` bucket) happens in the `process-bill-upload`
// edge function. This module only ever uses the signed-in admin's own session
// key, and every read/write it performs is additionally gated by the RLS
// policies in migration 0005 — so a worker token is refused by the database, not
// merely hidden in the UI.
//
// The three copies (original / duplicate / triplicate) are three print copies of
// ONE bill. They are stored as three separate PDFs but only ONE `bills` row, so
// nothing here ever multiplies a financial figure by three.
//
// Platform split: reading the picked workbook and opening/printing a PDF use
// native modules on Android/iOS and browser APIs on web, chosen with an explicit
// `Platform.OS` branch so neither platform imports the other's world. The
// resulting PDFs are byte-identical because they are generated server-side.

import { Platform } from "react-native";

import { supabase } from "./supabase";
import { logAudit } from "./auditLog";
import type {
  Bill,
  BillColumns,
  BillCopy,
  BillLineItem,
  BillUpload,
  BillUploadResult,
  BillUploadStage,
  FolderBillSummary,
} from "../types/bill";
import { EMPTY_FOLDER_BILL_SUMMARY, BILL_COPY_LABEL } from "../types/bill";

const BILLS = "bills";
const UPLOADS = "bill_uploads";
const LINE_ITEMS = "bill_line_items";
const FOLDER_ITEMS = "folder_items";
const BUCKET = "bills";

/** Mirrors the edge function's own cap; checked client-side to fail fast. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/* ──────────────────────────────────────────────
   Listing
   ────────────────────────────────────────────── */

/**
 * `bills` joined to its upload.
 *
 * The inner join is deliberate: a `bills` row is meaningless without the
 * workbook it came from (the PDFs live on the upload), and the join shape is
 * what `Bill` describes.
 */
const BILL_WITH_UPLOAD =
  "*, bill_uploads!inner(id, original_filename, base_name, created_at, status)";

/** The upload columns embedded by `BILL_WITH_UPLOAD`. */
type EmbeddedUpload = Pick<
  BillUpload,
  "id" | "original_filename" | "base_name" | "created_at" | "status"
>;

/**
 * What PostgREST ACTUALLY returns for `BILL_WITH_UPLOAD`.
 *
 * The embedded row arrives NESTED under the relation name. It is NOT merged onto
 * the parent row, so `original_filename` is only reachable as
 * `row.bill_uploads.original_filename`. Declaring this shape is what makes the
 * flattening below visible to the type checker — casting the response straight to
 * `Bill` compiles, silently yields `undefined` for every joined field, and breaks
 * the filename, the copy buttons, the delete confirmation and the detail header
 * all at once with no error anywhere.
 *
 * The three `*_pdf_path` columns are declared on the ROW, not the embedded upload,
 * because since migration 0007 they belong to the bill itself.
 */
type BillRowWithUpload = BillColumns & {
  bill_upload_id: string;
  sheet_name: string;
  original_pdf_path: string | null;
  duplicate_pdf_path: string | null;
  triplicate_pdf_path: string | null;
  bill_uploads: EmbeddedUpload | null;
};

/**
 * Which classification bucket a bill falls into on the Bills screen.
 *
 * `other` exists so an unrecognised `job_kind` is never silently dropped: a
 * workbook with a job type this build has never seen still shows those bills,
 * under their own cleaned-up label, rather than vanishing from a two-bucket list.
 */
export type BillJobGroup = "with_metal" | "labour" | "other";

/**
 * Map one stored `job_kind` to its bucket, using the SAME squashed-key rule as
 * `formatJobKind` so the filter and the label can never disagree.
 */
export function jobGroupOf(jobKind: string | null | undefined): BillJobGroup {
  if (jobKind === null || jobKind === undefined) return "other";
  const key = String(jobKind).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (key === "WITHMETAL" || key === "WITHMATERIAL") return "with_metal";
  if (key === "LABOURJOB" || key === "LABOUR") return "labour";
  return "other";
}

/** One row of the job-type facet strip. */
export interface BillJobFacet {
  group: BillJobGroup;
  /** The label to show, e.g. "WITH METAL", "LABOUR JOB", or the cleaned raw value. */
  label: string;
  /** How many bills carry this exact stored value. */
  count: number;
  /** The stored value itself, so the list query can filter on it exactly. */
  raw: string | null;
}
/**
 * Lift the embedded upload onto the bill row, which is the shape `Bill` promises
 * and every screen reads.
 *
 * The PDF paths are deliberately NOT touched. They live on the `bills` row itself
 * (migration 0007) and `select("*")` already returned them; the upload no longer
 * carries any. `status` is renamed to `upload_status` so it can never be mistaken
 * for a `bills` column, and `created_at` is deliberately left as the BILL's own
 * timestamp, not the upload's.
 *
 * `!inner` means the upload is always present, but the type is honest about the
 * possibility: a missing parent degrades to empty strings, which the UI shows as
 * an unknown workbook rather than crashing.
 */
function flattenBill(row: BillRowWithUpload): Bill {
  const { bill_uploads: upload, ...own } = row;
  return {
    ...own,
    original_filename: upload?.original_filename ?? "",
    base_name: upload?.base_name ?? "",
    upload_status: upload?.status ?? null,
  };
}

/**
 * Every distinct `job_kind` in the database, bucketed and counted, for the facet
 * strip on the Bills screen.
 *
 * Read from the raw column and bucketed here with `jobGroupOf`, rather than
 * filtering the column by a pattern. The vocabulary is tiny in practice (a
 * workbook writes one of a handful of spellings), so one bounded select is enough;
 * the bound is stated rather than assumed.
 */
export async function fetchBillJobFacets(): Promise<BillJobFacet[]> {
  const FACET_SCAN_LIMIT = 5000;
  const { data, error } = await supabase
    .from(BILLS)
    .select("job_kind")
    .limit(FACET_SCAN_LIMIT);
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { job_kind: string | null }[]) {
    const key = row.job_kind ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([raw, count]) => ({
      raw: raw === "" ? null : raw,
      count,
      group: jobGroupOf(raw === "" ? null : raw),
      label: raw === "" ? "Unclassified" : (formatJobKind(raw) ?? raw),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface BillQuery {
  /** Free text: invoice no, filename, sheet name, party name or party GST. */
  search?: string;
  /** Restrict to one uploaded workbook. */
  uploadId?: string | null;
  /** ISO `YYYY-MM-DD` inclusive bounds on `invoice_date`. */
  from?: string | null;
  to?: string | null;
  /**
   * Restrict to one job-type bucket.
   *
   * Takes the RAW stored `job_kind` values, not the label, because `job_kind` is
   * stored verbatim ("WITHMETAL", "LABOUR JOB", "Labour") and the list query has
   * to match the column exactly. `fetchBillJobFacets()` produces them.
   *
   * `null` means no restriction, which is what "All" sends.
   */
  jobKindValues?: string[] | null;
  page?: number;
  pageSize?: number;
}

export interface BillPage {
  rows: Bill[];
  /** Total matching rows, ignoring pagination. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * PostgREST's `or=(...)` grammar uses commas and parentheses as separators, so a
 * search term containing them changes the FILTER rather than the needle. A user
 * pasting "SEW/274,2026" would otherwise get a confusing empty list or an error.
 */
function safeOrTerm(raw: string): string {
  return raw.replace(/[,()%*]/g, " ").trim();
}

/**
 * Bill ids for an upload, used to unlink the bill from any folder before the
 * upload row is deleted.
 */
async function fetchBillIdsForUpload(uploadId: string): Promise<string[]> {
  const { data, error } = await supabase.from(BILLS).select("id").eq("bill_upload_id", uploadId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

export async function fetchBills(query: BillQuery = {}): Promise<BillPage> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, query.pageSize ?? 50));

  let q = supabase
    .from(BILLS)
    .select(BILL_WITH_UPLOAD, { count: "exact" })
    // Newest invoice first, then newest row, so the order is total and stable
    // (two bills sharing an invoice date must not swap places between pages).
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (query.uploadId) q = q.eq("bill_upload_id", query.uploadId);
  if (query.from) q = q.gte("invoice_date", query.from);
  if (query.to) q = q.lte("invoice_date", query.to);

  /* Job-type grouping is a FILTER on the one classification column, not a second
     data source: no rows are duplicated, and a bill appears under exactly one
     bucket because the stored value maps to exactly one bucket.

     `is.null` handles the unclassified case, because a null `job_kind` is a real
     value in the column and `in.(...)` cannot express it. */
  if (query.jobKindValues) {
    if (query.jobKindValues.length === 0) {
      // An empty facet selection is "no bills carry this", not "all bills".
      q = q.eq("id", "00000000-0000-0000-0000-000000000000");
    } else if (query.jobKindValues.includes("")) {
      const present = query.jobKindValues.filter((v) => v !== "");
      if (present.length === 0) q = q.is("job_kind", null);
      else q = q.or(`job_kind.is.null,job_kind.in.(${present.map(safeOrTerm).join(",")})`);
    } else {
      q = q.in("job_kind", query.jobKindValues);
    }
  }

  const needle = safeOrTerm((query.search ?? "").trim());
  if (needle) {
    // The filename lives on the parent table, so it cannot be part of the same
    // `or` group as the bill columns. Resolve it to upload ids first and fold
    // the ids into the group as an `in` clause: both sides then share one
    // filter, which is the only way PostgREST can OR across the join.
    const { data: matches, error: upErr } = await supabase
      .from(UPLOADS)
      .select("id")
      .ilike("original_filename", `%${needle}%`);
    if (upErr) throw new Error(upErr.message);

    const uploadIds = (matches ?? []).map((r) => r.id as string);
    const parts = [
      `invoice_no.ilike.%${needle}%`,
      `sheet_name.ilike.%${needle}%`,
      `party_gst_no.ilike.%${needle}%`,
      `party_name.ilike.%${needle}%`,
    ];
    if (uploadIds.length > 0) parts.push(`bill_upload_id.in.(${uploadIds.join(",")})`);
    q = q.or(parts.join(","));
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) throw new Error(error.message);

  return {
    rows: ((data ?? []) as unknown as BillRowWithUpload[]).map(flattenBill),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function fetchBill(id: string): Promise<Bill> {
  const { data, error } = await supabase
    .from(BILLS)
    .select(BILL_WITH_UPLOAD)
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return flattenBill(data as unknown as BillRowWithUpload);
}

export async function fetchBillLineItems(billId: string): Promise<BillLineItem[]> {
  const { data, error } = await supabase
    .from(LINE_ITEMS)
    .select("*")
    .eq("bill_id", billId)
    .order("sr_no", { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillLineItem[];
}

export async function fetchBillUploads(): Promise<BillUpload[]> {
  const { data, error } = await supabase
    .from(UPLOADS)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillUpload[];
}

export async function fetchBillUpload(id: string): Promise<BillUpload> {
  const { data, error } = await supabase.from(UPLOADS).select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as BillUpload;
}

/* ──────────────────────────────────────────────
   Upload
   ────────────────────────────────────────────── */

/** A request failure carrying the server's own explanation and machine reason. */
export class BillUploadError extends Error {
  readonly reason: string | null;
  constructor(message: string, reason: string | null = null) {
    super(message);
    this.name = "BillUploadError";
    this.reason = reason;
  }
}

/** A workbook the user chose, before it is handed to the edge function. */
export interface PickedBillWorkbook {
  name: string;
  /** Local file URI (native) or object/data URL (web). */
  uri: string;
  size: number;
  /**
   * Base64 without a data-URI prefix.
   *
   * Present on web, where the picker hands the encoded file straight back. On
   * native it is filled in from `expo-file-system` so the big string is only
   * materialised once, immediately before the request.
   */
  base64?: string;
}

/**
 * Open the system file picker for a bill workbook.
 *
 * The MIME type filter is left open on purpose: many Android providers report
 * an `.xlsx` as
 * `application/octet-stream`, so filtering on the OOXML MIME type would hide
 * valid workbooks behind an empty picker. The extension is validated here
 * instead, with a message that says what is actually accepted.
 *
 * Returns `null` when the user cancels — the caller should do nothing then.
 */
export async function pickBillWorkbook(): Promise<PickedBillWorkbook | null> {
  const { getDocumentAsync } = await import("expo-document-picker");

  const result = await getDocumentAsync({
    type: "*/*",
    multiple: false,
    // Required on native so `expo-file-system` can read the file immediately
    // after the picker returns. Ignored on web.
    copyToCacheDirectory: true,
    // On web this makes the picker return the encoded file rather than a URL.
    base64: Platform.OS === "web",
  });

  if (result.canceled || !result.assets || result.assets.length === 0) return null;
  const asset = result.assets[0];

  if (!/\.xlsx$/i.test(asset.name)) {
    throw new BillUploadError(
      `Only .xlsx Excel workbooks are supported — "${asset.name}" is not one.`,
      "bad_type"
    );
  }

  const size = asset.size ?? 0;
  if (size > MAX_UPLOAD_BYTES) {
    throw new BillUploadError("That workbook is larger than 50 MB.", "too_large");
  }
  if (size === 0) {
    throw new BillUploadError("That file is empty.", "empty_file");
  }

  return {
    name: asset.name,
    uri: asset.uri,
    size,
    base64: asset.base64 ?? undefined,
  };
}

/** Base64 for the chosen file, reading it natively only when it is not in hand. */
async function readWorkbookBase64(picked: PickedBillWorkbook): Promise<string> {
  if (picked.base64) return picked.base64;
  if (Platform.OS === "web") {
    // The picker was asked for base64, so this only happens if the browser gave
    // us something unexpected. Say so rather than uploading a broken body.
    throw new BillUploadError(
      "That workbook could not be read from this device. Try picking it again.",
      "unreadable"
    );
  }
  const { File: ExpoFile } = await import("expo-file-system");
  return new ExpoFile(picked.uri).base64();
}

export interface UploadCallbacks {
  /** Called as each pipeline step starts or finishes. */
  onStage?: (stage: BillUploadStage) => void;
}

/**
 * The edge function's response body.
 *
 * Declared separately from the local variable it is assigned to: naming it here
 * (rather than inline on the `let`) would make the declaration refer to itself
 * and collapse to `never`.
 */
interface ProcessBillUploadResponse {
  ok?: boolean;
  error?: string;
  reason?: string;
  upload_id?: string;
  base_name?: string;
  invoice_count?: number;
  /** One entry per bill, each carrying its own three document paths. */
  bills?: {
    id: string;
    sheet_name: string;
    invoice_no: string | null;
    job_kind: string | null;
    paths: { original: string; duplicate: string; triplicate: string };
  }[];
  /** The optional whole-workbook documents, kept separate on purpose. */
  aggregate_pdfs?: {
    copy: BillCopy;
    label: string;
    path: string;
    filename: string;
    scope: "workbook";
  }[];
}

/**
 * Upload one workbook and let the server do everything else.
 *
 * The seven stages below are the server's real pipeline. Only the first three are
 * observable from here (reading the file, sending it, then the server accepting);
 * the function answers with a single JSON document, so the later steps are
 * advanced on a timer while the request is in flight and are only ever
 * *confirmed* by the real response. That is why the upload panel shows a step
 * list and not a percentage bar — a bar would claim a precision the API does
 * not provide.
 */
export async function uploadBillWorkbook(
  picked: PickedBillWorkbook,
  { onStage }: UploadCallbacks = {}
): Promise<BillUploadResult> {
  onStage?.("reading");
  const contentBase64 = await readWorkbookBase64(picked);

  onStage?.("uploading");

  // Steps 4-7 all happen inside one HTTP call, and the function answers with a
  // single JSON document, so their individual completion is not observable from
  // here. They are advanced on a timer purely so the operator can see which
  // phase the upload is in, and every timer is cancelled the moment the real
  // response lands — the response, not the clock, decides where the list ends.
  const serverStages: BillUploadStage[] = [
    "validating",
    "parsing",
    "generating_pdfs",
    "uploading_pdfs",
    "saving",
  ];
  const timers = serverStages.map((stage, i) =>
    setTimeout(() => onStage?.(stage), 800 * (i + 1))
  );
  const stopIndicativeStages = () => {
    for (const t of timers) clearTimeout(t);
  };

  /* Wrapped so `finally` can stop the indicative timers on both paths without
     needing a `let` for the result — a pre-declared `let` assigned only inside
     `try` reads as a dead initial value. */
  const res = await (async () => {
    try {
      return await supabase.functions.invoke<ProcessBillUploadResponse>(
        "process-bill-upload",
        { body: { filename: picked.name, content_base64: contentBase64 } }
      );
    } finally {
      stopIndicativeStages();
    }
  })();

  const data = res.data ?? null;
  const error = res.error ?? null;

  if (error) {
    // A non-2xx response also carries a JSON body, which supabase-js puts in
    // `error.context` rather than throwing the message away. Reading it is how
    // the specific "sheet '292' has no TRIPLICATE" explanation survives.
    const body = await readErrorBody(error);
    if (body) {
      throw new BillUploadError(body.error || "That workbook could not be processed.", body.reason);
    }
    throw new BillUploadError(
      error.message || "The bill upload could not reach the server.",
      "network"
    );
  }

  if (!data?.ok) {
    throw new BillUploadError(data?.error || "That workbook could not be processed.", data?.reason ?? null);
  }

  onStage?.("completed");

  return {
    upload_id: data.upload_id as string,
    base_name: data.base_name as string,
    invoice_count: data.invoice_count ?? 0,
    bills: data.bills ?? [],
    aggregate_pdfs: data.aggregate_pdfs ?? [],
  };
}

/**
 * Pull the JSON body out of a failed `functions.invoke`.
 *
 * supabase-js hands back a `FunctionsHttpError` whose `context` is the
 * `Response`; its text is the only place the server's specific explanation
 * lives. If it cannot be read we return null and the caller falls back to the
 * transport message.
 */
async function readErrorBody(
  error: { context?: unknown; message?: string }
): Promise<{ error?: string; reason?: string } | null> {
  try {
    const ctx = error.context;
    if (ctx && typeof (ctx as Response).text === "function") {
      const text = await (ctx as Response).text();
      if (!text) return null;
      const parsed = JSON.parse(text) as { error?: string; reason?: string };
      return parsed && typeof parsed === "object" ? parsed : null;
    }
  } catch {
    // A body we cannot parse is not worth failing over; the transport message
    // below is still shown.
  }
  return null;
}

/* ──────────────────────────────────────────────
   PDFs
   ────────────────────────────────────────────── */

/** The three storage paths, i.e. everything needed to resolve a bill's documents. */
export type BillDocumentSource = Pick<
  Bill,
  "original_pdf_path" | "duplicate_pdf_path" | "triplicate_pdf_path"
> & {
  invoice_no?: string | null;
  sheet_name?: string | null;
  base_name?: string | null;
};

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
 * say why, because handing back a 20-page PDF in response to "open invoice 301" is
 * the bug being fixed, not a degraded version of it.
 */
export function isLegacyBill(source: BillDocumentSource): boolean {
  return !source.original_pdf_path && !source.duplicate_pdf_path && !source.triplicate_pdf_path;
}

/**
 * The download filename for one copy, derived from the BILL, not the workbook.
 *
 * `SEW/301/2026-27` -> `SEW_301_2026-27_original.pdf`, so a user who downloads
 * three bills has three sensibly named files rather than three files all called
 * after the source workbook. Mirrors `safeBillToken` in the edge function's
 * `_shared/parseBill.ts`, which names the stored object; they must agree or the
 * saved name would not match the stored one.
 */
export function billDocumentFilename(source: BillDocumentSource, copy: BillCopy): string {
  const raw = (source.invoice_no ?? "").trim() || (source.sheet_name ?? "").trim() || "bill";
  const token =
    raw
      // Slashes become "_" so they cannot create a nested object path, while a
      // hyphen that is part of the number is kept.
      .replace(/[\\/]+/g, "_")
      // Hyphen is deliberately preserved: it is safe in a storage object name and
      // in a download filename, and `SEW_301_2026-27` reads far better than
      // `SEW_301_2026_27`. Must match `safeBillToken` in the edge function.
      .replace(/[<>:"/\\|?*\s]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^[_.]+|[_.]+$/g, "")
      .slice(0, 60) || "bill";
  return `${token}_${copy}.pdf`;
}

/** Signed URLs are short-lived; two minutes is enough to open or print. */
const SIGNED_URL_TTL_SECONDS = 120;

/**
 * Mint a short-lived signed URL for ONE COPY OF ONE BILL.
 *
 * The bucket is private, so this is the only way a client can read a PDF. The path
 * comes from the `bills` row and is a single-invoice document, so the URL cannot
 * resolve to a sibling's figures. There is deliberately no fallback to the
 * workbook-level document.
 */
export async function getBillPdfUrl(source: BillDocumentSource, copy: BillCopy): Promise<string> {
  if (isLegacyBill(source)) {
    throw new Error(
      "This bill was uploaded before each bill got its own document, so there is no single-invoice PDF for it. Re-upload the workbook to generate one."
    );
  }
  const path = billCopyPath(source, copy);
  if (!path) {
    throw new Error(`The ${BILL_COPY_LABEL[copy]} copy is not available for this bill.`);
  }
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
      download: billDocumentFilename(source, copy),
    });
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error("Could not open that document.");
  return data.signedUrl;
}

/**
 * Fetch a copy into the app cache and return the local file.
 *
 * `expo-sharing` can only hand a *local* file to another app, and the print
 * module is far more reliable with a local path than with a signed URL that may
 * expire mid-flow. Downloading first also means the file name the user sees is
 * the one the sheet was created with.
 */
async function downloadBillPdfToCache(
  url: string,
  filename: string
): Promise<{ uri: string; remove: () => void }> {
  const { Directory, File, Paths } = await import("expo-file-system");

  const dir = new Directory(Paths.cache, "bills");
  if (!dir.exists) dir.create();
  const target = new File(dir, filename);
  if (target.exists) target.delete();

  const downloaded = await File.downloadFileAsync(url, target);
  return { uri: downloaded.uri, remove: () => downloaded.delete() };
}

/** Open a copy in whatever viewer the device has, via the system share sheet. */
export async function viewBillPdf(
  source: Parameters<typeof getBillPdfUrl>[0],
  copy: BillCopy
): Promise<void> {
  const url = await getBillPdfUrl(source, copy);
  const filename = billDocumentFilename(source, copy);

  if (Platform.OS === "web") {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      throw new Error("Your browser blocked the new tab. Allow pop-ups for this site to view bills.");
    }
    return;
  }

  const { isAvailableAsync, shareAsync } = await import("expo-sharing");
  if (!(await isAvailableAsync())) {
    throw new Error("No app on this device can open PDF files.");
  }
  const file = await downloadBillPdfToCache(url, filename);
  try {
    await shareAsync(file.uri, {
      UTI: ".pdf",
      mimeType: "application/pdf",
      dialogTitle: filename,
    });
  } finally {
    // The cache copy has served its purpose; the signed URL still works.
    file.remove();
  }
}

/** Save a copy to the device under its real filename. */
export async function downloadBillPdf(
  source: Parameters<typeof getBillPdfUrl>[0],
  copy: BillCopy
): Promise<void> {
  const url = await getBillPdfUrl(source, copy);
  const filename = billDocumentFilename(source, copy);

  if (Platform.OS === "web") {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  // Native has no "save to downloads" primitive. The system share sheet is the
  // supported route to Files / Drive / Mail / a PDF editor, which is a real save
  // rather than a fake one.
  const { isAvailableAsync, shareAsync } = await import("expo-sharing");
  if (!(await isAvailableAsync())) {
    throw new Error("No app on this device can save PDF files.");
  }
  const file = await downloadBillPdfToCache(url, filename);
  try {
    await shareAsync(file.uri, {
      UTI: ".pdf",
      mimeType: "application/pdf",
      dialogTitle: filename,
    });
  } finally {
    file.remove();
  }
}

/**
 * Print a copy through the real print flow.
 *
 * Native: `expo-print` hands the PDF to the platform print dialog (AirPrint /
 * Android Print Framework). `uri` accepts a remote URL, so the signed link is
 * used directly and no copy is left on the device.
 *
 * Web: the PDF is fetched into a blob and framed in a hidden iframe rather than
 * pointed at directly, because a bare `<iframe src=signedUrl>` gets the
 * browser's own PDF viewer chrome, which has no scriptable print hook — so
 * `contentWindow.print()` would be unavailable and the dialog would never open.
 *
 * The iframe and its object URL are always revoked, including when the blob
 * fails to load, so a failed print does not leak memory.
 */
export async function printBillPdf(
  source: Parameters<typeof getBillPdfUrl>[0],
  copy: BillCopy
): Promise<void> {
  const url = await getBillPdfUrl(source, copy);

  if (Platform.OS !== "web") {
    const { printAsync } = await import("expo-print");
    await printAsync({ uri: url });
    return;
  }

  let objectUrl: string | null = null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("The document could not be loaded for printing.");
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    // Tagged so the finally block can find it without holding a stale reference
    // if the caller navigates away mid-print.
    frame.setAttribute("data-bill-print", "");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The document took too long to load.")), 15000);
      frame.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      frame.onerror = () => {
        clearTimeout(timer);
        reject(new Error("The document could not be displayed for printing."));
      };
      frame.src = objectUrl as string;
    });

    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  } catch {
    // Some browsers refuse to print a blob frame (sandboxing, extensions). The
    // honest fallback is the real viewer, from which the user can print.
    window.open(url, "_blank", "noopener,noreferrer");
  } finally {
    document.querySelectorAll("iframe[data-bill-print]").forEach((el) => el.remove());
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/* ──────────────────────────────────────────────
   Delete
   ────────────────────────────────────────────── */

/**
 * Delete ONE bill, and only what that bill owns.
 *
 * This is the operation a bill card's Delete button means. Sibling invoices from
 * the same workbook are untouched — same line items, same documents, same folder
 * memberships.
 *
 * Order is the reverse of creation:
 *   1. folder_items pointing at THIS bill   — otherwise the folder would list an
 *      entry whose record no longer exists.
 *   2. this bill's line items.
 *   3. this bill's row.
 *   4. this bill's own three PDF objects.
 *
 * The rows go before the files deliberately: if the storage call then fails, the
 * leftovers are unreferenced objects, which cost nothing. The other order would
 * leave live rows pointing at documents that are already gone.
 *
 * The parent `bill_uploads` row is removed ONLY when this was the workbook's last
 * bill, so a workbook that still has invoices keeps its provenance and its
 * optional aggregate document.
 *
 * Removing a bill from a folder without deleting it is a different operation
 * (`removeItemFromFolder`) and touches none of this.
 */
export async function deleteBill(billId: string): Promise<{
  ok: boolean;
  error?: string;
  /** Bills from the same workbook that survived, for the confirmation message. */
  siblingsRemaining?: number;
}> {
  // Read what we need BEFORE deleting, because afterwards it is gone.
  type BillToDelete = Pick<
    Bill,
    "invoice_no" | "sheet_name" | "bill_upload_id" | "original_pdf_path" | "duplicate_pdf_path" | "triplicate_pdf_path"
  >;
  let bill: BillToDelete;
  try {
    const { data, error } = await supabase
      .from(BILLS)
      .select("invoice_no, sheet_name, bill_upload_id, original_pdf_path, duplicate_pdf_path, triplicate_pdf_path")
      .eq("id", billId)
      .single();
    if (error) throw new Error(error.message);
    bill = data as BillToDelete;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read that bill." };
  }

  // Used in the failure messages so an error names the invoice the user tapped.
  const label = bill.invoice_no?.trim() || bill.sheet_name?.trim() || "this bill";

  const { error: folderError } = await supabase
    .from(FOLDER_ITEMS)
    .delete()
    .eq("item_type", "bill")
    .eq("item_id", billId);
  if (folderError) {
    return {
      ok: false,
      error: `Could not unlink ${label} from its folders: ${folderError.message}`,
    };
  }

  const { error: linesError } = await supabase.from(LINE_ITEMS).delete().eq("bill_id", billId);
  if (linesError) {
    return { ok: false, error: `Could not delete the line items of ${label}: ${linesError.message}` };
  }

  const { error: billError } = await supabase.from(BILLS).delete().eq("id", billId);
  if (billError) {
    return { ok: false, error: `Could not delete ${label}: ${billError.message}` };
  }

  // Only THIS bill's documents. The workbook's aggregate PDF is another bill's
  // business and, while any sibling exists, a live provenance artefact.
  const paths = [bill.original_pdf_path, bill.duplicate_pdf_path, bill.triplicate_pdf_path].filter(
    (p): p is string => !!p
  );
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    // Reported, never fatal: the records are already gone and correct.
    if (storageError) {
      console.warn("[Bills] PDF cleanup after deleting one bill failed:", storageError.message, paths);
    }
  }

  // Did that empty the workbook? If so the upload row is now a husk.
  const { data: remaining } = await supabase
    .from(BILLS)
    .select("id")
    .eq("bill_upload_id", bill.bill_upload_id);
  const siblingsRemaining = Array.isArray(remaining) ? remaining.length : 0;

  if (siblingsRemaining === 0) {
    const { data: upload } = await supabase
      .from(UPLOADS)
      .select("original_pdf_path, duplicate_pdf_path, triplicate_pdf_path")
      .eq("id", bill.bill_upload_id)
      .maybeSingle();
    const orphanAggregate = [
      upload?.original_pdf_path,
      upload?.duplicate_pdf_path,
      upload?.triplicate_pdf_path,
    ].filter((p): p is string => !!p);

    const { error: uploadError } = await supabase
      .from(UPLOADS)
      .delete()
      .eq("id", bill.bill_upload_id);
    // The bill is already gone, which is what was asked for. Report the husk
    // rather than pretending the whole thing failed.
    if (uploadError) {
      console.warn("[Bills] empty upload row could not be removed:", uploadError.message);
    }
    if (orphanAggregate.length > 0) {
      const { error: aggError } = await supabase.storage.from(BUCKET).remove(orphanAggregate);
      if (aggError) {
        console.warn("[Bills] aggregate PDF cleanup failed:", aggError.message, orphanAggregate);
      }
    }
  }

  void logAudit({
    action: "bill.deleted",
    targetType: "bill",
    targetId: billId,
    detail: {
      invoice_no: bill.invoice_no,
      sheet_name: bill.sheet_name,
      upload_id: bill.bill_upload_id,
      documents_removed: paths.length,
      siblings_remaining: siblingsRemaining,
      upload_removed: siblingsRemaining === 0,
    },
  });

  return { ok: true, siblingsRemaining };
}
export async function deleteBillUpload(uploadId: string): Promise<{ ok: boolean; error?: string }> {
  let billIds: string[];
  let upload: BillUpload;
  let perBillPaths: string[];
  try {
    billIds = await fetchBillIdsForUpload(uploadId);
    upload = await fetchBillUpload(uploadId);
    // The upload row CASCADEs to `bills`, but storage objects are not in the
    // database and so do not cascade. Every bill's own three documents have to be
    // collected explicitly or they are orphaned in the bucket.
    const { data: billRows, error: pathsError } = await supabase
      .from(BILLS)
      .select("original_pdf_path, duplicate_pdf_path, triplicate_pdf_path")
      .eq("bill_upload_id", uploadId);
    if (pathsError) throw new Error(pathsError.message);
    perBillPaths = (billRows ?? [])
      .flatMap((r) => {
        const row = r as {
          original_pdf_path: string | null;
          duplicate_pdf_path: string | null;
          triplicate_pdf_path: string | null;
        };
        return [row.original_pdf_path, row.duplicate_pdf_path, row.triplicate_pdf_path];
      })
      .filter((p): p is string => !!p);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read that upload." };
  }

  if (billIds.length > 0) {
    const { error } = await supabase
      .from(FOLDER_ITEMS)
      .delete()
      .eq("item_type", "bill")
      .in("item_id", billIds);
    if (error) return { ok: false, error: `Could not unlink the bills from their folders: ${error.message}` };
  }

  const { error: uploadError } = await supabase.from(UPLOADS).delete().eq("id", uploadId);
  if (uploadError) return { ok: false, error: uploadError.message };

  const paths = [
    ...perBillPaths,
    upload.original_pdf_path,
    upload.duplicate_pdf_path,
    upload.triplicate_pdf_path,
  ].filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove(paths);
    // Reported, never fatal: the records are already gone and correct.
    if (storageError) {
      console.warn("[Bills] PDF cleanup after delete failed:", storageError.message, paths);
    }
  }

  void logAudit({
    action: "bill.deleted",
    targetType: "bill_upload",
    targetId: uploadId,
    detail: { filename: upload.original_filename, bill_count: billIds.length },
  });

  return { ok: true };
}

/* ──────────────────────────────────────────────
   Folder summary
   ────────────────────────────────────────────── */

/**
 * Financial totals for a folder, over UNIQUE bills only.
 *
 * The aggregation is done by the `get_folder_bill_summary` RPC (migration
 * 0006) rather than in the client, because only the server can see every bill
 * regardless of RLS and because the de-duplication rule (one row per bill, never
 * per print copy) must not be reimplemented twice and drift.
 */
/**
 * One row of `get_folder_bill_summary`'s result, as migration 0006 declares it.
 *
 * These column names deliberately do NOT all match `FolderBillSummary` (0006 says
 * `amount_before_tax`, the type says `total_amount_before_tax`). Rather than
 * pretend the two agree, the mapping below states the translation explicitly, so
 * neither side can drift into a silent zero.
 */
interface FolderBillSummaryRpcRow {
  total_bills: number | string | null;
  total_quantity: number | string | null;
  amount_before_tax: number | string | null;
  cgst: number | string | null;
  sgst: number | string | null;
  igst: number | string | null;
  total_gst: number | string | null;
  amount_after_tax: number | string | null;
  round_off: number | string | null;
  avg_bill_value: number | string | null;
  avg_quantity: number | string | null;
  avg_amount_before_tax: number | string | null;
}

export async function fetchFolderBillSummary(folderId: string): Promise<FolderBillSummary> {
  const { data, error } = await supabase.rpc("get_folder_bill_summary", {
    p_folder_id: folderId,
  });
  if (error) throw new Error(error.message);

  /* `RETURNS TABLE` is a SET, so PostgREST answers with an ARRAY holding one row
     - not the row itself. Spreading the array would yield `{0: {…}}`, every named
     figure would fall through to the EMPTY default, and the summary panel would
     silently never render. Unwrap before reading anything. */
  const row = (Array.isArray(data) ? data[0] : data) as FolderBillSummaryRpcRow | undefined;
  if (!row) return { ...EMPTY_FOLDER_BILL_SUMMARY };

  /* The RPC already guards division by zero; the `?? 0` is so a null average can
     never reach a formatter as NaN on an empty folder. */
  return {
    total_bills: toFiniteNumber(row.total_bills) ?? 0,
    total_quantity: toFiniteNumber(row.total_quantity) ?? 0,
    total_amount_before_tax: toFiniteNumber(row.amount_before_tax) ?? 0,
    total_cgst: toFiniteNumber(row.cgst) ?? 0,
    total_sgst: toFiniteNumber(row.sgst) ?? 0,
    total_igst: toFiniteNumber(row.igst) ?? 0,
    total_gst: toFiniteNumber(row.total_gst) ?? 0,
    total_amount_after_tax: toFiniteNumber(row.amount_after_tax) ?? 0,
    total_round_off: toFiniteNumber(row.round_off) ?? 0,
    average_bill_value: toFiniteNumber(row.avg_bill_value) ?? 0,
    average_quantity: toFiniteNumber(row.avg_quantity) ?? 0,
    average_amount_before_tax: toFiniteNumber(row.avg_amount_before_tax) ?? 0,
  };
}

/* ──────────────────────────────────────────────
   Formatting
   ────────────────────────────────────────────── */

/**
 * Indian digit grouping without `Intl`.
 *
 * `Number.prototype.toLocaleString("en-IN", …)` is correct but not dependable on
 * every Hermes build: a reduced ICU silently falls back to `en-US` grouping, so
 * 15,635 would render as 15.635 on one phone and 15,635 on another. Grouping the
 * last three digits and then pairs is a few lines and always identical, on every
 * platform, which the two clients also need for their figures to match.
 */
function groupIndianInteger(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, digits.length - 3);
  const tail = digits.slice(digits.length - 3);
  let out = "";
  for (let i = head.length; i > 0; i -= 2) {
    out = head.slice(Math.max(0, i - 2), i) + out;
    if (i - 2 > 0) out = "," + out;
  }
  return `${out},${tail}`;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Money with Indian digit grouping and two decimals, and never "₹NaN".
 *
 * `numeric` columns arrive as strings over PostgREST, so every value is coerced
 * first. A non-finite value is an em dash, which is what "not recorded" looks
 * like everywhere else in the app.
 */
export function formatMoney(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n === null) return "—";
  const negative = n < 0;
  const abs = Math.abs(n).toFixed(2);
  const [whole, frac] = abs.split(".");
  return `${negative ? "-" : ""}₹${groupIndianInteger(whole)}.${frac}`;
}

/** Quantity: up to 3 decimals, trailing zeros dropped (1 stays "1", not "1.000"). */
export function formatQuantity(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const whole = Math.floor(abs).toString();
  const frac = (abs - Math.floor(abs)).toFixed(3).slice(2).replace(/0+$/, "");
  const sign = n < 0 ? "-" : "";
  return frac ? `${sign}${groupIndianInteger(whole)}.${frac}` : `${sign}${groupIndianInteger(whole)}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `2026-09-06` -> `06 Sep 2026`, built without `Intl` for the same reason. */
export function formatBillDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const [, y, m, d] = match;
    return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * The job classification, as a label a person can read.
 *
 * WHY THIS EXISTS
 * `bills.job_kind` stores what the source workbook actually said, verbatim, so
 * the database never loses the original. But the workbook is hand-written and the
 * same classification arrives spelled several ways — "LABOUR JOB", "LABOUR",
 * "WITHMETAL", "WITH METAL", "with  material", and once "WITH_METAL" — and
 * "WITHMETAL" is not something to show an operator or print on an invoice. So the
 * stored value stays raw and only the DISPLAY is normalized, here, once, for both
 * the list and the detail view. The PDF renderer has its own copy in
 * `supabase/functions/process-bill-upload/_shared/formatJobKind.ts` because that
 * module is a separate Deno compilation target; the two implementations are
 * identical and deliberately so.
 *
 * This is NOT a second job-type system. It maps a string to a presentable string
 * and nothing else. It never infers the classification from the invoice number,
 * the sheet name, an amount or a description — an invoice that never declared a
 * job type shows nothing, because guessing "LABOUR JOB" onto it would be a
 * fabricated financial classification.
 *
 * Returns `null` when there is nothing to show, so callers can omit the element
 * instead of printing an empty pill.
 */
export function formatJobKind(jobKind: string | null | undefined): string | null {
  if (jobKind === null || jobKind === undefined) return null;

  // Collapse whitespace runs (some templates use tabs) and trim.
  const cleaned = String(jobKind).replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;

  /* Match on a "squashed" key — uppercase, alphanumerics only — so case, spacing,
     hyphens and underscores cannot change the answer. Same trick the field parser
     uses for labels. */
  const key = cleaned.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (key === "LABOURJOB" || key === "LABOUR") return "LABOUR JOB";
  if (key === "WITHMETAL" || key === "WITHMATERIAL") return "WITH METAL";

  /* Unrecognised but non-empty: clean separators and title-case, so an unknown
     classification is visible and readable rather than silently discarded. */
  return cleaned
    .replace(/[_-]+/g, " ")
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}