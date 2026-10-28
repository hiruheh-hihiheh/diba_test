// supabase/functions/_selftest/regeneration-fakes.ts
//
// An in-memory database and storage bucket for the regeneration engine, with the
// faults the real ones can produce: transient errors, a worker killed mid-unit,
// files that go missing or come back corrupted, and rows changed by someone else
// while the job is running.
//
// It implements the same compare-and-set and lease semantics as the PostgREST
// queries in `regenerate-bill-pdfs/index.ts`, so the engine is tested against the
// contract it actually relies on.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, type BillLineItem } from "../process-bill-upload/_shared/parseBill.ts";
import { toBillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import { profileFromRow, type BusinessProfile } from "../process-bill-upload/_shared/businessProfile.ts";
import type { PdfImage } from "../process-bill-upload/_shared/pdfImage.ts";
import {
  TransientError,
  parseState,
  unitKey,
  type BillRow,
  type CopyPaths,
  type JobPatch,
  type JobRow,
  type RegenerationDeps,
  type RegenerationStorage,
  type RegenerationStore,
  type UploadRow,
  type WorkbookBillRef,
} from "../regenerate-bill-pdfs/engine.ts";

export const REPO = resolve(import.meta.dirname, "../../../..");

/** Thrown to simulate the platform killing the worker (HTTP 546). Never caught by the engine's commit path. */
export class WorkerKilled extends Error {}

export interface FakeUpload extends UploadRow {
  status: string;
  created_at: string;
}

export interface FakeBill extends BillRow {
  created_at: string;
}

export interface Op {
  op: string;
  target: string;
}

export class FakeWorld {
  clock = Date.parse("2026-10-28T09:00:00.000Z");
  jobs = new Map<string, JobRow>();
  uploads = new Map<string, FakeUpload>();
  bills = new Map<string, FakeBill>();
  items = new Map<string, BillLineItem[]>();
  logos = new Map<string, PdfImage | null>();
  files = new Map<string, Uint8Array>();
  profileRow: Record<string, unknown> | null = null;

  /** Every storage and repoint operation, in order. */
  ops: Op[] = [];
  uploadCounts = new Map<string, number>();
  loadBillsCalls: string[][] = [];

  /** Fail the next N calls of an operation with a TransientError. */
  transient = new Map<string, number>();
  /** Fail every call of an operation (e.g. a permanently unreachable table). */
  alwaysFail = new Set<string>();
  /** Kill the worker when committing a unit; given the unit key and its attempt number. */
  killOnCommit: ((key: string, attempts: number) => boolean) | null = null;
  /** Called after each successful file upload; may corrupt or delete it. */
  afterUpload: ((path: string) => void) | null = null;
  /** Called before each unit is committed, with the key of the unit just done. */
  beforeCommit: ((key: string) => void) | null = null;

  private seq = 0;
  private jobSeq = 0;

  nowIso(): string {
    return new Date(this.clock).toISOString();
  }

  private fault(op: string): void {
    if (this.alwaysFail.has(op)) throw new TransientError("db_unavailable", `${op}: simulated outage`);
    const n = this.transient.get(op) ?? 0;
    if (n > 0) {
      this.transient.set(op, n - 1);
      throw new TransientError("db_unavailable", `${op}: simulated transient failure`);
    }
  }

  /* ---------- seeding ---------- */

  addWorkbook(
    name: string,
    parsed: { sheetName: string; original: { lineItems: BillLineItem[] } & Record<string, unknown> }[],
    opts: { snapshot?: unknown; nullOrder?: boolean; withOldAggregates?: boolean } = {}
  ): { uploadId: string; billIds: string[] } {
    const uploadId = `u${String(++this.seq).padStart(3, "0")}`;
    const baseName = name.replace(/\.xlsx$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_");
    const old = opts.withOldAggregates === false
      ? { original: null, duplicate: null, triplicate: null }
      : {
          original: `${uploadId}/${baseName}_original.pdf`,
          duplicate: `${uploadId}/${baseName}_duplicate.pdf`,
          triplicate: `${uploadId}/${baseName}_triplicate.pdf`,
        };
    for (const p of Object.values(old)) if (p) this.files.set(p, new TextEncoder().encode(`old aggregate ${p}`));
    this.uploads.set(uploadId, {
      id: uploadId,
      original_filename: name,
      base_name: baseName,
      creation_source: "workbook",
      status: "completed",
      created_at: new Date(this.clock - 1_000_000 + this.seq).toISOString(),
      original_pdf_path: old.original,
      duplicate_pdf_path: old.duplicate,
      triplicate_pdf_path: old.triplicate,
    });
    const billIds = parsed.map((p, i) => this.addBill(uploadId, p, i + 1, opts.snapshot ?? null, opts.nullOrder));
    return { uploadId, billIds };
  }

  addManualBill(parsed: { sheetName: string; original: { lineItems: BillLineItem[] } & Record<string, unknown> }, opts: { logoId?: string } = {}): string {
    const uploadId = `m${String(++this.seq).padStart(3, "0")}`;
    this.uploads.set(uploadId, {
      id: uploadId,
      original_filename: "Bill Creator",
      base_name: "manual",
      creation_source: "manual",
      status: "completed",
      created_at: new Date(this.clock - 500_000).toISOString(),
      original_pdf_path: null,
      duplicate_pdf_path: null,
      triplicate_pdf_path: null,
    });
    const id = this.addBill(uploadId, parsed, null, null, false);
    if (opts.logoId) (this.bills.get(id) as FakeBill).logo_id = opts.logoId;
    return id;
  }

  private addBill(
    uploadId: string,
    parsed: { sheetName: string; original: { lineItems: BillLineItem[] } & Record<string, unknown> },
    order: number | null,
    snapshot: unknown,
    nullOrder?: boolean
  ): string {
    const id = `b${String(++this.seq).padStart(4, "0")}`;
    const record = toBillRecord(parsed as never, uploadId);
    const paths = {
      original_pdf_path: `${uploadId}/${id}_old_original.pdf`,
      duplicate_pdf_path: `${uploadId}/${id}_old_duplicate.pdf`,
      triplicate_pdf_path: `${uploadId}/${id}_old_triplicate.pdf`,
    };
    for (const p of Object.values(paths)) this.files.set(p, new TextEncoder().encode(`old bill ${p}`));
    this.bills.set(id, {
      ...record,
      id,
      bill_upload_id: uploadId,
      status: "finalized",
      sheet_name: parsed.sheetName,
      invoice_no: (record.invoice_no as string | null) ?? null,
      sheet_order: nullOrder ? null : order,
      pdf_version: 1,
      logo_id: null,
      logo_rendered_logo_id: null,
      business_profile_snapshot: snapshot,
      created_at: new Date(this.clock - 400_000).toISOString(),
      ...paths,
    } as FakeBill);
    this.items.set(id, parsed.original.lineItems.map((li) => ({ ...li })));
    return id;
  }

  /* ---------- the ports ---------- */

  store(): RegenerationStore {
    const world = this;
    const copy = <T>(v: T): T => structuredClone(v);
    return {
      async findRunningJob() {
        world.fault("findRunningJob");
        const row = [...world.jobs.values()].find((j) => j.status === "running");
        return row ? copy(row) : null;
      },
      async findJob(id) {
        world.fault("findJob");
        const row = world.jobs.get(id);
        return row ? copy(row) : null;
      },
      async insertRunningJob(row) {
        world.fault("insertRunningJob");
        // The partial unique index from 0023.
        if ([...world.jobs.values()].some((j) => j.status === "running")) return null;
        const id = `job-${++world.jobSeq}`;
        const job: JobRow = {
          id,
          status: "running",
          phase: row.phase,
          cursor: row.cursor,
          revision: 0,
          lease_token: null,
          lease_until: null,
          started_at: row.started_at,
          updated_at: world.nowIso(),
          last_error: null,
          bills_processed: 0,
          bills_succeeded: 0,
          bills_failed: 0,
          aggregates_processed: 0,
          aggregates_succeeded: 0,
          aggregates_failed: 0,
        };
        world.jobs.set(id, job);
        return copy(job);
      },
      async updateJob(id, expectedRevision, patch: JobPatch, lease) {
        world.fault("updateJob");
        const row = world.jobs.get(id);
        if (!row || row.revision !== expectedRevision || row.status !== "running") return null;
        const free = row.lease_until === null || row.lease_until < lease.now || row.lease_token === lease.token;
        if (!free) return null;
        if ("status" in patch) {
          // A commit, as opposed to a claim: this is where a killed worker never arrives.
          const unit = parseState(row.cursor)?.unit;
          const key = unit?.key ?? "";
          world.beforeCommit?.(key);
          if (world.killOnCommit?.(key, unit?.attempts ?? 0)) throw new WorkerKilled(`worker killed while committing ${key}`);
        }
        Object.assign(row, patch, { updated_at: world.nowIso() });
        return copy(row);
      },
      async listWorkbookUploadIds() {
        world.fault("listWorkbookUploadIds");
        return [...world.uploads.values()]
          .filter((u) => u.creation_source === "workbook" && u.status === "completed")
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
          .map((u) => u.id);
      },
      async countStandaloneBills(createdBefore) {
        world.fault("countStandaloneBills");
        return world.standalone(createdBefore).length;
      },
      async nextStandaloneBill(afterId, createdBefore) {
        world.fault("nextStandaloneBill");
        const next = world.standalone(createdBefore).find((b) => afterId === null || b.id > afterId);
        return next ? copy(next) : null;
      },
      async loadUpload(id) {
        world.fault("loadUpload");
        const u = world.uploads.get(id);
        return u ? copy(u) : null;
      },
      async listWorkbookBills(uploadId) {
        world.fault("listWorkbookBills");
        return [...world.bills.values()]
          .filter((b) => b.bill_upload_id === uploadId && b.status === "finalized")
          .sort((a, b) => {
            const ao = a.sheet_order ?? Number.POSITIVE_INFINITY;
            const bo = b.sheet_order ?? Number.POSITIVE_INFINITY;
            return ao - bo || a.id.localeCompare(b.id);
          })
          .map((b): WorkbookBillRef => ({ id: b.id, sheet_order: b.sheet_order, business_profile_snapshot: copy(b.business_profile_snapshot) }));
      },
      async loadBills(ids) {
        world.fault("loadBills");
        world.loadBillsCalls.push([...ids]);
        return ids.map((id) => world.bills.get(id)).filter((b): b is FakeBill => !!b).map(copy);
      },
      async loadLineItems(ids) {
        world.fault("loadLineItems");
        const out = new Map<string, BillLineItem[]>();
        for (const id of ids) {
          const items = world.items.get(id);
          if (items) out.set(id, copy(items));
        }
        return out;
      },
      async updateBillPdfs(billId, expectedVersion, patch) {
        world.fault("updateBillPdfs");
        const b = world.bills.get(billId);
        if (!b || b.pdf_version !== expectedVersion) return false;
        Object.assign(b, copy(patch));
        world.ops.push({ op: "repoint-bill", target: billId });
        return true;
      },
      async updateUploadAggregates(uploadId, expected: CopyPaths, next) {
        world.fault("updateUploadAggregates");
        const u = world.uploads.get(uploadId);
        if (!u) return false;
        if (u.original_pdf_path !== expected.original || u.duplicate_pdf_path !== expected.duplicate || u.triplicate_pdf_path !== expected.triplicate) {
          return false;
        }
        u.original_pdf_path = next.original;
        u.duplicate_pdf_path = next.duplicate;
        u.triplicate_pdf_path = next.triplicate;
        world.ops.push({ op: "repoint-upload", target: uploadId });
        return true;
      },
      async loadLogo(logoId) {
        world.fault("loadLogo");
        return world.logos.get(logoId) ?? null;
      },
      async loadBusinessProfile() {
        world.fault("loadBusinessProfile");
        return profileFromRow(world.profileRow) as BusinessProfile;
      },
    };
  }

  storage(): RegenerationStorage {
    const world = this;
    return {
      async upload(path, bytes) {
        world.fault("upload");
        world.files.set(path, bytes.slice());
        world.uploadCounts.set(path, (world.uploadCounts.get(path) ?? 0) + 1);
        world.ops.push({ op: "upload", target: path });
        world.afterUpload?.(path);
      },
      async download(path) {
        world.fault("download");
        world.ops.push({ op: "download", target: path });
        const f = world.files.get(path);
        return f ? f.slice() : null;
      },
      async remove(paths) {
        if (world.alwaysFail.has("remove")) return "simulated remove failure";
        for (const p of paths) world.files.delete(p);
        world.ops.push(...paths.map((p) => ({ op: "remove", target: p })));
        return null;
      },
    };
  }

  standalone(createdBefore: string): FakeBill[] {
    return [...this.bills.values()]
      .filter((b) => b.status === "finalized" && b.created_at <= createdBefore && this.uploads.get(b.bill_upload_id)?.creation_source === "manual")
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  deps(overrides: Partial<RegenerationDeps> = {}): RegenerationDeps {
    let token = 0;
    return {
      store: this.store(),
      storage: this.storage(),
      newToken: () => `tok-${++token}-${Math.random().toString(36).slice(2, 8)}`,
      now: () => this.clock,
      budgetMs: 0,
      ...overrides,
    };
  }
}

/** Parse a committed fixture workbook into the shape `toBillRecord` reads. */
export async function fixtureBills(file: string): Promise<{ sheetName: string; original: { lineItems: BillLineItem[] } & Record<string, unknown> }[]> {
  const wb = await readXlsx(readFileSync(resolve(REPO, file)));
  return parseBills(wb.sheets).bills as never;
}

export { unitKey };
