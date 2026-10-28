// supabase/functions/regenerate-bill-pdfs/engine.ts
//
// The PDF regeneration job: a durable, resumable state machine that rebuilds every
// stored invoice PDF from the bill records already in the database. No workbook is
// re-uploaded or re-parsed — the rows ARE the source of truth.
//
// ORDER OF WORK
// One job runs at a time, and inside it one Excel workbook at a time:
//
//   for each workbook upload (fixed list taken when the job starts):
//     prepare     read the workbook's finalized bills, check order and profile
//     bills       regenerate each bill's Original / Duplicate / Triplicate
//     render      lay the aggregate out in small chunks (one chunk, one copy per unit)
//     assemble    stream the chunks into one PDF per copy, validate, stage it
//     publish     re-verify the three staged files, then repoint `bill_uploads`
//     cleanup     remove the superseded aggregates and the temporary chunks
//   then every standalone bill (Bill Creator bills, which have no workbook)
//
// A workbook is reported complete only after `publish` has swapped all three
// aggregates in; until then its old aggregates remain the active ones.
//
// UNITS, LEASES AND RETRIES
// Work is cut into small UNITS (one bill copy, one chunk copy, one assembly…). Each
// invocation claims a short lease on the job, records that it is attempting the
// current unit, does it, and commits the next state with a compare-and-set on the
// job's revision. So:
// - two tabs (or a double click) can never run the same job concurrently;
// - a retried request can never skip a unit or count one twice — counters move only
//   in the same revision-checked write that advances the state;
// - an invocation the platform kills mid-unit (HTTP 546) is noticed on the next
//   claim, and after MAX_UNIT_ATTEMPTS the unit is failed permanently and the job
//   moves on instead of looping on the same cursor forever.
//
// Everything here talks to the database and storage through the small `Regeneration
// Store` / `RegenerationStorage` interfaces so the whole workflow is exercised by the
// self-tests against an in-memory fake.

import {
  billDocumentTitle,
  billFooterContent,
  renderBillDocument,
  renderBillPagesFragment,
} from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import {
  COPY_LABEL,
  COPY_ORDER,
  safeBillToken,
  type BillLineItem,
  type CopyKind,
} from "../process-bill-upload/_shared/parseBill.ts";
import { profileForBill, type BusinessProfile } from "../process-bill-upload/_shared/businessProfile.ts";
import { decideWorkbookSnapshot } from "../process-bill-upload/_shared/snapshotConsistency.ts";
import {
  PdfPageStreamWriter,
  PdfStructureError,
  crc32,
  readPdfStructure,
} from "../process-bill-upload/_shared/pdf.ts";
import type { PdfImage } from "../process-bill-upload/_shared/pdfImage.ts";

/* ──────────────────────────────────────────────
   Limits
   ────────────────────────────────────────────── */

/** Bills laid out per aggregate chunk. Small enough that one chunk copy is a cheap unit. */
export const CHUNK_SIZE = 5;
/**
 * Times one unit may die without reporting back (the platform killed the worker)
 * before it is failed permanently. A unit that reliably exhausts the worker will
 * not succeed on a fourth try.
 */
export const MAX_UNIT_ATTEMPTS = 3;
/**
 * Transient errors (storage or database briefly unavailable) tolerated on one unit,
 * retried with backoff of 2, 4, 8, 15, 15, 15 seconds — about a minute in total.
 */
export const MAX_TRANSIENT_RETRIES = 6;
/** Times one chunk or one staged file may be rebuilt after failing verification. */
export const MAX_REPAIRS_PER_FILE = 2;
/**
 * Largest aggregate this function will assemble, per copy.
 *
 * Not a bill count: it is measured from the rendered chunks, so it tracks what
 * actually has to fit in memory. A copy at the cap is held twice at most (the
 * output parts and the joined file), which keeps a 24 MB aggregate well inside the
 * Edge runtime's memory and under the `bills` bucket's 50 MB per-file limit. At the
 * fixture's ~10.5 KB per page that is roughly 2,300 pages per copy.
 */
export const MAX_AGGREGATE_BYTES = 24 * 1024 * 1024;
/** How long a claim on the job lasts if the invocation holding it dies. */
export const LEASE_MS = 45_000;
/** Wall-clock budget per invocation before it returns progress to the client. */
export const STEP_BUDGET_MS = 1_200;
/** Failure details kept on the job; the counters stay exact beyond this. */
const MAX_FAILURE_DETAILS = 200;

/* ──────────────────────────────────────────────
   Errors
   ────────────────────────────────────────────── */

/** An infrastructure failure worth retrying: a dropped request, a storage hiccup. */
export class TransientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TransientError";
    this.code = code;
  }
}

/** The source data or the request makes this unit impossible; retrying cannot help. */
export class PermanentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PermanentError";
    this.code = code;
  }
}

/* ──────────────────────────────────────────────
   Ports
   ────────────────────────────────────────────── */

export type JobStatus = "running" | "completed" | "failed" | "abandoned";

export interface JobRow {
  id: string;
  status: JobStatus;
  phase: "bills" | "aggregates";
  cursor: string | null;
  revision: number;
  lease_token: string | null;
  lease_until: string | null;
  started_at: string;
  updated_at: string;
  last_error: string | null;
  bills_processed: number;
  bills_succeeded: number;
  bills_failed: number;
  aggregates_processed: number;
  aggregates_succeeded: number;
  aggregates_failed: number;
}

export type JobPatch = Partial<Omit<JobRow, "id" | "started_at">>;

export interface BillRow extends Record<string, unknown> {
  id: string;
  bill_upload_id: string;
  status: string;
  sheet_name: string;
  invoice_no: string | null;
  sheet_order: number | null;
  pdf_version: number | null;
  logo_id: string | null;
  business_profile_snapshot: unknown;
  original_pdf_path: string | null;
  duplicate_pdf_path: string | null;
  triplicate_pdf_path: string | null;
}

export interface UploadRow {
  id: string;
  original_filename: string | null;
  base_name: string | null;
  creation_source: string;
  original_pdf_path: string | null;
  duplicate_pdf_path: string | null;
  triplicate_pdf_path: string | null;
}

export interface WorkbookBillRef {
  id: string;
  sheet_order: number | null;
  business_profile_snapshot: unknown;
}

export type CopyPaths = Record<CopyKind, string | null>;

/**
 * Database access. Implementations throw `TransientError` for anything that is a
 * failure to reach the data rather than a fact about it.
 */
export interface RegenerationStore {
  findRunningJob(): Promise<JobRow | null>;
  findJob(id: string): Promise<JobRow | null>;
  /**
   * Insert a running job. Returns null when another running job already exists —
   * the one-running-job unique index is what makes this race-free.
   */
  insertRunningJob(row: { started_by: string | null; started_at: string; cursor: string; phase: "bills" }): Promise<JobRow | null>;
  /**
   * Compare-and-set. Applies `patch` only while the row is still at
   * `expectedRevision` and running, and its lease is free, expired at `lease.now`,
   * or already held by `lease.token`. Returns the updated row, or null if any of
   * that no longer holds.
   */
  updateJob(id: string, expectedRevision: number, patch: JobPatch, lease: { token: string; now: string }): Promise<JobRow | null>;
  /** Completed workbook uploads, oldest first. */
  listWorkbookUploadIds(): Promise<string[]>;
  /** Finalized bills that belong to no workbook, created no later than `createdBefore`. */
  countStandaloneBills(createdBefore: string): Promise<number>;
  nextStandaloneBill(afterId: string | null, createdBefore: string): Promise<BillRow | null>;
  loadUpload(id: string): Promise<UploadRow | null>;
  /** A workbook's finalized bills, by sheet order then id (nulls last). */
  listWorkbookBills(uploadId: string): Promise<WorkbookBillRef[]>;
  loadBills(ids: string[]): Promise<BillRow[]>;
  loadLineItems(billIds: string[]): Promise<Map<string, BillLineItem[]>>;
  /** Repoint a bill iff its `pdf_version` is still `expectedVersion`. */
  updateBillPdfs(billId: string, expectedVersion: number, patch: Record<string, unknown>): Promise<boolean>;
  /** Repoint an upload's aggregates iff its paths are still exactly `expected`. */
  updateUploadAggregates(uploadId: string, expected: CopyPaths, next: Record<CopyKind, string>): Promise<boolean>;
  /** The decoded logo; null when it no longer exists or cannot be embedded. */
  loadLogo(logoId: string): Promise<PdfImage | null>;
  loadBusinessProfile(): Promise<BusinessProfile>;
}

export interface RegenerationStorage {
  /** Write (or overwrite) one PDF. Throws `TransientError` on failure. */
  upload(path: string, bytes: Uint8Array): Promise<void>;
  /** The file's bytes, or null if it does not exist. Throws `TransientError` otherwise. */
  download(path: string): Promise<Uint8Array | null>;
  /** Best-effort delete. Returns an error message, or null on success. */
  remove(paths: string[]): Promise<string | null>;
}

export interface RegenerationDeps {
  store: RegenerationStore;
  storage: RegenerationStorage;
  newToken: () => string;
  now?: () => number;
  log?: (message: string, detail?: unknown) => void;
  budgetMs?: number;
  leaseMs?: number;
  /** Override of MAX_AGGREGATE_BYTES, for tests. */
  maxAggregateBytes?: number;
}

/* ──────────────────────────────────────────────
   State (stored as JSON in the job's `cursor`)
   ────────────────────────────────────────────── */

export type Stage =
  | "workbook_prepare"
  | "workbook_bills"
  | "aggregate_render"
  | "aggregate_assemble"
  | "aggregate_publish"
  | "workbook_cleanup"
  | "standalone_bills"
  | "done";

export interface ChunkRef {
  path: string;
  pages: number;
  bytes: number;
  crc: number;
  owners: string[];
  subject?: string;
  first_invoice?: string | null;
}

export interface StagedRef {
  path: string;
  pages: number;
  bytes: number;
  crc: number;
}

interface BillProgress {
  bill_id: string;
  invoice_no: string | null;
  base_version: number;
  old_paths: CopyPaths;
  done: Partial<Record<CopyKind, string>>;
  profile: BusinessProfile;
  snapshot: unknown;
}

interface WorkbookState {
  upload_id: string;
  name: string;
  base_name: string;
  stamp: number;
  bill_ids: string[];
  bill_index: number;
  bill: BillProgress | null;
  bills_succeeded: number;
  bills_failed: number;
  dataset_changed: boolean;
  /** Set at prepare when the aggregate cannot be rebuilt safely from the records. */
  aggregate_block: Failure | null;
  aggregate_failure: Failure | null;
  chosen_snapshot: unknown;
  profile: BusinessProfile;
  chunks: Record<CopyKind, (ChunkRef | null)[]>;
  staged: Partial<Record<CopyKind, StagedRef>>;
  repairs: Record<string, number>;
  old_paths: CopyPaths;
  published: boolean;
}

interface Failure {
  code: string;
  message: string;
}

export type WorkbookOutcome = "succeeded" | "partial" | "failed" | "skipped";

export interface WorkbookResult {
  upload_id: string;
  name: string;
  status: WorkbookOutcome;
  bills_total: number;
  bills_succeeded: number;
  bills_failed: number;
  aggregate: "succeeded" | "failed" | "skipped";
  code?: string;
  message?: string;
  cleanup_warning?: string;
}

export interface BillFailure {
  bill_id: string;
  invoice_no: string | null;
  workbook: string | null;
  code: string;
  message: string;
}

export interface Counters {
  bills_processed: number;
  bills_succeeded: number;
  bills_failed: number;
  aggregates_processed: number;
  aggregates_succeeded: number;
  aggregates_failed: number;
}

export interface JobState {
  v: 2;
  stage: Stage;
  started_at: string;
  workbooks: string[];
  wb_index: number;
  wb: WorkbookState | null;
  standalone_total: number;
  standalone_processed: number;
  standalone_succeeded: number;
  standalone_failed: number;
  standalone_after: string | null;
  standalone_bill: BillProgress | null;
  counters: Counters;
  results: WorkbookResult[];
  bill_failures: BillFailure[];
  bill_failures_total: number;
  /** The unit being attempted: claims made, and how many of those reported a transient error. */
  unit: { key: string; attempts: number; transient: number } | null;
  last_error: { code: string; message: string; transient: boolean } | null;
  outcome: JobOutcome | null;
}

export type JobOutcome = "succeeded" | "partial" | "failed" | "empty" | "cancelled";

export function initialState(workbooks: string[], standaloneTotal: number, startedAt: string): JobState {
  return {
    v: 2,
    stage: workbooks.length > 0 ? "workbook_prepare" : "standalone_bills",
    started_at: startedAt,
    workbooks,
    wb_index: 0,
    wb: null,
    standalone_total: standaloneTotal,
    standalone_processed: 0,
    standalone_succeeded: 0,
    standalone_failed: 0,
    standalone_after: null,
    standalone_bill: null,
    counters: emptyCounters(),
    results: [],
    bill_failures: [],
    bill_failures_total: 0,
    unit: null,
    last_error: null,
    outcome: null,
  };
}

function emptyCounters(): Counters {
  return {
    bills_processed: 0,
    bills_succeeded: 0,
    bills_failed: 0,
    aggregates_processed: 0,
    aggregates_succeeded: 0,
    aggregates_failed: 0,
  };
}

/** Parse a stored cursor; null for anything that is not a v2 state. */
export function parseState(cursor: string | null): JobState | null {
  if (!cursor || !cursor.startsWith("{")) return null;
  try {
    const value = JSON.parse(cursor) as JobState;
    return value && value.v === 2 && Array.isArray(value.workbooks) ? value : null;
  } catch {
    return null;
  }
}

/** The key that identifies the next unit of work, so attempts can be counted. */
export function unitKey(state: JobState): string {
  const wb = state.wb;
  switch (state.stage) {
    case "workbook_prepare":
      return `wb${state.wb_index}:prepare`;
    case "workbook_bills": {
      const next = wb?.bill ? COPY_ORDER.find((k) => !wb.bill?.done[k]) ?? "commit" : "start";
      return `wb${state.wb_index}:bill${wb?.bill_index ?? 0}:${next}`;
    }
    case "aggregate_render": {
      const slot = wb ? nextChunkSlot(wb) : null;
      return `wb${state.wb_index}:chunk${slot ? `${slot.index}:${slot.kind}` : "none"}`;
    }
    case "aggregate_assemble":
      return `wb${state.wb_index}:assemble:${wb ? COPY_ORDER.find((k) => !wb.staged[k]) ?? "none" : "none"}`;
    case "aggregate_publish":
      return `wb${state.wb_index}:publish`;
    case "workbook_cleanup":
      return `wb${state.wb_index}:cleanup`;
    case "standalone_bills": {
      const b = state.standalone_bill;
      const next = b ? COPY_ORDER.find((k) => !b.done[k]) ?? "commit" : "start";
      return `sa:${state.standalone_after ?? "-"}:${b?.bill_id ?? "-"}:${next}`;
    }
    case "done":
      return "done";
  }
}

function nextChunkSlot(wb: WorkbookState): { index: number; kind: CopyKind } | null {
  const count = wb.chunks.original.length;
  for (let index = 0; index < count; index++) {
    for (const kind of COPY_ORDER) {
      if (!wb.chunks[kind][index]) return { index, kind };
    }
  }
  return null;
}

/* ──────────────────────────────────────────────
   Unit execution
   ────────────────────────────────────────────── */

interface Ctx {
  deps: RegenerationDeps;
  log: (message: string, detail?: unknown) => void;
  profile: () => Promise<BusinessProfile>;
  logos: Map<string, PdfImage | null>;
  maxBytes: number;
}

function makeCtx(deps: RegenerationDeps): Ctx {
  let profile: Promise<BusinessProfile> | null = null;
  return {
    deps,
    log: deps.log ?? (() => {}),
    profile: () => {
      if (!profile) {
        profile = deps.store.loadBusinessProfile().catch((err) => {
          profile = null;
          throw err instanceof TransientError ? err : new TransientError("profile_unreadable", messageOf(err));
        });
      }
      return profile;
    },
    logos: new Map(),
    maxBytes: deps.maxAggregateBytes ?? MAX_AGGREGATE_BYTES,
  };
}

/**
 * Do the next unit of `state` (a private copy) and return the state after it.
 *
 * Permanent failures are absorbed here — recorded against the bill or workbook and
 * the state advanced past them. A `TransientError` propagates, and the caller
 * keeps the state it had.
 */
export async function executeUnit(ctx: Ctx, state: JobState): Promise<JobState> {
  switch (state.stage) {
    case "workbook_prepare":
      await prepareWorkbook(ctx, state);
      return state;
    case "workbook_bills":
      await workbookBillUnit(ctx, state);
      return state;
    case "aggregate_render":
    case "aggregate_assemble":
    case "aggregate_publish":
      try {
        if (state.stage === "aggregate_render") await renderChunkUnit(ctx, state);
        else if (state.stage === "aggregate_assemble") await assembleUnit(ctx, state);
        else await publishUnit(ctx, state);
      } catch (err) {
        if (!(err instanceof PermanentError)) throw err;
        failAggregate(state, { code: err.code, message: err.message });
      }
      return state;
    case "workbook_cleanup":
      await cleanupWorkbook(ctx, state);
      return state;
    case "standalone_bills":
      await standaloneUnit(ctx, state);
      return state;
    case "done":
      return state;
  }
}

/**
 * The unit has been attempted MAX_UNIT_ATTEMPTS times without completing. Record a
 * permanent failure at the right scope and move past it.
 */
export async function abandonUnit(ctx: Ctx, state: JobState, crashed: boolean): Promise<JobState> {
  const last = state.last_error?.message;
  const failure: Failure = {
    code: "repeated_failure",
    message: crashed || !last
      ? `The server stopped this step ${MAX_UNIT_ATTEMPTS} times before it could finish (usually the worker's memory or time limit).`
      : `This step kept failing after ${MAX_TRANSIENT_RETRIES} retries; the last error was: ${last}`,
  };
  switch (state.stage) {
    case "workbook_prepare": {
      finishWorkbook(state, {
        upload_id: state.workbooks[state.wb_index],
        name: `Workbook ${state.wb_index + 1}`,
        status: "failed",
        bills_total: 0,
        bills_succeeded: 0,
        bills_failed: 0,
        aggregate: "failed",
        code: failure.code,
        message: `${failure.message} Nothing in this workbook was changed.`,
      });
      return state;
    }
    case "workbook_bills": {
      const wb = state.wb as WorkbookState;
      await discardBillProgress(ctx, wb.bill);
      recordBillOutcome(state, wb, wb.bill_ids[wb.bill_index], wb.bill?.invoice_no ?? null, failure);
      return state;
    }
    case "aggregate_render":
    case "aggregate_assemble":
    case "aggregate_publish":
      failAggregate(state, failure);
      return state;
    case "workbook_cleanup": {
      const wb = state.wb as WorkbookState;
      finishWorkbook(state, workbookResult(wb, `Temporary files could not be removed: ${failure.message}`));
      return state;
    }
    case "standalone_bills": {
      const bill = state.standalone_bill;
      await discardBillProgress(ctx, bill);
      recordStandaloneOutcome(state, bill?.bill_id ?? state.standalone_after ?? "", bill?.invoice_no ?? null, failure);
      return state;
    }
    case "done":
      return state;
  }
}

/* ---------- workbook: prepare ---------- */

async function prepareWorkbook(ctx: Ctx, state: JobState): Promise<void> {
  const uploadId = state.workbooks[state.wb_index];
  const upload = await ctx.deps.store.loadUpload(uploadId);
  if (!upload || upload.creation_source !== "workbook") {
    finishWorkbook(state, skippedWorkbook(uploadId, uploadId, "workbook_missing", "This workbook was deleted after regeneration started."));
    return;
  }
  const name = upload.original_filename?.trim() || upload.base_name?.trim() || "Workbook";
  const refs = await ctx.deps.store.listWorkbookBills(uploadId);
  if (refs.length === 0) {
    finishWorkbook(
      state,
      skippedWorkbook(uploadId, name, "no_finalized_bills", "This workbook has no finalized bills, so there was nothing to regenerate. Its files were left unchanged.")
    );
    return;
  }

  let block: Failure | null = null;
  const orders = refs.map((r) => r.sheet_order);
  if (orders.some((o) => o === null || o === undefined)) {
    block = {
      code: "order_not_recorded",
      message:
        "This workbook was imported before sheet order was recorded, so its combined PDFs cannot be rebuilt in the original sheet order. The existing combined PDFs were kept; re-upload the workbook to rebuild them.",
    };
  } else if (new Set(orders).size !== orders.length) {
    block = {
      code: "order_ambiguous",
      message: "Two bills in this workbook have the same sheet position, so the page order is ambiguous. The existing combined PDFs were kept.",
    };
  }

  const current = await ctx.profile();
  const decision = decideWorkbookSnapshot(undefined, refs.map((r) => effectiveSnapshot(current, r.business_profile_snapshot)));
  if (!block && !decision.ok) {
    block = {
      code: "inconsistent_profile_snapshot",
      message:
        "The bills in this workbook were saved with different company details, so they cannot share one combined document. The existing combined PDFs were kept.",
    };
  }
  const profile = profileForBill(current, decision.ok ? decision.chosen : null).profile;
  const chunkCount = Math.ceil(refs.length / CHUNK_SIZE);

  state.wb = {
    upload_id: uploadId,
    name,
    base_name: upload.base_name?.trim() || "workbook",
    stamp: ctx.deps.now ? ctx.deps.now() : Date.now(),
    bill_ids: refs.map((r) => r.id),
    bill_index: 0,
    bill: null,
    bills_succeeded: 0,
    bills_failed: 0,
    dataset_changed: false,
    aggregate_block: block,
    aggregate_failure: null,
    chosen_snapshot: decision.ok ? decision.chosen : null,
    profile,
    chunks: {
      original: new Array(chunkCount).fill(null),
      duplicate: new Array(chunkCount).fill(null),
      triplicate: new Array(chunkCount).fill(null),
    },
    staged: {},
    repairs: {},
    old_paths: {
      original: upload.original_pdf_path,
      duplicate: upload.duplicate_pdf_path,
      triplicate: upload.triplicate_pdf_path,
    },
    published: false,
  };
  state.stage = "workbook_bills";
}

/* ---------- workbook: individual bills ---------- */

async function workbookBillUnit(ctx: Ctx, state: JobState): Promise<void> {
  const wb = state.wb as WorkbookState;
  if (wb.bill_index >= wb.bill_ids.length) {
    if (wb.aggregate_block) {
      failAggregate(state, wb.aggregate_block);
    } else {
      state.stage = "aggregate_render";
    }
    return;
  }
  const billId = wb.bill_ids[wb.bill_index];
  const holder = { bill: wb.bill };
  const outcome = await advanceBill(ctx, holder, billId);
  wb.bill = holder.bill;
  if (outcome.kind === "progress") return;
  if (outcome.kind === "failed" && outcome.failure.code === "bill_changed") wb.dataset_changed = true;
  recordBillOutcome(state, wb, billId, outcome.invoiceNo, outcome.kind === "failed" ? outcome.failure : null);
}

function recordBillOutcome(state: JobState, wb: WorkbookState, billId: string, invoiceNo: string | null, failure: Failure | null): void {
  state.counters.bills_processed++;
  if (failure) {
    state.counters.bills_failed++;
    wb.bills_failed++;
    pushBillFailure(state, { bill_id: billId, invoice_no: invoiceNo, workbook: wb.name, ...failure });
  } else {
    state.counters.bills_succeeded++;
    wb.bills_succeeded++;
  }
  wb.bill = null;
  wb.bill_index++;
}

function pushBillFailure(state: JobState, failure: BillFailure): void {
  state.bill_failures_total++;
  if (state.bill_failures.length < MAX_FAILURE_DETAILS) state.bill_failures.push(failure);
}

type BillOutcome =
  | { kind: "progress" }
  | { kind: "succeeded"; invoiceNo: string | null }
  | { kind: "failed"; invoiceNo: string | null; failure: Failure };

function billPath(row: BillRow, version: number, kind: CopyKind): string {
  const token = safeBillToken(row.invoice_no ?? null, row.sheet_name);
  return `${row.bill_upload_id}/${row.id}_${token}_v${version}_${kind}.pdf`;
}

/**
 * One unit of one bill: render and upload the next copy, or — once all three are
 * uploaded — repoint the bill at them.
 *
 * The bill row is repointed with a check on `pdf_version`, so an edit made while
 * the job was running is never overwritten, and a commit that already happened
 * before an interruption is recognised instead of done twice.
 */
async function advanceBill(ctx: Ctx, holder: { bill: BillProgress | null }, billId: string): Promise<BillOutcome> {
  const { store, storage } = ctx.deps;
  const [row] = await store.loadBills([billId]);
  let p = holder.bill;

  if (!p) {
    if (!row || row.status !== "finalized") {
      return { kind: "failed", invoiceNo: row?.invoice_no ?? null, failure: { code: "bill_changed", message: "This bill was deleted or is no longer finalized." } };
    }
    const bp = profileForBill(await ctx.profile(), row.business_profile_snapshot);
    p = {
      bill_id: billId,
      invoice_no: row.invoice_no ?? null,
      base_version: Number(row.pdf_version) || 1,
      old_paths: { original: row.original_pdf_path, duplicate: row.duplicate_pdf_path, triplicate: row.triplicate_pdf_path },
      done: {},
      profile: bp.profile,
      snapshot: bp.snapshot,
    };
    holder.bill = p;
  }
  const invoiceNo = p.invoice_no;
  const nextVersion = p.base_version + 1;

  if (!row || row.status !== "finalized") {
    await discardBillProgress(ctx, p);
    return { kind: "failed", invoiceNo, failure: { code: "bill_changed", message: "This bill was deleted or is no longer finalized." } };
  }
  const planned = (kind: CopyKind) => billPath(row, nextVersion, kind);
  if (isCommitted(row, nextVersion, planned)) {
    await removeSuperseded(ctx, p);
    return { kind: "succeeded", invoiceNo };
  }
  if ((Number(row.pdf_version) || 1) !== p.base_version) {
    await discardBillProgress(ctx, p);
    return {
      kind: "failed",
      invoiceNo,
      failure: { code: "bill_edited", message: "This bill was edited while regeneration was running; the PDFs from that edit were kept." },
    };
  }

  const kind = COPY_ORDER.find((k) => !p.done[k]);
  if (kind) {
    let logo: PdfImage | null = null;
    if (row.logo_id) {
      if (!ctx.logos.has(row.logo_id)) ctx.logos.set(row.logo_id, await store.loadLogo(row.logo_id));
      logo = ctx.logos.get(row.logo_id) ?? null;
      if (!logo) {
        await discardBillProgress(ctx, p);
        return {
          kind: "failed",
          invoiceNo,
          failure: { code: "logo_unreadable", message: "The logo assigned to this bill is missing or is not a PNG/JPEG, so its PDFs were left unchanged." },
        };
      }
    }
    const items = (await store.loadLineItems([billId])).get(billId) ?? [];
    let bytes: Uint8Array;
    try {
      const model = billFromRecord({ ...(row as unknown as BillRecord), copy: kind }, items, COPY_LABEL[kind]);
      bytes = renderBillDocument([model], COPY_LABEL[kind], logo, p.profile);
      readPdfStructure(bytes);
    } catch (err) {
      ctx.log("regenerate: bill render failed", { billId, kind, error: messageOf(err) });
      await discardBillProgress(ctx, p);
      return { kind: "failed", invoiceNo, failure: { code: "render_failed", message: `The PDF could not be rendered: ${messageOf(err)}` } };
    }
    await storage.upload(planned(kind), bytes);
    p.done[kind] = planned(kind);
    if (COPY_ORDER.some((k) => !p.done[k])) return { kind: "progress" };
  }

  const ok = await store.updateBillPdfs(billId, p.base_version, {
    original_pdf_path: planned("original"),
    duplicate_pdf_path: planned("duplicate"),
    triplicate_pdf_path: planned("triplicate"),
    pdf_version: nextVersion,
    logo_rendered_logo_id: row.logo_id ?? null,
    business_profile_snapshot: p.snapshot,
  });
  if (!ok) {
    const [again] = await store.loadBills([billId]);
    if (again && isCommitted(again, nextVersion, planned)) {
      await removeSuperseded(ctx, p);
      return { kind: "succeeded", invoiceNo };
    }
    await discardBillProgress(ctx, p);
    return {
      kind: "failed",
      invoiceNo,
      failure: { code: "bill_edited", message: "This bill was edited while regeneration was running; the PDFs from that edit were kept." },
    };
  }
  await removeSuperseded(ctx, p);
  return { kind: "succeeded", invoiceNo };
}

function billPaths(row: BillRow): CopyPaths {
  return { original: row.original_pdf_path, duplicate: row.duplicate_pdf_path, triplicate: row.triplicate_pdf_path };
}

function isCommitted(row: BillRow, version: number, planned: (k: CopyKind) => string): boolean {
  return (
    Number(row.pdf_version) === version &&
    row.original_pdf_path === planned("original") &&
    row.duplicate_pdf_path === planned("duplicate") &&
    row.triplicate_pdf_path === planned("triplicate")
  );
}

async function removeSuperseded(ctx: Ctx, p: BillProgress): Promise<void> {
  const fresh = new Set(Object.values(p.done));
  const old = COPY_ORDER.map((k) => p.old_paths[k]).filter((x): x is string => !!x && !fresh.has(x));
  if (old.length === 0) return;
  const err = await ctx.deps.storage.remove(old);
  if (err) ctx.log("regenerate: superseded bill PDF cleanup failed", { paths: old, error: err });
}

/** Remove the copies uploaded for a bill that will not be committed. Never touches its active PDFs. */
async function discardBillProgress(ctx: Ctx, p: BillProgress | null): Promise<void> {
  if (!p) return;
  const active = new Set(COPY_ORDER.map((k) => p.old_paths[k]));
  const ours = Object.values(p.done).filter((x): x is string => !!x && !active.has(x));
  if (ours.length === 0) return;
  const err = await ctx.deps.storage.remove(ours);
  if (err) ctx.log("regenerate: discarded bill PDF cleanup failed", { paths: ours, error: err });
}

/* ---------- workbook: aggregate chunks ---------- */

function chunkPath(wb: WorkbookState, index: number, kind: CopyKind): string {
  return `${wb.upload_id}/regen-${wb.stamp}/chunk-${String(index).padStart(4, "0")}-${kind}.pdf`;
}

function finalPath(wb: WorkbookState, kind: CopyKind): string {
  return `${wb.upload_id}/${wb.base_name}_v${wb.stamp}_${kind}.pdf`;
}

async function renderChunkUnit(ctx: Ctx, state: JobState): Promise<void> {
  const wb = state.wb as WorkbookState;
  if (wb.dataset_changed) throw workbookChanged();
  const slot = nextChunkSlot(wb);
  if (!slot) {
    state.stage = "aggregate_assemble";
    return;
  }
  const ids = wb.bill_ids.slice(slot.index * CHUNK_SIZE, slot.index * CHUNK_SIZE + CHUNK_SIZE);
  const rows = await ctx.deps.store.loadBills(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id));
  if (ordered.some((r) => !r || r.status !== "finalized")) throw workbookChanged();
  const bills = ordered as BillRow[];
  for (let i = 1; i < bills.length; i++) {
    if (!(Number(bills[i].sheet_order) > Number(bills[i - 1].sheet_order))) throw workbookChanged();
  }
  // Every chunk must carry the snapshot the whole workbook was checked against at
  // prepare — a chunk that differs would print different company details.
  const current = await ctx.profile();
  const decision = decideWorkbookSnapshot(wb.chosen_snapshot, bills.map((b) => effectiveSnapshot(current, b.business_profile_snapshot)));
  if (!decision.ok) {
    throw new PermanentError(
      "inconsistent_profile_snapshot",
      "The company details saved on this workbook's bills changed during regeneration. The existing combined PDFs were kept."
    );
  }

  const items = await ctx.deps.store.loadLineItems(ids);
  let fragment: ReturnType<typeof renderBillPagesFragment>;
  try {
    fragment = renderBillPagesFragment(
      bills.map((r) => billFromRecord({ ...(r as unknown as BillRecord), copy: slot.kind }, items.get(r.id) ?? [], COPY_LABEL[slot.kind])),
      COPY_LABEL[slot.kind],
      wb.profile
    );
  } catch (err) {
    throw new PermanentError("render_failed", `The combined PDF could not be rendered: ${messageOf(err)}`);
  }

  const soFar = wb.chunks[slot.kind].reduce((sum, ref) => sum + (ref?.bytes ?? 0), 0);
  if (soFar + fragment.pdf.length > ctx.maxBytes) throw tooLarge(wb, ctx.maxBytes);

  const path = chunkPath(wb, slot.index, slot.kind);
  await ctx.deps.storage.upload(path, fragment.pdf);
  // Indexed, not appended: re-rendering a chunk replaces its reference.
  wb.chunks[slot.kind][slot.index] = {
    path,
    pages: fragment.owners.length,
    bytes: fragment.pdf.length,
    crc: crc32(fragment.pdf),
    owners: fragment.owners,
    ...(slot.index === 0 ? { subject: fragment.subject, first_invoice: fragment.firstInvoiceNo } : {}),
  };
  if (!nextChunkSlot(wb)) state.stage = "aggregate_assemble";
}

/**
 * The company-defaults snapshot a bill actually renders with.
 *
 * A bill with no stored snapshot renders with the current profile, and the bill
 * stage of this very job then records that profile on it. Comparing raw stored
 * values would therefore see "null" at prepare and "set" a moment later for the
 * same unchanged document. Comparing what each bill renders with is both stable
 * across that write and the property that actually matters: one combined document
 * must not mix two sets of company details.
 */
function effectiveSnapshot(current: BusinessProfile, stored: unknown): unknown {
  return profileForBill(current, stored).snapshot;
}

function workbookChanged(): PermanentError {
  return new PermanentError(
    "workbook_changed",
    "Bills in this workbook were added, deleted, reordered or un-finalized while it was being regenerated. The existing combined PDFs were kept; run regeneration again to rebuild them."
  );
}

function tooLarge(wb: WorkbookState, maxBytes: number): PermanentError {
  const limit = maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / (1024 * 1024))} MB` : `${Math.round(maxBytes / 1024)} KB`;
  return new PermanentError(
    "aggregate_too_large",
    `The combined PDF for these ${wb.bill_ids.length} bills would exceed ${limit}, more than this server function can safely assemble. Each bill's own PDFs were regenerated and the existing combined PDFs were kept; rebuilding this one needs a dedicated PDF worker.`
  );
}

/** Count a rebuild of `key`; false once it has been rebuilt too often. */
function allowRepair(wb: WorkbookState, key: string): boolean {
  wb.repairs[key] = (wb.repairs[key] ?? 0) + 1;
  return wb.repairs[key] <= MAX_REPAIRS_PER_FILE;
}

async function assembleUnit(ctx: Ctx, state: JobState): Promise<void> {
  const wb = state.wb as WorkbookState;
  const kind = COPY_ORDER.find((k) => !wb.staged[k]);
  if (!kind) {
    state.stage = "aggregate_publish";
    return;
  }
  const refs = wb.chunks[kind];
  if (refs.some((r) => !r)) {
    state.stage = "aggregate_render";
    return;
  }
  const chunks = refs as ChunkRef[];
  const totalPages = chunks.reduce((sum, r) => sum + r.pages, 0);
  const first = chunks[0];
  const label = COPY_LABEL[kind];
  const writer = new PdfPageStreamWriter(
    { title: billDocumentTitle(label, wb.bill_ids.length, first.first_invoice ?? null), subject: first.subject },
    totalPages
  );

  // Every chunk is downloaded, checked against what was written, and parsed before
  // any of its pages are used. A missing or damaged chunk is not fatal while the
  // records behind it are intact: its reference is cleared and it is rendered again.
  const bad: number[] = [];
  let page = 0;
  for (let i = 0; i < chunks.length; i++) {
    const ref = chunks[i];
    const bytes = await ctx.deps.storage.download(ref.path);
    let contents: Uint8Array[] | null = null;
    if (bytes && bytes.length === ref.bytes && crc32(bytes) === ref.crc) {
      try {
        const parsed = readPdfStructure(bytes);
        if (parsed.pageCount === ref.pages && !parsed.hasImages && ref.owners.length === ref.pages) contents = parsed.contents;
      } catch (err) {
        if (!(err instanceof PdfStructureError)) throw err;
      }
    }
    if (!contents) {
      bad.push(i);
      continue;
    }
    if (bad.length > 0) continue; // still verify the rest, but the output is void
    contents.forEach((content, p) => {
      writer.addPage([content, billFooterContent(label, ref.owners[p], page + p, totalPages)]);
    });
    page += contents.length;
    if (writer.byteLength > ctx.maxBytes) throw tooLarge(wb, ctx.maxBytes);
  }

  if (bad.length > 0) {
    for (const i of bad) {
      if (!allowRepair(wb, `chunk-${i}-${kind}`)) {
        throw new PermanentError(
          "chunk_unrecoverable",
          `Part ${i + 1} of the ${label.toLowerCase()} combined PDF failed verification again after being rebuilt. The existing combined PDFs were kept.`
        );
      }
      wb.chunks[kind][i] = null;
    }
    ctx.log("regenerate: rebuilding damaged chunks", { upload: wb.upload_id, kind, chunks: bad });
    state.stage = "aggregate_render";
    return;
  }

  const out = writer.finish();
  try {
    const check = readPdfStructure(out);
    if (check.pageCount !== totalPages) throw new PdfStructureError(`expected ${totalPages} pages, found ${check.pageCount}`);
  } catch (err) {
    throw new PermanentError("assembly_invalid", `The assembled ${label.toLowerCase()} PDF failed validation: ${messageOf(err)}`);
  }
  const path = finalPath(wb, kind);
  await ctx.deps.storage.upload(path, out);
  wb.staged[kind] = { path, pages: totalPages, bytes: out.length, crc: crc32(out) };
  if (COPY_ORDER.every((k) => wb.staged[k])) state.stage = "aggregate_publish";
}

async function publishUnit(ctx: Ctx, state: JobState): Promise<void> {
  const wb = state.wb as WorkbookState;
  if (wb.dataset_changed) throw workbookChanged();
  const missing = COPY_ORDER.find((k) => !wb.staged[k]);
  if (missing) {
    state.stage = "aggregate_assemble";
    return;
  }
  const staged = wb.staged as Record<CopyKind, StagedRef>;
  const next = { original: staged.original.path, duplicate: staged.duplicate.path, triplicate: staged.triplicate.path };

  // Resumed after a publish that already happened: recognise it, do not redo it.
  const upload = await ctx.deps.store.loadUpload(wb.upload_id);
  if (!upload) throw workbookChanged();
  const alreadyOurs = COPY_ORDER.every((k) => uploadPaths(upload)[k] === next[k]);
  if (!alreadyOurs) {
    // The set of bills must be exactly what was rendered.
    const now = await ctx.deps.store.listWorkbookBills(wb.upload_id);
    if (now.length !== wb.bill_ids.length || now.some((r, i) => r.id !== wb.bill_ids[i])) throw workbookChanged();

    // Re-read every staged file from storage: the database will only ever point at
    // bytes that were verified after they were stored.
    for (const kind of COPY_ORDER) {
      const ref = staged[kind];
      const bytes = await ctx.deps.storage.download(ref.path);
      if (!bytes || bytes.length !== ref.bytes || crc32(bytes) !== ref.crc) {
        if (!allowRepair(wb, `final-${kind}`)) {
          throw new PermanentError("staged_file_unverifiable", `The new ${COPY_LABEL[kind].toLowerCase()} combined PDF could not be verified after upload. The existing combined PDFs were kept.`);
        }
        delete wb.staged[kind];
        state.stage = "aggregate_assemble";
        return;
      }
    }

    const ok = await ctx.deps.store.updateUploadAggregates(wb.upload_id, wb.old_paths, next);
    if (!ok) {
      const again = await ctx.deps.store.loadUpload(wb.upload_id);
      if (!again || !COPY_ORDER.every((k) => uploadPaths(again)[k] === next[k])) {
        throw new PermanentError(
          "workbook_changed_during_regeneration",
          "This workbook's combined PDFs were replaced by another action while regeneration was running. Those were kept."
        );
      }
    }
  }
  wb.published = true;
  state.stage = "workbook_cleanup";
}

function uploadPaths(upload: UploadRow): CopyPaths {
  return { original: upload.original_pdf_path, duplicate: upload.duplicate_pdf_path, triplicate: upload.triplicate_pdf_path };
}

function failAggregate(state: JobState, failure: Failure): void {
  const wb = state.wb as WorkbookState;
  wb.aggregate_failure = failure;
  wb.published = false;
  state.stage = "workbook_cleanup";
}

/* ---------- workbook: cleanup and result ---------- */

async function cleanupWorkbook(ctx: Ctx, state: JobState): Promise<void> {
  const wb = state.wb as WorkbookState;
  // Every path this workbook's chunks could have used, recorded or not: an upload
  // that succeeded just before an interruption is never in the manifest.
  const temp: string[] = [];
  for (let i = 0; i < wb.chunks.original.length; i++) {
    for (const kind of COPY_ORDER) temp.push(chunkPath(wb, i, kind));
  }
  const fresh = new Set(COPY_ORDER.map((k) => finalPath(wb, k)));
  if (wb.published) {
    for (const k of COPY_ORDER) {
      const old = wb.old_paths[k];
      if (old && !fresh.has(old)) temp.push(old);
    }
  } else {
    const active = new Set(COPY_ORDER.map((k) => wb.old_paths[k]));
    for (const p of fresh) if (!active.has(p)) temp.push(p);
  }
  const warning = await removeAll(ctx, temp);
  finishWorkbook(state, workbookResult(wb, warning));
}

async function removeAll(ctx: Ctx, paths: string[]): Promise<string | undefined> {
  let warning: string | undefined;
  for (let i = 0; i < paths.length; i += 500) {
    const batch = paths.slice(i, i + 500);
    const err = await ctx.deps.storage.remove(batch);
    if (err) {
      ctx.log("regenerate: cleanup failed", { paths: batch, error: err });
      warning = `Some temporary files could not be removed: ${err}`;
    }
  }
  return warning;
}

function workbookResult(wb: WorkbookState, cleanupWarning?: string): WorkbookResult {
  const failure = wb.published ? null : wb.aggregate_failure ?? { code: "not_published", message: "The combined PDFs were not published." };
  const status: WorkbookOutcome = failure ? "failed" : wb.bills_failed > 0 ? "partial" : "succeeded";
  return {
    upload_id: wb.upload_id,
    name: wb.name,
    status,
    bills_total: wb.bill_ids.length,
    bills_succeeded: wb.bills_succeeded,
    bills_failed: wb.bills_failed,
    aggregate: wb.published ? "succeeded" : "failed",
    ...(failure ? { code: failure.code, message: failure.message } : {}),
    ...(!failure && wb.bills_failed > 0
      ? { message: `${wb.bills_failed} of ${wb.bill_ids.length} bill PDFs could not be regenerated; see the bill failures.` }
      : {}),
    ...(cleanupWarning ? { cleanup_warning: cleanupWarning } : {}),
  };
}

function skippedWorkbook(uploadId: string, name: string, code: string, message: string): WorkbookResult {
  return { upload_id: uploadId, name, status: "skipped", bills_total: 0, bills_succeeded: 0, bills_failed: 0, aggregate: "skipped", code, message };
}

function finishWorkbook(state: JobState, result: WorkbookResult): void {
  if (result.aggregate !== "skipped") {
    state.counters.aggregates_processed++;
    if (result.aggregate === "succeeded") state.counters.aggregates_succeeded++;
    else state.counters.aggregates_failed++;
  }
  state.results.push(result);
  state.wb = null;
  state.wb_index++;
  state.stage = state.wb_index < state.workbooks.length ? "workbook_prepare" : "standalone_bills";
}

/* ---------- standalone bills ---------- */

async function standaloneUnit(ctx: Ctx, state: JobState): Promise<void> {
  let bill = state.standalone_bill;
  let billId = bill?.bill_id ?? null;
  if (!billId) {
    const next = await ctx.deps.store.nextStandaloneBill(state.standalone_after, state.started_at);
    if (!next) {
      state.stage = "done";
      return;
    }
    billId = next.id;
  }
  const holder = { bill };
  const outcome = await advanceBill(ctx, holder, billId);
  bill = holder.bill;
  state.standalone_bill = bill;
  if (outcome.kind === "progress") return;
  recordStandaloneOutcome(state, billId, outcome.invoiceNo, outcome.kind === "failed" ? outcome.failure : null);
}

function recordStandaloneOutcome(state: JobState, billId: string, invoiceNo: string | null, failure: Failure | null): void {
  state.counters.bills_processed++;
  state.standalone_processed++;
  if (failure) {
    state.counters.bills_failed++;
    state.standalone_failed++;
    pushBillFailure(state, { bill_id: billId, invoice_no: invoiceNo, workbook: null, ...failure });
  } else {
    state.counters.bills_succeeded++;
    state.standalone_succeeded++;
  }
  state.standalone_bill = null;
  state.standalone_after = billId;
}

export function outcomeOf(state: JobState): JobOutcome {
  const c = state.counters;
  const failed = c.bills_failed + c.aggregates_failed;
  const succeeded = c.bills_succeeded + c.aggregates_succeeded;
  if (failed === 0) return succeeded === 0 ? "empty" : "succeeded";
  return succeeded === 0 ? "failed" : "partial";
}

/* ──────────────────────────────────────────────
   Job service: start, step, status, cancel
   ────────────────────────────────────────────── */

export interface ActionResult {
  ok: true;
  job: RegenerationView | null;
  /** Another invocation holds the job right now; poll again shortly. */
  busy?: boolean;
  /** A transient failure was recorded; try again after this long. */
  retry_after_ms?: number;
  /** True when `start` found a job already running and returned it instead. */
  attached?: boolean;
  /** Units completed by this invocation. */
  units?: number;
}

export async function startJob(deps: RegenerationDeps, userId: string | null): Promise<ActionResult> {
  const { store } = deps;
  const running = await store.findRunningJob();
  if (running && parseState(running.cursor)) return { ok: true, job: describeJob(running, nowOf(deps)), attached: true };
  if (running) {
    // A job left running by the previous version of this function. Its cursor
    // cannot be resumed by this one, and leaving it would block every new start.
    const closed = await store.updateJob(
      running.id,
      running.revision ?? 0,
      {
        status: "failed",
        last_error: "Closed: this job was started by an older version of the regenerator and cannot be resumed.",
        lease_token: null,
        lease_until: null,
        revision: (running.revision ?? 0) + 1,
      },
      { token: deps.newToken(), now: new Date(nowOf(deps)).toISOString() }
    );
    if (!closed) throw new TransientError("start_conflict", "A previous regeneration job is still being closed; please try again.");
  }

  const startedAt = new Date(nowOf(deps)).toISOString();
  const workbooks = await store.listWorkbookUploadIds();
  const standalone = await store.countStandaloneBills(startedAt);
  const state = initialState(workbooks, standalone, startedAt);
  const inserted = await store.insertRunningJob({ started_by: userId, started_at: startedAt, cursor: JSON.stringify(state), phase: "bills" });
  if (inserted) return { ok: true, job: describeJob(inserted, nowOf(deps)), attached: false };

  // Lost the race to another start: return the job that won.
  const winner = await store.findRunningJob();
  if (!winner) throw new TransientError("start_conflict", "Another regeneration job was being started; please try again.");
  return { ok: true, job: describeJob(winner, nowOf(deps)), attached: true };
}

export async function jobStatus(deps: RegenerationDeps, jobId: string | null): Promise<ActionResult> {
  const row = jobId ? await deps.store.findJob(jobId) : await deps.store.findRunningJob();
  return { ok: true, job: row ? describeJob(row, nowOf(deps)) : null };
}

function nowOf(deps: RegenerationDeps): number {
  return deps.now ? deps.now() : Date.now();
}

function phaseOf(stage: Stage): "bills" | "aggregates" {
  return stage.startsWith("aggregate_") ? "aggregates" : "bills";
}

function commitPatch(state: JobState, leaseHeld: { token: string; until: string } | null): JobPatch {
  const done = state.stage === "done";
  if (done && !state.outcome) state.outcome = outcomeOf(state);
  return {
    cursor: JSON.stringify(state),
    phase: phaseOf(state.stage),
    status: done ? "completed" : "running",
    lease_token: leaseHeld?.token ?? null,
    lease_until: leaseHeld?.until ?? null,
    last_error: state.last_error ? state.last_error.message : null,
    ...state.counters,
  };
}

/**
 * Advance a running job by as many units as fit in the time budget.
 *
 * Never creates a job and never reopens a finished one: a step for a job that is
 * no longer running just reports where it ended.
 */
export async function stepJob(deps: RegenerationDeps, jobId: string): Promise<ActionResult> {
  const { store } = deps;
  const ctx = makeCtx(deps);
  const started = nowOf(deps);
  const budget = deps.budgetMs ?? STEP_BUDGET_MS;
  const leaseMs = deps.leaseMs ?? LEASE_MS;
  const token = deps.newToken();
  let units = 0;

  let row = await store.findJob(jobId);
  if (!row) throw new PermanentError("job_not_found", "That regeneration job does not exist.");

  for (;;) {
    if (row.status !== "running") return { ok: true, job: describeJob(row, nowOf(deps)), units };
    const state = parseState(row.cursor);
    if (!state) {
      // A job written by an older version of this function, or a damaged cursor. It
      // cannot be resumed safely; close it so a fresh job can be started.
      const lease = { token, now: new Date(nowOf(deps)).toISOString() };
      const closed = await store.updateJob(row.id, row.revision, {
        status: "failed",
        last_error: "This job was started by an older version of the regenerator and cannot be resumed. Start a new regeneration.",
        revision: row.revision + 1,
        lease_token: null,
        lease_until: null,
      }, lease);
      return { ok: true, job: describeJob(closed ?? row, nowOf(deps)), busy: !closed, units };
    }

    const now = nowOf(deps);
    const lease = { token, now: new Date(now).toISOString() };
    const leaseHeld = { token, until: new Date(now + leaseMs).toISOString() };

    if (state.stage === "done") {
      const finished = await store.updateJob(row.id, row.revision, { ...commitPatch(state, null), revision: row.revision + 1 }, lease);
      return { ok: true, job: describeJob(finished ?? row, nowOf(deps)), busy: !finished, units };
    }

    // 1. Claim the job and record the attempt BEFORE doing the work, so a unit that
    //    kills the worker is still counted.
    const key = unitKey(state);
    const prev = state.unit && state.unit.key === key ? state.unit : { key, attempts: 0, transient: 0 };
    // A claim that neither committed nor recorded a transient error was killed.
    const crashes = prev.attempts - prev.transient;
    const exhausted = crashes >= MAX_UNIT_ATTEMPTS || prev.transient >= MAX_TRANSIENT_RETRIES;
    const attempts = prev.attempts + 1;
    const claimedState: JobState = { ...state, unit: { key, attempts, transient: prev.transient } };
    const claimed = await store.updateJob(
      row.id,
      row.revision,
      { cursor: JSON.stringify(claimedState), lease_token: token, lease_until: leaseHeld.until, revision: row.revision + 1 },
      lease
    );
    if (!claimed) {
      const current = (await store.findJob(jobId)) ?? row;
      return { ok: true, job: describeJob(current, nowOf(deps)), busy: current.status === "running", units };
    }
    row = claimed;

    // 2. Do the unit on a private copy; a transient failure leaves the stored state alone.
    let next: JobState;
    let retryAfter: number | undefined;
    const work: JobState = structuredClone(claimedState);
    try {
      next = exhausted ? await abandonUnit(ctx, work, crashes >= MAX_UNIT_ATTEMPTS) : await executeUnit(ctx, work);
      next.last_error = null;
      next.unit = null;
    } catch (err) {
      const transient = err instanceof TransientError || !(err instanceof PermanentError);
      ctx.log("regenerate: unit failed", { key, attempts, error: messageOf(err) });
      next = structuredClone(claimedState);
      next.last_error = {
        code: err instanceof TransientError || err instanceof PermanentError ? err.code : "unexpected_error",
        message: messageOf(err),
        transient,
      };
      // A permanent error outside a stage that absorbs it should not happen; if it
      // does, exhaust the unit so the next claim abandons it rather than repeating it.
      const transientCount = transient ? prev.transient + 1 : MAX_TRANSIENT_RETRIES;
      next.unit = { key, attempts, transient: transientCount };
      retryAfter = Math.min(2_000 * 2 ** prev.transient, 15_000);
    }

    // 3. Commit: state, counters and lease in one revision-checked write.
    const continuing = retryAfter === undefined && next.stage !== "done" && nowOf(deps) - started < budget;
    const committed = await store.updateJob(
      row.id,
      row.revision,
      { ...commitPatch(next, continuing ? leaseHeld : null), revision: row.revision + 1 },
      lease
    );
    if (!committed) {
      // Our lease expired and another invocation took over. Its state wins.
      const current = (await store.findJob(jobId)) ?? row;
      return { ok: true, job: describeJob(current, nowOf(deps)), busy: current.status === "running", units };
    }
    row = committed;
    if (retryAfter === undefined) units++;
    if (!continuing) {
      return { ok: true, job: describeJob(row, nowOf(deps)), units, ...(retryAfter !== undefined ? { retry_after_ms: retryAfter } : {}) };
    }
  }
}

/**
 * Stop a running job at a unit boundary. Temporary files of the current workbook
 * are removed; the active PDFs it would have replaced are left exactly as they were.
 */
export async function cancelJob(deps: RegenerationDeps, jobId: string): Promise<ActionResult> {
  const { store } = deps;
  const ctx = makeCtx(deps);
  const token = deps.newToken();
  const row = await store.findJob(jobId);
  if (!row) throw new PermanentError("job_not_found", "That regeneration job does not exist.");
  if (row.status !== "running") return { ok: true, job: describeJob(row, nowOf(deps)) };
  const now = nowOf(deps);
  const lease = { token, now: new Date(now).toISOString() };
  const claimed = await store.updateJob(row.id, row.revision, { lease_token: token, lease_until: new Date(now + (deps.leaseMs ?? LEASE_MS)).toISOString(), revision: row.revision + 1 }, lease);
  if (!claimed) return { ok: true, job: describeJob(row, nowOf(deps)), busy: true };

  const state = parseState(claimed.cursor);
  if (state) {
    const wb = state.wb;
    if (wb) {
      if (wb.bill) await discardIfUncommitted(ctx, wb.bill);
      if (!wb.published) {
        wb.aggregate_failure = {
          code: "cancelled",
          message: "Regeneration was stopped before this workbook's combined PDFs were replaced. The existing ones were kept.",
        };
      }
      // Records the workbook's result; for a published workbook this is the normal
      // cleanup it was about to do anyway.
      await cleanupWorkbook(ctx, state);
    }
    if (state.standalone_bill) await discardIfUncommitted(ctx, state.standalone_bill);
    state.outcome = "cancelled";
    state.unit = null;
  }
  const closed = await store.updateJob(
    claimed.id,
    claimed.revision,
    {
      ...(state ? { cursor: JSON.stringify(state), ...state.counters } : {}),
      status: "abandoned",
      lease_token: null,
      lease_until: null,
      revision: claimed.revision + 1,
    },
    lease
  );
  return { ok: true, job: describeJob(closed ?? claimed, nowOf(deps)) };
}

async function discardIfUncommitted(ctx: Ctx, p: BillProgress): Promise<void> {
  const [row] = await ctx.deps.store.loadBills([p.bill_id]);
  const committed = !!row && COPY_ORDER.some((k) => !!p.done[k] && billPaths(row)[k] === p.done[k]);
  if (!committed) await discardBillProgress(ctx, p);
}

/* ──────────────────────────────────────────────
   The view the clients render
   ────────────────────────────────────────────── */

export type CopyState = "pending" | "rendering" | "assembled" | "published" | "failed";

export interface RegenerationView {
  job_id: string;
  status: JobStatus;
  outcome: JobOutcome | null;
  stage: Stage;
  started_at: string;
  updated_at: string;
  /** True while some invocation holds the job (it is actively being worked on). */
  lease_active: boolean;
  workbooks_total: number;
  workbooks_finished: number;
  current_workbook: null | {
    position: number;
    upload_id: string;
    name: string | null;
    bills_total: number;
    bills_done: number;
    bills_succeeded: number;
    bills_failed: number;
    chunks_total: number;
    copies: Record<CopyKind, { state: CopyState; chunks_rendered: number }>;
    aggregate_blocked: { code: string; message: string } | null;
    aggregate_failure: { code: string; message: string } | null;
  };
  standalone: { total: number; processed: number; succeeded: number; failed: number };
  counters: Counters;
  workbook_results: WorkbookResult[];
  bill_failures: BillFailure[];
  bill_failures_total: number;
  last_error: { code: string; message: string; transient: boolean } | null;
  attempts: number;
}

export function describeJob(row: JobRow, now: number): RegenerationView {
  const state = parseState(row.cursor);
  const leaseActive = !!row.lease_until && Date.parse(row.lease_until) > now;
  const counters: Counters = state?.counters ?? {
    bills_processed: row.bills_processed,
    bills_succeeded: row.bills_succeeded,
    bills_failed: row.bills_failed,
    aggregates_processed: row.aggregates_processed,
    aggregates_succeeded: row.aggregates_succeeded,
    aggregates_failed: row.aggregates_failed,
  };
  const base = {
    job_id: row.id,
    status: row.status,
    started_at: row.started_at,
    updated_at: row.updated_at,
    lease_active: leaseActive,
    counters,
  };
  if (!state) {
    return {
      ...base,
      outcome: row.status === "completed" ? "succeeded" : row.status === "abandoned" ? "cancelled" : row.status === "failed" ? "failed" : null,
      stage: "done",
      workbooks_total: 0,
      workbooks_finished: 0,
      current_workbook: null,
      standalone: { total: 0, processed: 0, succeeded: 0, failed: 0 },
      workbook_results: [],
      bill_failures: [],
      bill_failures_total: 0,
      last_error: row.last_error ? { code: "job_error", message: row.last_error, transient: false } : null,
      attempts: 0,
    };
  }

  const wb = state.wb;
  let current: RegenerationView["current_workbook"] = null;
  if (state.stage.startsWith("workbook_") || state.stage.startsWith("aggregate_")) {
    const position = state.wb_index + 1;
    if (!wb) {
      current = {
        position,
        upload_id: state.workbooks[state.wb_index] ?? "",
        name: null,
        bills_total: 0,
        bills_done: 0,
        bills_succeeded: 0,
        bills_failed: 0,
        chunks_total: 0,
        copies: {
          original: { state: "pending", chunks_rendered: 0 },
          duplicate: { state: "pending", chunks_rendered: 0 },
          triplicate: { state: "pending", chunks_rendered: 0 },
        },
        aggregate_blocked: null,
        aggregate_failure: null,
      };
    } else {
      const copyState = (k: CopyKind): CopyState => {
        if (wb.published) return "published";
        if (wb.aggregate_failure) return "failed";
        if (wb.staged[k]) return "assembled";
        if (state.stage === "aggregate_render" || state.stage === "aggregate_assemble" || state.stage === "aggregate_publish") return "rendering";
        return "pending";
      };
      current = {
        position,
        upload_id: wb.upload_id,
        name: wb.name,
        bills_total: wb.bill_ids.length,
        bills_done: wb.bill_index,
        bills_succeeded: wb.bills_succeeded,
        bills_failed: wb.bills_failed,
        chunks_total: wb.chunks.original.length,
        copies: {
          original: { state: copyState("original"), chunks_rendered: wb.chunks.original.filter(Boolean).length },
          duplicate: { state: copyState("duplicate"), chunks_rendered: wb.chunks.duplicate.filter(Boolean).length },
          triplicate: { state: copyState("triplicate"), chunks_rendered: wb.chunks.triplicate.filter(Boolean).length },
        },
        aggregate_blocked: wb.aggregate_block,
        aggregate_failure: wb.aggregate_failure,
      };
    }
  }

  return {
    ...base,
    outcome: state.outcome ?? (row.status === "abandoned" ? "cancelled" : row.status === "completed" ? outcomeOf(state) : null),
    stage: state.stage,
    workbooks_total: state.workbooks.length,
    workbooks_finished: state.results.length,
    current_workbook: current,
    standalone: {
      total: state.standalone_total,
      processed: state.standalone_processed,
      succeeded: state.standalone_succeeded,
      failed: state.standalone_failed,
    },
    workbook_results: state.results,
    bill_failures: state.bill_failures,
    bill_failures_total: state.bill_failures_total,
    last_error: state.last_error ?? (row.status === "failed" && row.last_error ? { code: "job_error", message: row.last_error, transient: false } : null),
    attempts: state.unit?.attempts ?? 0,
  };
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
