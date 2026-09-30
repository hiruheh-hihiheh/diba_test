// src/services/bills.ts
//
// Data access for the Bills section.
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

import { supabase } from "../lib/supabase";
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
import { EMPTY_FOLDER_BILL_SUMMARY } from "../types/bill";

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
  "*, bill_uploads!inner(id, original_filename, base_name, created_at, status, original_pdf_path, duplicate_pdf_path, triplicate_pdf_path)";

/** The upload columns embedded by `BILL_WITH_UPLOAD`. */
type EmbeddedUpload = Pick<
  BillUpload,
  | "id"
  | "original_filename"
  | "base_name"
  | "created_at"
  | "status"
  | "original_pdf_path"
  | "duplicate_pdf_path"
  | "triplicate_pdf_path"
>;

/**
 * What PostgREST ACTUALLY returns for `BILL_WITH_UPLOAD`.
 *
 * The embedded row arrives NESTED under the relation name. It is NOT merged onto
 * the parent row, so `original_filename` and the three `*_pdf_path` values are
 * only reachable as `row.bill_uploads.original_filename`. Declaring this shape
 * is what makes the flattening below visible to the type checker — casting the
 * response straight to `Bill` compiles, silently yields `undefined` for every
 * joined field, and breaks the workbook column, the three copy buttons, the
 * delete confirmation and the detail header all at once with no error anywhere.
 */
type BillRowWithUpload = BillColumns & {
  bill_upload_id: string;
  sheet_name: string;
  bill_uploads: EmbeddedUpload | null;
};

/**
 * Lift the embedded upload onto the bill row, which is the shape `Bill`
 * promises and every screen reads.
 *
 * `status` is renamed to `upload_status` so it can never be mistaken for a
 * `bills` column, and `created_at` is deliberately left as the BILL's own
 * timestamp — `bills` has one too, and the upload's is not what "created" means
 * to a user looking at a row.
 *
 * `!inner` means the upload is always present, but the type is honest about the
 * possibility: a missing parent degrades to empty strings and null paths, which
 * the copy buttons already render as "not available" instead of crashing.
 */
function flattenBill(row: BillRowWithUpload): Bill {
  const { bill_uploads: upload, ...own } = row;
  return {
    ...own,
    original_filename: upload?.original_filename ?? "",
    base_name: upload?.base_name ?? "",
    original_pdf_path: upload?.original_pdf_path ?? null,
    duplicate_pdf_path: upload?.duplicate_pdf_path ?? null,
    triplicate_pdf_path: upload?.triplicate_pdf_path ?? null,
    upload_status: upload?.status ?? null,
  };
}

export interface BillQuery {
  /** Free text: invoice no, filename, sheet name, party name or party GST. */
  search?: string;
  /** Restrict to one uploaded workbook. */
  uploadId?: string | null;
  /** ISO `YYYY-MM-DD` inclusive bounds on `invoice_date`. */
  from?: string | null;
  to?: string | null;
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

/** Bytes -> base64, chunked so a large workbook cannot blow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
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
  bills?: { id: string; sheet_name: string }[];
  pdfs?: { copy: BillCopy; label: string; path: string; filename: string }[];
}

/**
 * Upload one workbook and let the server do everything else.
 *
 * The seven stages below are the server's real pipeline. Only the first two are
 * observable from here (reading the file, then sending it); the function answers
 * with a single JSON document, so steps 3-7 are advanced on a timer while the
 * request is in flight and are only ever *confirmed* by the real response. That
 * is why this is a step list and not a percentage bar — a bar would be claiming
 * a precision the API does not provide.
 */
export async function uploadBillWorkbook(
  file: File,
  { onStage }: UploadCallbacks = {}
): Promise<BillUploadResult> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new BillUploadError("Only .xlsx Excel workbooks are supported.", "bad_type");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new BillUploadError("That workbook is larger than 50 MB.", "too_large");
  }
  if (file.size === 0) {
    throw new BillUploadError("That file is empty.", "empty_file");
  }

  onStage?.("reading");
  const contentBase64 = await fileToBase64(file);

  onStage?.("uploading");

  // Steps 3-7 all happen inside one HTTP call, and the function answers with a
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
        { body: { filename: file.name, content_base64: contentBase64 } }
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
    pdfs: data.pdfs ?? [],
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

/** The storage path of one copy, or null when that copy was never produced. */
export function billCopyPath(
  source: Pick<Bill, "original_pdf_path" | "duplicate_pdf_path" | "triplicate_pdf_path">,
  copy: BillCopy
): string | null {
  switch (copy) {
    case "original":
      return source.original_pdf_path;
    case "duplicate":
      return source.duplicate_pdf_path;
    case "triplicate":
      return source.triplicate_pdf_path;
  }
}

/** Signed URLs are short-lived; two minutes is enough to open or print. */
const SIGNED_URL_TTL_SECONDS = 120;

/**
 * Mint a short-lived signed URL for one copy.
 *
 * The bucket is private, so this is the ONLY way a client can read a PDF. The
 * object's last path segment is already `<base>_original.pdf`, and it is passed
 * again as `download` so the browser saves it under exactly that name.
 */
export async function getBillPdfUrl(
  source: Pick<Bill, "original_pdf_path" | "duplicate_pdf_path" | "triplicate_pdf_path"> & {
    base_name?: string | null;
  },
  copy: BillCopy
): Promise<string> {
  const path = billCopyPath(source, copy);
  if (!path) {
    throw new Error(`The ${copy} copy is not available for this bill.`);
  }
  const filename = `${source.base_name || "bill"}_${copy}.pdf`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: filename });
  if (error) throw new Error(error.message);
  if (!data?.signedUrl) throw new Error("Could not open that document.");
  return data.signedUrl;
}

/** Open a copy in a new browser tab, read-only and offline-safe. */
export async function viewBillPdf(
  source: Parameters<typeof getBillPdfUrl>[0],
  copy: BillCopy
): Promise<void> {
  const url = await getBillPdfUrl(source, copy);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    throw new Error("Your browser blocked the new tab. Allow pop-ups for this site to view bills.");
  }
}

/** Save a copy to the user's device under its real filename. */
export async function downloadBillPdf(
  source: Parameters<typeof getBillPdfUrl>[0],
  copy: BillCopy
): Promise<void> {
  const url = await getBillPdfUrl(source, copy);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${source.base_name || "bill"}_${copy}.pdf`;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Print a copy through the browser's own print dialog.
 *
 * The PDF is fetched into a blob and framed in a hidden iframe rather than
 * pointed at directly: a bare `<iframe src=signedUrl>` would have the browser
 * render its own PDF viewer chrome, which has no scriptable print hook, so
 * `contentWindow.print()` is not available and the print dialog never opens.
 * Loading the bytes ourselves keeps it a real print, not a screenshot.
 *
 * The iframe and its object URL are always revoked, including when the blob
 * fails to load, so a failed print does not leak memory.
 */
export async function printBillPdf(
  source: Parameters<typeof getBillPdfUrl>[0],
  copy: BillCopy
): Promise<void> {
  const url = await getBillPdfUrl(source, copy);

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
 * Delete one uploaded workbook, with everything it owns.
 *
 * Order matters and is the reverse of creation:
 *   1. folder_items rows that point at the bills  — otherwise the folder would
 *      show entries whose records no longer exist.
 *   2. the bill_uploads row, which CASCADES to `bills` and `bill_line_items`.
 *   3. the three PDF objects.
 *
 * The database row goes before the files deliberately: if the storage call then
 * fails, the leftovers are unreferenced objects, which cost nothing. The other
 * order would leave live rows pointing at documents that are already gone.
 *
 * Removing a bill from a folder is a separate operation (`removeFolderItem`) and
 * touches none of this — it only deletes the relationship.
 */
export async function deleteBillUpload(uploadId: string): Promise<{ ok: boolean; error?: string }> {
  let billIds: string[];
  let upload: BillUpload;
  try {
    billIds = await fetchBillIdsForUpload(uploadId);
    upload = await fetchBillUpload(uploadId);
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

  const paths = [upload.original_pdf_path, upload.duplicate_pdf_path, upload.triplicate_pdf_path]
    .filter((p): p is string => !!p);
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
 * every JS engine: a reduced ICU silently falls back to `en-US` grouping, so
 * 15,635 would render as 15.635 on one device and 15,635 on another. Grouping
 * the last three digits and then pairs is a few lines and always identical —
 * which the admin app also needs, since it runs the same figures through Hermes.
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
