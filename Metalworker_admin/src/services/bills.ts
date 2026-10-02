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

// Also needed INSIDE this module: by the summary mapping and the facet labels.
import { toFiniteNumber, formatJobKind } from "./billFormat";
import { supabase } from "./supabase";
import { logAudit } from "./auditLog";
import type {
  Bill,
  BillBankDetails,
  BillColumns,
  BillCopy,
  BillLineItem,
  BillPatch,
  BillUpdateResult,
  BillUpload,
  BillUploadResult,
  BillUploadStage,
  FolderBillSummary,
  BillJobKindCount,
  BillingFolderBillCount,
  BulkProgress,
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
  /**
   * Present only when the query filters by folder, because that filter is an inner
   * join (see `BillQuery.folderId`). Stripped back off in `flattenBill`, so `Bill`
   * stays exactly the shape it declares no matter which query produced it.
   */
  folder_items?: unknown;
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
  /* `folder_items` is the query's join, not a bill column, so it is dropped here
     rather than leaking onto every `Bill` object as an extra runtime key that the
     type does not describe. */
  const { bill_uploads: upload, folder_items: _join, ...own } = row;
  return {
    ...own,
    original_filename: upload?.original_filename ?? "",
    base_name: upload?.base_name ?? "",
    upload_status: upload?.status ?? null,
  };
}

/**
 * One entry per bill id, keeping the first.
 *
 * Applied to every page, but it only ever changes anything on the folder-filtered
 * query: the unique index on `folder_items (folder_id, item_type, item_id)` already
 * means a bill cannot be linked to one folder twice, so this is the belt to that
 * braces. Without it, a duplicate would be counted once in `total` (a `count` is
 * taken over distinct rows) but appear twice in `rows` — and a folder list that
 * shows a bill twice while the folder's own summary counts it once is exactly the
 * disagreement the Billing section must not have.
 */
function dedupeBillsById(rows: Bill[]): Bill[] {
  if (rows.length < 2) return rows;
  const seen = new Set<string>();
  const out: Bill[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
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
  /**
   * Restrict to the bills inside one folder.
   *
   * Resolved as a JOIN on `folder_items` inside the database, not by reading the
   * folder's bill ids and passing them back as an `in` list. That distinction is
   * what makes this work at 1000+ bills: a folder's ids would have to be fetched
   * whole, then serialized into one request URL, which PostgREST and the network
   * will both refuse. Joining keeps pagination, ordering and the row count in the
   * same place they already live, so there is one bill query in this file.
   *
   * Only `item_type = 'bill'` links are followed, and a folder is asserted to be a
   * BILLING folder before this is used (see `fetchBillingFolders`).
   */
  folderId?: string | null;
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

  /* The folder filter is an inner join rather than an id list, because a folder can
     hold thousands of bills and their ids cannot be serialized into a request. It
     also means the `count` below is taken over the joined rows, so the page total
     IS the folder's bill count — no second query to keep in step. */
  const folderId = typeof query.folderId === "string" && query.folderId ? query.folderId : null;
  const select = folderId ? `${BILL_WITH_UPLOAD}, folder_items!inner(folder_id)` : BILL_WITH_UPLOAD;

  let q = supabase
    .from(BILLS)
    .select(select, { count: "exact" })
    // Newest invoice first, then newest row, so the order is total and stable
    // (two bills sharing an invoice date must not swap places between pages).
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (folderId) {
    /* `item_type` is part of the filter, not implied: `folder_items` is a
       polymorphic link table, so a folder that somehow held a job would otherwise
       return that job's id as if it were a bill (and the join would then simply
       match nothing, making the folder silently look empty). */
    q = q.eq("folder_items.folder_id", folderId).eq("folder_items.item_type", "bill");
  }
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
    rows: dedupeBillsById(
      ((data ?? []) as unknown as BillRowWithUpload[]).map(flattenBill)
    ),
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
   Editing
   ────────────────────────────────────────────── */

/**
 * The bank block as an editable object, whatever shape it is stored in.
 *
 * 0005 wrote an array of printed lines; the editing migration writes label/value
 * parts. Both are accepted so the editor opens on a row imported before the
 * migration as well as after it.
 */
export function bankPartsOf(details: BillBankDetails | string[] | null | undefined): BillBankDetails {
  if (!details) return {};
  if (Array.isArray(details)) return parseBankLines(details);
  return details;
}

/**
 * The bank block as the printed lines, for display.
 *
 * The display form is the printed form, so a screen shows the user what the invoice
 * says rather than four bare values with invented punctuation.
 */
export function bankLinesOf(details: BillBankDetails | string[] | null | undefined): string[] {
  if (!details) return [];
  if (Array.isArray(details)) return details;
  return Object.values(details)
    .filter((p) => !!p && typeof p === "object")
    .map((p) => `${p.label ?? ""}${p.value ?? ""}`.trim())
    .filter((l) => l !== "");
}

/**
 * Split a printed bank line into its label and value.
 *
 * The label keeps the whitespace up to the first character of the value, so
 * `label + value` rebuilds the line byte for byte. Mirrors `parseBankLines` in the
 * edge function's `_shared/billDocument.ts`, which does the same split on import; if
 * the two ever disagreed, saving an untouched bank block would reformat it.
 */
function parseBankLines(lines: string[]): BillBankDetails {
  const specs: { key: string; re: RegExp }[] = [
    { key: "bank_name", re: /bank\s*name/i },
    { key: "account_number", re: /account\s*(no|number)/i },
    { key: "branch", re: /branch/i },
    { key: "ifsc_code", re: /ifsc/i },
  ];
  const out: BillBankDetails = {};
  for (const line of lines) {
    const spec = specs.find((s2) => s2.re.test(line));
    if (!spec) continue;
    const hit = spec.re.exec(line)!;
    const after = line.slice(hit.index + hit[0].length);
    const colon = after.indexOf(":");
    const gapStart = colon >= 0 ? colon + 1 : 0;
    const valueStart = after.slice(gapStart).search(/\S/);
    if (valueStart < 0) continue;
    out[spec.key] = {
      label: line.slice(0, hit.index + hit[0].length + gapStart + valueStart),
      value: after.slice(gapStart + valueStart).trim(),
    };
  }
  return out;
}

/**
 * The calculated figures, recomputed locally as the user types.
 *
 * A PREVIEW ONLY. The server recomputes every one of these on save and the saved
 * values are what the PDF prints, so a disagreement here cannot produce a wrong
 * invoice - it can only show a number that the save then corrects. The rules are
 * deliberately kept identical to `_shared/billEdit.ts`:
 *
 *     line amount  = quantity x rate
 *     base         = SUM(line amount)
 *     tax          = base x rate / 100, for the taxes the bill already charges
 *     after tax    = base + total gst + round off
 *
 * and `round_off` is a source value, never recomputed: 8 of the 20 production
 * invoices round, and the rounded figure is the one that was billed.
 *
 * "The taxes the bill already charges" is the part that is easy to get wrong. Every
 * production invoice prints all three slab rates (9 / 9 / 18) as a reference table
 * while charging only two of them, so a bill that charges CGST and SGST must not
 * also be charged 18% IGST - that would turn 77,290.00 into 89,080.00.
 */
export interface TotalsPreview {
  totalQuantity: number | null;
  amountBeforeTax: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  amountAfterTax: number;
}

export function previewTotals(input: {
  lineItems: { quantity: number | null; rate: number | null; amount?: number | null }[];
  cgstRate: number | null;
  sgstRate: number | null;
  igstRate: number | null;
  roundOff: number | null;
  charged: { cgst: number | null; sgst: number | null; igst: number | null };
}): TotalsPreview {
  const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
  const amounts = input.lineItems.map((i) =>
    i.quantity !== null && i.rate !== null ? r2(i.quantity * i.rate) : (i.amount ?? null)
  );
  const base = r2(
    amounts.filter((a): a is number => a !== null).reduce((sum, a) => sum + a, 0)
  );
  const quantities = input.lineItems
    .map((i) => i.quantity)
    .filter((q): q is number => q !== null);

  const anyCharged =
    (input.charged.cgst ?? 0) !== 0 ||
    (input.charged.sgst ?? 0) !== 0 ||
    (input.charged.igst ?? 0) !== 0;
  const applies = anyCharged
    ? {
        cgst: (input.charged.cgst ?? 0) !== 0,
        sgst: (input.charged.sgst ?? 0) !== 0,
        igst: (input.charged.igst ?? 0) !== 0,
      }
    : { cgst: true, sgst: true, igst: true };

  const tax = (rate: number | null, applicable: boolean): number =>
    !applicable || !rate ? 0 : r2((base * rate) / 100);

  const cgst = tax(input.cgstRate, applies.cgst);
  const sgst = tax(input.sgstRate, applies.sgst);
  const igst = tax(input.igstRate, applies.igst);
  const totalGst = r2(cgst + sgst + igst);

  return {
    totalQuantity:
      quantities.length > 0
        ? Math.round(quantities.reduce((a, b) => a + b, 0) * 1000) / 1000
        : null,
    amountBeforeTax: base,
    cgst,
    sgst,
    igst,
    totalGst,
    amountAfterTax: r2(base + totalGst + (input.roundOff ?? 0)),
  };
}

/**
 * Save an edited bill.
 *
 * The server is the only thing that writes: it merges the patch onto the stored row,
 * validates it, replaces the line items, regenerates all three PDFs from the saved
 * values and only then points the row at them. A save that fails leaves the bill
 * exactly as it was, which is why the caller's `catch` can say so truthfully.
 *
 * `onStage` lets the editor show what is actually happening. The request is one
 * round trip that validates, writes, renders and uploads, and "Saving..." alone does
 * not tell a user whether it is stuck - and on a phone, where the connection is
 * slower, that difference matters.
 */
export async function updateBill(
  billId: string,
  patch: BillPatch,
  onStage?: (stage: "saving" | "generating" | "done") => void
): Promise<BillUpdateResult> {
  onStage?.("saving");

  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    reason?: string;
    field?: string;
    bill_id?: string;
    pdf_version?: number;
    amount_after_tax?: number | null;
    amount_in_words?: string | null;
    pdfs?: BillUpdateResult["pdfs"];
  }>("update-bill", { body: { bill_id: billId, patch } });

  onStage?.("generating");

  if (error) {
    // A non-2xx response carries a JSON body, which supabase-js puts in
    // `error.context` rather than throwing the message away, and that body is the
    // only place the server's specific explanation lives: which field was rejected,
    // or that the PDFs could not be produced and nothing was changed.
    const body = await readErrorBody(error);
    throw new BillUploadError(
      body?.error ?? error.message ?? "The bill could not be saved.",
      body?.reason ?? "network"
    );
  }
  if (!data?.ok) {
    throw new BillUploadError(
      data?.error ?? "The bill could not be saved.",
      data?.reason ?? null
    );
  }

  onStage?.("done");
  return {
    bill_id: data.bill_id ?? billId,
    pdf_version: data.pdf_version ?? 1,
    amount_after_tax: data.amount_after_tax ?? null,
    amount_in_words: data.amount_in_words ?? null,
    pdfs: data.pdfs ?? [],
  };
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
  /* Added by migration 0009. Every one of these is OPTIONAL, so a summary read
     against a database that has only 0006 applied still yields the figures it has
     and the missing ones fall back to 0 rather than `undefined` reaching a
     formatter as NaN. */
  avg_cgst?: number | string | null;
  avg_sgst?: number | string | null;
  avg_igst?: number | string | null;
  avg_total_gst?: number | string | null;
  avg_round_off?: number | string | null;
  min_amount_after_tax?: number | string | null;
  max_amount_after_tax?: number | string | null;
  min_amount_before_tax?: number | string | null;
  max_amount_before_tax?: number | string | null;
  bills_without_total?: number | string | null;
  /* Added by migration 0010. Optional for the same reason as the rest of 0009's
     columns: a read against a database that has only 0009 applied still works. */
  bills_with_total?: number | string | null;
  job_kind_breakdown?: unknown;
}

/**
 * The breakdown arrives as jsonb, i.e. as a parsed array of `{job_kind, count}`.
 *
 * Coerced rather than cast, because this is the one summary field whose SHAPE
 * varies: a null, an object instead of an array, or an entry with a missing
 * `count` would otherwise reach a `.map` as `undefined` and render "undefined
 * bills". Anything unrecognised is dropped, because a broken breakdown row must
 * not take the totals above it down with it.
 */
function parseJobKindBreakdown(raw: unknown): BillJobKindCount[] {
  if (!Array.isArray(raw)) return [];
  const out: BillJobKindCount[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as { job_kind?: unknown; count?: unknown };
    const count = toFiniteNumber(row.count);
    if (count === null) continue;
    out.push({
      job_kind: typeof row.job_kind === "string" ? row.job_kind : null,
      count,
    });
  }
  return out;
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
  const totalBills = toFiniteNumber(row.total_bills) ?? 0;
  const withoutTotal = toFiniteNumber(row.bills_without_total);

  /* How many bills the money figures above actually cover (migration 0010).
   *
   * The RPC reports it. The difference is used ONLY as a fallback for a database
   * that has 0009 but not 0010 — and when even that count is missing the result is
   * `null`, meaning "unknown", because guessing is the one thing a financial
   * summary must not do. Under a 0009 database the money figures were computed over
   * ALL bills, so assuming they covered all bills would be right there and wrong
   * everywhere else, which is not a trade worth making.
   */
  const withTotal =
    toFiniteNumber(row.bills_with_total) ??
    (withoutTotal === null ? null : Math.max(totalBills - withoutTotal, 0));

  return {
    total_bills: totalBills,
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
    average_cgst: toFiniteNumber(row.avg_cgst) ?? 0,
    average_sgst: toFiniteNumber(row.avg_sgst) ?? 0,
    average_igst: toFiniteNumber(row.avg_igst) ?? 0,
    average_gst: toFiniteNumber(row.avg_total_gst) ?? 0,
    average_round_off: toFiniteNumber(row.avg_round_off) ?? 0,
    /* Left `null` when absent rather than `?? 0`. NULL means no bill in the folder
       has the figure; 0 would mean a bill in the folder was free. `formatMoney`
       already renders null as "—", which is the truthful display. */
    min_amount_after_tax: toFiniteNumber(row.min_amount_after_tax),
    max_amount_after_tax: toFiniteNumber(row.max_amount_after_tax),
    min_amount_before_tax: toFiniteNumber(row.min_amount_before_tax),
    max_amount_before_tax: toFiniteNumber(row.max_amount_before_tax),
    bills_without_total: withoutTotal ?? 0,
    bills_with_total: withTotal,
    job_kind_breakdown: parseJobKindBreakdown(row.job_kind_breakdown),
  };
}

/**
 * Bill counts for every Billing folder, in ONE request.
 *
 * Migration 0009's `get_billing_folder_bill_counts()`. Counting client-side would
 * be one COUNT query per folder (N+1); the RPC groups in the database and returns
 * a single row per billing folder, so a workspace with dozens of folders costs the
 * same as one with none.
 *
 * `bill_count` is a count of DISTINCT bill ids, so 1 physical invoice is 1 bill and
 * never 3.
 */
export async function fetchBillingFolderBillCounts(): Promise<BillingFolderBillCount[]> {
  const { data, error } = await supabase.rpc("get_billing_folder_bill_counts");
  if (error) throw new Error(error.message);

  const rows = Array.isArray(data) ? data : [];
  return rows.map((raw) => {
    const row = raw as { folder_id?: unknown; folder_name?: unknown; bill_count?: unknown };
    return {
      folder_id: typeof row.folder_id === "string" ? row.folder_id : "",
      folder_name: typeof row.folder_name === "string" ? row.folder_name : "",
      bill_count: toFiniteNumber(row.bill_count) ?? 0,
    };
  });
}

/* ──────────────────────────────────────────────
   SELECT-ALL AND BULK DELETE
   ────────────────────────────────────────────── */

/**
 * EVERY bill id matching a query, not one page of them.
 *
 * "Select all" has to mean all of them: the list is paginated at 20-25 rows, so a
 * workspace holding 400 bills would otherwise need twenty page visits before the
 * user could put 50 of those bills into a folder in one operation — which is the
 * whole workflow this section exists for.
 *
 * Paged through in fixed-size requests rather than one unbounded select, because a
 * select with no range is capped by PostgREST's server row limit: silently
 * truncated it would return a short list with no error, and the user would delete
 * 1000 bills believing they had chosen 1400.
 *
 * Ids are de-duplicated as they arrive, because a bill whose sort key changes
 * between two pages (a concurrent edit, or two rows sharing an invoice date) can
 * otherwise land on two pages and be deleted twice.
 */
export async function fetchBillIds(query: BillQuery = {}): Promise<string[]> {
  const ID_CHUNK = 500;
  const seen = new Set<string>();
  const out: string[] = [];

  for (let chunk = 0; ; chunk++) {
    const page = await fetchBills({
      ...query,
      page: chunk + 1,
      pageSize: ID_CHUNK,
    });
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row.id);
    }
    /* Two exits, both needed: the reported total is authoritative but can be
       stale after a concurrent delete, and a short page ends the walk regardless. */
    if (page.rows.length < ID_CHUNK) break;
    if (out.length >= page.total) break;
  }

  return out;
}

/** What a bulk delete achieved, bill by bill. */
export interface BulkDeleteResult {
  /** How many of the requested bills are gone. */
  deleted: number;
  /** How many of the requested bills are still present. */
  failed: number;
  /**
   * One entry per bill that did NOT go, naming it.
   *
   * Never collapsed into a single "something went wrong": a partial delete of 37
   * bills where 2 failed has to say which 2, or the user cannot tell what to retry.
   *
   * The id is carried alongside the label so the caller can keep exactly the failed
   * bills selected and drop only the ones that are really gone.
   */
  failures: { id: string; label: string; error: string }[];
}

/** A bill the caller wants named back: its id, and a label for humans. */
export interface BillDeleteTarget {
  id: string;
  /**
   * How to name this bill if it fails.
   *
   * Supplied by the caller rather than looked up here, because a bulk selection spans
   * pages and this function only has ids. See `fetchBillLabels`.
   */
  label: string;
}

/**
 * Names for bills the caller has ids for but has not loaded.
 *
 * Needed because a bulk selection is not confined to the page on screen: "Select all
 * 412 matching" holds 412 ids while `bills` holds 20. The confirmation and any failure
 * report have to be able to say WHICH invoices, so the missing names are fetched.
 *
 * Two columns only, and chunked. Fetching whole rows to read one label would move 412
 * line-item-free but still wide records to print three names, and an unbounded
 * `.in()` would be truncated by PostgREST's server row limit without saying so — so
 * the ids are walked in chunks and de-duplicated, and a bill that has since been
 * deleted is simply absent from the answer rather than being an error.
 */
export async function fetchBillLabels(ids: string[]): Promise<{ id: string; label: string }[]> {
  const wanted = [...new Set(ids)].filter(Boolean);
  if (wanted.length === 0) return [];

  const LABEL_CHUNK = 500;
  const out: { id: string; label: string }[] = [];

  for (let at = 0; at < wanted.length; at += LABEL_CHUNK) {
    const chunk = wanted.slice(at, at + LABEL_CHUNK);
    const { data, error } = await supabase
      .from(BILLS)
      .select("id, invoice_no, sheet_name")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as {
      id: string;
      invoice_no: string | null;
      sheet_name: string | null;
    }[]) {
      out.push({
        id: row.id,
        label: row.invoice_no?.trim() || row.sheet_name?.trim() || "this bill",
      });
    }
  }

  return out;
}

/**
 * Delete many bills, reporting REAL progress as it goes.
 *
 * Sequential on purpose, and that is what makes the progress honest:
 * `deleteBill` is a multi-statement cascade (unlink from folders, drop line items,
 * drop the row, remove the three PDFs, maybe drop the upload husk) that reports a
 * per-bill outcome. Running them one at a time means `done` counts bills
 * genuinely finished, so the UI can show "Deleting 18 / 37" and be correct at every
 * step. A parallel or single-request design could only ever say "please wait",
 * which is exactly the frozen-looking screen this replaces.
 *
 * Each `await` yields to the event loop, so the progress the caller renders is
 * actually painted between bills rather than queued behind the whole loop.
 *
 * A failure on one bill does NOT stop the rest: the user ticked N invoices and
 * asked for N, so N-1 going and 1 staying is a partial success that must be
 * reported as a partial success.
 */
export async function deleteBillsInBulk(
  bills: BillDeleteTarget[],
  onProgress?: (progress: BulkProgress) => void
): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { deleted: 0, failed: 0, failures: [] };

  /* Reported BEFORE the first request, so the loading state appears on the same
     frame as the tap rather than one bill later. */
  onProgress?.({ done: 0, total: bills.length });

  for (const bill of bills) {
    const label = bill.label?.trim() || "this bill";
    try {
      const res = await deleteBill(bill.id);
      if (res.ok) {
        result.deleted += 1;
      } else {
        result.failed += 1;
        result.failures.push({ id: bill.id, label, error: res.error ?? "failed" });
      }
    } catch (err) {
      /* deleteBill reports its own failures as {ok:false}; getting here means
         something threw outright. Counted like any other failure so the numbers
         and the list can never disagree, and the loop continues. */
      result.failed += 1;
      result.failures.push({
        id: bill.id,
        label,
        error: err instanceof Error ? err.message : "failed",
      });
    }
    onProgress?.({ done: result.deleted + result.failed, total: bills.length });
  }

  return result;
}

/* ──────────────────────────────────────────────
   Formatting
   ────────────────────────────────────────────── */

/* The formatters live in ./billFormat so they can be used — and tested — without
   pulling in react-native and the Supabase client. They are re-exported here
   because that is where every caller already imports them from, so no call site
   changes: this is a reorganisation, not a move. */
export {
  formatMoney,
  formatQuantity,
  formatBillDate,
  formatJobKind,
} from "./billFormat";

/* ──────────────────────────────────────────────
   Folder summary export
   ────────────────────────────────────────────── */

/**
 * Render a billing folder's summary to a PDF and hand it to the user.
 *
 * WHY HTML AND NOT A NEW LIBRARY
 * The bill PDFs already go out through `expo-print`, so rendering the summary as
 * print HTML reuses that dependency, that code path and the user's existing "Save as
 * PDF" destination. Page breaks across a long bill list come out right for free,
 * which a hand-rolled writer would not do.
 *
 * WHY THE DOCUMENT IS BUILT ELSEWHERE
 * The figures are assembled by `folderSummaryExport.ts`, which imports neither
 * react-native nor Supabase. That is what lets `test-folder-summary-export.ts` run
 * the real builder under Node and assert the exported figures are the same strings
 * the folder screen shows. If this function formatted a number itself, the export
 * would be a second implementation of a financial figure and the test above would
 * be checking a copy.
 *
 * Native: `printToFileAsync` writes a real PDF into the cache directory and
 * `expo-sharing` passes it to the share sheet — the same route `downloadBillPdf`
 * uses, so it lands in Files / Drive / Mail as a genuine save.
 *
 * Web: `printToFileAsync` opens the browser's print dialog, where "Save as PDF" is
 * a destination the user already knows. Printing rather than silently downloading
 * is deliberate: on the web there is no separate "save", and a financial document
 * appearing in the downloads folder unasked is worse than one extra dialog.
 */
export async function exportFolderSummaryPdf(input: {
  folderName: string;
  summary: FolderBillSummary;
  /** Optional per-bill appendix; omit it to export just the figures. */
  bills?: Bill[];
}): Promise<void> {
  const { buildFolderSummaryHtml, summaryFilename } = await import("./folderSummaryExport");

  const html = buildFolderSummaryHtml(input);
  const filename = summaryFilename(input.folderName);

  const { printToFileAsync } = await import("expo-print");

  if (Platform.OS === "web") {
    // Opens the print dialog; there is no file to hand on afterwards.
    await printToFileAsync({ html });
    return;
  }

  const { uri } = await printToFileAsync({ html });

  const { isAvailableAsync, shareAsync } = await import("expo-sharing");
  if (!(await isAvailableAsync())) {
    throw new Error("No app on this device can save PDF files.");
  }
  await shareAsync(uri, {
    UTI: ".pdf",
    mimeType: "application/pdf",
    dialogTitle: filename,
  });
}
