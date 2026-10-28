// supabase/functions/regenerate-bill-pdfs/index.ts
//
// Rebuilds every stored invoice PDF from the bill records already in the database,
// one workbook at a time. The workflow itself lives in `engine.ts`; this file is
// the HTTP surface (auth, actions) and the Supabase-backed implementations of the
// engine's store and storage interfaces.
//
// ACTIONS (POST body `{ action, job_id? }`)
//   start   return the running job, or create one. Never creates a second job.
//   step    advance the given job by a few units of work and report progress.
//   status  report the running job (or the given job) without doing any work.
//   cancel  stop the given job at a unit boundary; active PDFs are left as they are.
//
// Requires migration 0024 (job lease + revision). Without it every action answers
// 503 with an explanation instead of running half-protected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import type { BillLineItem } from "../process-bill-upload/_shared/parseBill.ts";
import { loadActiveBusinessProfile } from "../process-bill-upload/_shared/businessProfileDb.ts";
import { decodePdfImage } from "../process-bill-upload/_shared/pdfImage.ts";
import { LOGO_BUCKET } from "../process-bill-upload/_shared/invoiceLogo.ts";
import {
  PermanentError,
  TransientError,
  cancelJob,
  jobStatus,
  messageOf,
  startJob,
  stepJob,
  type BillRow,
  type CopyPaths,
  type JobRow,
  type RegenerationDeps,
  type RegenerationStorage,
  type RegenerationStore,
  type UploadRow,
  type WorkbookBillRef,
} from "./engine.ts";

const BUCKET = "bills";
const JOBS = "bill_pdf_regeneration_jobs";
const PAGE = 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Client = ReturnType<typeof createClient>;
type DbError = { message: string; code?: string } | null;

/** Raised when the job table predates migration 0024. */
class MigrationRequiredError extends Error {}

function dbFail(op: string, error: DbError): never {
  const message = error?.message ?? "unknown error";
  if (/revision|lease_token|lease_until/.test(message) && /column|schema cache/i.test(message)) {
    throw new MigrationRequiredError(message);
  }
  throw new TransientError("db_unavailable", `${op}: ${message}`);
}

function supabaseStore(admin: Client): RegenerationStore {
  const firstRow = <T>(data: unknown): T | null => (Array.isArray(data) && data.length > 0 ? (data[0] as T) : null);

  return {
    async findRunningJob() {
      const { data, error } = await admin.from(JOBS).select("*").eq("status", "running").limit(1);
      if (error) dbFail("read running job", error);
      return firstRow<JobRow>(data);
    },
    async findJob(id) {
      const { data, error } = await admin.from(JOBS).select("*").eq("id", id).limit(1);
      if (error) dbFail("read job", error);
      return firstRow<JobRow>(data);
    },
    async insertRunningJob(row) {
      const { data, error } = await admin
        .from(JOBS)
        .insert({ ...row, status: "running", revision: 0 })
        .select("*");
      // 23505: the one-running-job unique index rejected a second running job.
      if (error && error.code === "23505") return null;
      if (error) dbFail("create job", error);
      return firstRow<JobRow>(data);
    },
    async updateJob(id, expectedRevision, patch, lease) {
      const { data, error } = await admin
        .from(JOBS)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("revision", expectedRevision)
        .eq("status", "running")
        .or(`lease_until.is.null,lease_until.lt."${lease.now}",lease_token.eq.${lease.token}`)
        .select("*");
      if (error) dbFail("update job", error);
      return firstRow<JobRow>(data);
    },
    async listWorkbookUploadIds() {
      const ids: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("bill_uploads")
          .select("id")
          .eq("creation_source", "workbook")
          .eq("status", "completed")
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) dbFail("list workbooks", error);
        const rows = (data ?? []) as { id: string }[];
        ids.push(...rows.map((r) => r.id));
        if (rows.length < PAGE) return ids;
      }
    },
    async countStandaloneBills(createdBefore) {
      const { count, error } = await admin
        .from("bills")
        .select("id, bill_uploads!inner(creation_source)", { count: "exact", head: true })
        .eq("bill_uploads.creation_source", "manual")
        .eq("status", "finalized")
        .lte("created_at", createdBefore);
      if (error) dbFail("count standalone bills", error);
      return count ?? 0;
    },
    async nextStandaloneBill(afterId, createdBefore) {
      let q = admin
        .from("bills")
        .select("*, bill_uploads!inner(creation_source)")
        .eq("bill_uploads.creation_source", "manual")
        .eq("status", "finalized")
        .lte("created_at", createdBefore)
        .order("id", { ascending: true })
        .limit(1);
      if (afterId) q = q.gt("id", afterId);
      const { data, error } = await q;
      if (error) dbFail("read standalone bill", error);
      const row = firstRow<BillRow & { bill_uploads?: unknown }>(data);
      if (!row) return null;
      // The join exists only to filter by the upload's source; it is not bill data.
      const bill = { ...row };
      delete bill.bill_uploads;
      return bill as BillRow;
    },
    async loadUpload(id) {
      const { data, error } = await admin
        .from("bill_uploads")
        .select("id, original_filename, base_name, creation_source, original_pdf_path, duplicate_pdf_path, triplicate_pdf_path")
        .eq("id", id)
        .limit(1);
      if (error) dbFail("read workbook", error);
      return firstRow<UploadRow>(data);
    },
    async listWorkbookBills(uploadId) {
      const out: WorkbookBillRef[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("bills")
          .select("id, sheet_order, business_profile_snapshot")
          .eq("bill_upload_id", uploadId)
          .eq("status", "finalized")
          .order("sheet_order", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) dbFail("list workbook bills", error);
        const rows = (data ?? []) as WorkbookBillRef[];
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },
    async loadBills(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await admin.from("bills").select("*").in("id", ids);
      if (error) dbFail("read bills", error);
      return (data ?? []) as BillRow[];
    },
    async loadLineItems(billIds) {
      const out = new Map<string, BillLineItem[]>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("bill_line_items")
          .select("id, bill_id, sr_no, description, hsn_code, uom, quantity, rate, amount")
          .in("bill_id", billIds)
          .order("bill_id", { ascending: true })
          .order("sr_no", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) dbFail("read line items", error);
        const rows = (data ?? []) as Record<string, unknown>[];
        for (const r of rows) {
          const list = out.get(r.bill_id as string) ?? [];
          list.push({
            srNo: r.sr_no === null ? null : Number(r.sr_no),
            description: (r.description as string | null) ?? "",
            hsnCode: (r.hsn_code as string | null) ?? null,
            uom: (r.uom as string | null) ?? null,
            quantity: r.quantity === null ? null : Number(r.quantity),
            rate: r.rate === null ? null : Number(r.rate),
            amount: r.amount === null ? null : Number(r.amount),
          });
          out.set(r.bill_id as string, list);
        }
        if (rows.length < PAGE) return out;
      }
    },
    async updateBillPdfs(billId, expectedVersion, patch) {
      const { data, error } = await admin
        .from("bills")
        .update(patch)
        .eq("id", billId)
        .eq("pdf_version", expectedVersion)
        .select("id");
      if (error) dbFail("save bill PDFs", error);
      return Array.isArray(data) && data.length > 0;
    },
    async updateUploadAggregates(uploadId, expected: CopyPaths, next) {
      let q = admin
        .from("bill_uploads")
        .update({
          original_pdf_path: next.original,
          duplicate_pdf_path: next.duplicate,
          triplicate_pdf_path: next.triplicate,
        })
        .eq("id", uploadId);
      for (const kind of ["original", "duplicate", "triplicate"] as const) {
        const old = expected[kind];
        q = old === null ? q.is(`${kind}_pdf_path`, null) : q.eq(`${kind}_pdf_path`, old);
      }
      const { data, error } = await q.select("id");
      if (error) dbFail("save workbook PDFs", error);
      return Array.isArray(data) && data.length > 0;
    },
    async loadLogo(logoId) {
      // Unlike `loadInvoiceLogoImage`, this separates "the logo is gone or unusable"
      // (a fact about the bill: fail it) from "storage did not answer" (retry).
      const { data, error } = await admin.from("invoice_logos").select("storage_path").eq("id", logoId).limit(1);
      if (error) dbFail("read logo", error);
      const row = firstRow<{ storage_path: string }>(data);
      if (!row) return null;
      const { data: blob, error: dlError } = await admin.storage.from(LOGO_BUCKET).download(row.storage_path);
      if (dlError) {
        if (isNotFound(dlError)) return null;
        throw new TransientError("storage_unavailable", `download logo: ${dlError.message}`);
      }
      return await decodePdfImage(new Uint8Array(await blob.arrayBuffer()));
    },
    async loadBusinessProfile() {
      try {
        return await loadActiveBusinessProfile(admin);
      } catch (err) {
        throw new TransientError("profile_unreadable", messageOf(err));
      }
    },
  };
}

function isNotFound(error: { message: string; statusCode?: string | number; status?: number }): boolean {
  return /not.?found|does not exist|404/i.test(`${error.message} ${error.statusCode ?? ""} ${error.status ?? ""}`);
}

function supabaseStorage(admin: Client): RegenerationStorage {
  const bucket = () => admin.storage.from(BUCKET);
  return {
    async upload(path, bytes) {
      const { error } = await bucket().upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (error) throw new TransientError("storage_unavailable", `upload ${path}: ${error.message}`);
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error) {
        if (isNotFound(error)) return null;
        throw new TransientError("storage_unavailable", `download ${path}: ${error.message}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return null;
      const { error } = await bucket().remove(paths);
      return error ? error.message : null;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return json({ ok: false, error: "Server configuration error." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Not authenticated." }, 401);

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData?.user) return json({ ok: false, error: "Not authenticated." }, 401);
  const user = userData.user;

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileErr } = await admin.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (profileErr) return json({ ok: false, error: profileErr.message, retryable: true }, 503);
  if (!profile || profile.role !== "admin" || profile.is_active !== true) {
    return json({ ok: false, error: "Admin access only." }, 403);
  }

  let body: { action?: string; job_id?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const action = body.action ?? "status";
  const jobId = typeof body.job_id === "string" && body.job_id !== "" ? body.job_id : null;

  const deps: RegenerationDeps = {
    store: supabaseStore(admin),
    storage: supabaseStorage(admin),
    newToken: () => crypto.randomUUID(),
    log: (message, detail) => console.log(message, detail === undefined ? "" : JSON.stringify(detail)),
  };

  try {
    switch (action) {
      case "start":
        return json(await startJob(deps, user.id as string));
      case "step":
        if (!jobId) return json({ ok: false, error: "job_id is required." }, 400);
        return json(await stepJob(deps, jobId));
      case "status":
        return json(await jobStatus(deps, jobId));
      case "cancel":
        if (!jobId) return json({ ok: false, error: "job_id is required." }, 400);
        return json(await cancelJob(deps, jobId));
      default:
        return json({ ok: false, error: `Unknown action "${action}".` }, 400);
    }
  } catch (err) {
    if (err instanceof MigrationRequiredError) {
      console.error("regenerate: migration 0024 missing", err.message);
      return json(
        {
          ok: false,
          code: "migration_required",
          error: "PDF regeneration needs database migration 0024 (job lease) to be applied before it can run.",
        },
        503
      );
    }
    if (err instanceof PermanentError) return json({ ok: false, code: err.code, error: err.message }, 404);
    console.error("regenerate: request failed", messageOf(err));
    return json({ ok: false, code: err instanceof TransientError ? err.code : "unexpected_error", error: messageOf(err), retryable: true }, 503);
  }
});
