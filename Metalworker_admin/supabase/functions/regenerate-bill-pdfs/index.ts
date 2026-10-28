import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import { safeBillToken, COPY_LABEL, COPY_ORDER, type BillLineItem } from "../process-bill-upload/_shared/parseBill.ts";
import { loadInvoiceLogoImage } from "../process-bill-upload/_shared/invoiceLogo.ts";
import { loadActiveBusinessProfile } from "../process-bill-upload/_shared/businessProfileDb.ts";
import { profileForBill, profileFromRow, type BusinessProfile } from "../process-bill-upload/_shared/businessProfile.ts";

const BUCKET = "bills";
const CHUNK_SIZE = 5;

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
  if (profileErr) return json({ ok: false, error: profileErr.message }, 500);
  if (!profile || profile.role !== "admin" || profile.is_active !== true) {
    return json({ ok: false, error: "Admin access only." }, 403);
  }

  let body: { job_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let currentProfile: BusinessProfile;
  try {
    currentProfile = await loadActiveBusinessProfile(admin);
  } catch (err) {
    console.error("regenerate: profile load failed", err);
    return json({ ok: false, error: "Business profile could not be loaded." }, 500);
  }

  // Resume or create job.
  let job: Record<string, unknown> | null = null;
  if (body.job_id) {
    const { data, error: jobErr } = await admin.from("bill_pdf_regeneration_jobs").select("*").eq("id", body.job_id).maybeSingle();
    if (jobErr) return json({ ok: false, error: jobErr.message }, 500);
    job = (data as Record<string, unknown> | null) ?? null;
    if (!job || job.status !== "running") {
      return json({ ok: false, error: "That regeneration job is not active." }, 409);
    }
  } else {
    const { data: running, error: runningErr } = await admin.from("bill_pdf_regeneration_jobs").select("*").eq("status", "running").maybeSingle();
    if (runningErr) return json({ ok: false, error: runningErr.message }, 500);
    if (running) {
      job = running as Record<string, unknown>;
    } else {
      const { data: created, error: createErr } = await admin
        .from("bill_pdf_regeneration_jobs")
        .insert({ started_by: user.id, status: "running", phase: "bills", cursor: null })
        .select("*")
        .single();
      if (createErr || !created) {
        return json({ ok: false, error: createErr?.message ?? "Could not start regeneration job." }, 500);
      }
      job = created as Record<string, unknown>;
    }
  }

  const jobId = job.id as string;
  const phase = (job.phase as string) === "aggregates" ? "aggregates" : "bills";
  const cursorRaw = (job.cursor as string | null) ?? null;
  const counters = {
    bills_processed: Number(job.bills_processed ?? 0),
    bills_succeeded: Number(job.bills_succeeded ?? 0),
    bills_failed: Number(job.bills_failed ?? 0),
    aggregates_processed: Number(job.aggregates_processed ?? 0),
    aggregates_succeeded: Number(job.aggregates_succeeded ?? 0),
    aggregates_failed: Number(job.aggregates_failed ?? 0),
  };

  // ---------- bills phase ----------
  if (phase === "bills") {
    let state: { bill_id: string; copy: string; completed: Record<string, string>; profile?: BusinessProfile; snapshot?: unknown } | null = null;
    let billRow: Record<string, unknown> | null = null;

    if (cursorRaw && cursorRaw.startsWith("{")) {
      try { state = JSON.parse(cursorRaw); } catch { state = null; }
      if (state) {
        const { data, error: billErr } = await admin.from("bills").select("*").eq("id", state.bill_id).maybeSingle();
        if (billErr) return json({ ok: false, error: billErr.message }, 500);
        billRow = (data as Record<string, unknown> | null) ?? null;
      }
    }

    if (!billRow) {
      let q = admin.from("bills").select("*").eq("status", "finalized").order("id", { ascending: true }).limit(1);
      if (cursorRaw && !cursorRaw.startsWith("{")) q = q.gt("id", cursorRaw);
      const { data, error: billsErr } = await q;
      if (billsErr) return json({ ok: false, error: billsErr.message }, 500);
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) {
        await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: null, updated_at: new Date().toISOString() }).eq("id", jobId);
        return json({ ok: true, job_id: jobId, phase: "bills", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: null, more: true, counters });
      }
      billRow = rows[0];
      state = { bill_id: billRow.id as string, copy: "original", completed: {} };
    }

    if (!billRow) {
      await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: null, updated_at: new Date().toISOString() }).eq("id", jobId);
      return json({ ok: true, job_id: jobId, phase: "bills", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: null, more: true, counters });
    }

    const billId = billRow.id as string;
    const copy = (state?.copy || "original") as "original" | "duplicate" | "triplicate";
    const completed = (state?.completed || {}) as Record<string, string>;

    // profile freeze
    let billProfile: { profile: BusinessProfile; snapshot: unknown };
    if (state?.profile) {
      billProfile = { profile: state.profile as BusinessProfile, snapshot: state.snapshot };
    } else {
      billProfile = profileForBill(currentProfile, billRow.business_profile_snapshot);
      if (state) { state.profile = billProfile.profile; state.snapshot = billProfile.snapshot; }
    }

    // logo
    let logo = null;
    const logoId = (billRow.logo_id as string | null) ?? null;
    if (logoId) {
      logo = await loadInvoiceLogoImage(admin, logoId);
      if (!logo) {
        counters.bills_processed += 1;
        counters.bills_failed += 1;
        const uploaded = Object.values(completed);
        if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
        const { data: nextRows, error: nextErr } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
        if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
        const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
        const nextCursor = nextId ? nextId : null;
        const nextPhase = nextId ? "bills" : "aggregates";
        const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: nextPhase, cursor: nextCursor, bills_processed: counters.bills_processed, bills_failed: counters.bills_failed, updated_at: new Date().toISOString() }).eq("id", jobId);
        if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
        return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "logo_unreadable" }], next_cursor: nextCursor, more: true, counters });
      }
    }

    const { data: itemRows, error: itemErr } = await admin.from("bill_line_items").select("sr_no, description, hsn_code, uom, quantity, rate, amount").eq("bill_id", billId).order("sr_no", { ascending: true });
    if (itemErr) {
      counters.bills_processed += 1;
      counters.bills_failed += 1;
      const uploaded = Object.values(completed);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      const { data: nextRows, error: nextErr } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
      if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextPhase = nextId ? "bills" : "aggregates";
      const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: nextPhase, cursor: nextCursor, bills_processed: counters.bills_processed, bills_failed: counters.bills_failed, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
      return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "line_items_unreadable" }], next_cursor: nextCursor, more: true, counters });
    }
    const items: BillLineItem[] = ((itemRows ?? []) as Record<string, unknown>[]).map((r) => ({
      srNo: r.sr_no === null ? null : Number(r.sr_no),
      description: (r.description as string | null) ?? "",
      hsnCode: (r.hsn_code as string | null) ?? null,
      uom: (r.uom as string | null) ?? null,
      quantity: r.quantity === null ? null : Number(r.quantity),
      rate: r.rate === null ? null : Number(r.rate),
      amount: r.amount === null ? null : Number(r.amount),
    }));

    const nextVersion = (Number(billRow.pdf_version) || 1) + 1;
    const token = safeBillToken((billRow.invoice_no as string | null) ?? null, billRow.sheet_name as string);
    const path = `${billRow.bill_upload_id as string}/${billId}_${token}_v${nextVersion}_${copy}.pdf`;

    let rendered: Uint8Array;
    try {
      const model = billFromRecord({ ...(billRow as unknown as BillRecord), copy }, items, COPY_LABEL[copy]);
      rendered = renderBillDocument([model], COPY_LABEL[copy], logo, billProfile.profile);
    } catch (err) {
      console.error("regenerate: render failed", billId, copy, err);
      const uploaded = Object.values(completed);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      counters.bills_processed += 1;
      counters.bills_failed += 1;
      const { data: nextRows, error: nextErr } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
      if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextPhase = nextId ? "bills" : "aggregates";
      const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: nextPhase, cursor: nextCursor, bills_processed: counters.bills_processed, bills_failed: counters.bills_failed, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
      return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "pdf_failed" }], next_cursor: nextCursor, more: true, counters });
    }

    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, rendered, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error("regenerate: upload failed", path, upErr.message);
      const uploaded = Object.values(completed);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      counters.bills_processed += 1;
      counters.bills_failed += 1;
      const { data: nextRows, error: nextErr } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
      if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextPhase = nextId ? "bills" : "aggregates";
      const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: nextPhase, cursor: nextCursor, bills_processed: counters.bills_processed, bills_failed: counters.bills_failed, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
      return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "storage_failed" }], next_cursor: nextCursor, more: true, counters });
    }

    completed[copy] = path;

    const allDone = completed.original && completed.duplicate && completed.triplicate;
    if (allDone) {
      const { error: repointError } = await admin.from("bills").update({
        original_pdf_path: completed.original,
        duplicate_pdf_path: completed.duplicate,
        triplicate_pdf_path: completed.triplicate,
        pdf_version: nextVersion,
        logo_rendered_logo_id: logoId,
        business_profile_snapshot: billProfile.snapshot,
      }).eq("id", billId);

      if (repointError) {
        const uploaded = Object.values(completed);
        await admin.storage.from(BUCKET).remove(uploaded);
        counters.bills_processed += 1;
        counters.bills_failed += 1;
        const { data: nextRows, error: nextErr } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
        if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
        const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
        const nextCursor = nextId ? nextId : null;
        const nextPhase = nextId ? "bills" : "aggregates";
        const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: nextPhase, cursor: nextCursor, bills_processed: counters.bills_processed, bills_failed: counters.bills_failed, updated_at: new Date().toISOString() }).eq("id", jobId);
        if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
        return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "save_failed" }], next_cursor: nextCursor, more: true, counters });
      }

      const superseded = [billRow.original_pdf_path, billRow.duplicate_pdf_path, billRow.triplicate_pdf_path].filter(
        (p): p is string => typeof p === "string" && p !== "" && !Object.values(completed).includes(p)
      );
      if (superseded.length > 0) {
        const { error } = await admin.storage.from(BUCKET).remove(superseded);
        if (error) console.warn("regenerate: cleanup failed", error.message, superseded);
      }

      counters.bills_processed += 1;
      counters.bills_succeeded += 1;

      const { data: nextRows, error: nextErr } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
      if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextPhase = nextId ? "bills" : "aggregates";
      const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: nextPhase, cursor: nextCursor, bills_processed: counters.bills_processed, bills_succeeded: counters.bills_succeeded, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);

      return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 1, failed: 0, failures: [], next_cursor: nextCursor, more: true, counters });
    }

    const nextCopy = copy === "original" ? "duplicate" : copy === "duplicate" ? "triplicate" : "triplicate";
    const stateJson = JSON.stringify({ bill_id: billId, copy: nextCopy, completed, profile: state?.profile ?? billProfile.profile, snapshot: state?.snapshot ?? billProfile.snapshot });
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ cursor: stateJson, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);

    return json({ ok: true, job_id: jobId, phase: "bills", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: stateJson, more: true, counters });
  }

  // ---------- aggregates phase ----------
  const CHUNK_SIZE = 5;
  let aggState: { upload_id: string; stage: string; chunk_index: number; total_bills: number; chunk_paths: { original: string[]; duplicate: string[]; triplicate: string[] }; chosen_snapshot?: unknown; profile?: BusinessProfile; snapshot?: unknown } | null = null;
  let uploadRow: Record<string, unknown> | null = null;

  if (cursorRaw && cursorRaw.startsWith("{")) {
    try { aggState = JSON.parse(cursorRaw); } catch { aggState = null; }
    if (aggState) {
      const { data, error: uploadErr } = await admin.from("bill_uploads").select("*").eq("id", aggState.upload_id).maybeSingle();
      if (uploadErr) return json({ ok: false, error: uploadErr.message }, 500);
      uploadRow = (data as Record<string, unknown> | null) ?? null;
    }
  }

  if (!uploadRow) {
    let q = admin.from("bill_uploads").select("*").eq("creation_source", "workbook").order("id", { ascending: true }).limit(1);
    if (cursorRaw && !cursorRaw.startsWith("{")) q = q.gt("id", cursorRaw);
    const { data, error: discErr } = await q;
    if (discErr) {
      const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ last_error: discErr.message, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
      return json({ ok: false, error: discErr.message }, 500);
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) {
      await admin.from("bill_pdf_regeneration_jobs").update({ status: "completed", phase: "aggregates", cursor: null, updated_at: new Date().toISOString() }).eq("id", jobId);
      return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: null, more: false, counters });
    }
    uploadRow = rows[0];
    aggState = { upload_id: uploadRow.id as string, stage: "render", chunk_index: 0, total_bills: 0, chunk_paths: { original: [], duplicate: [], triplicate: [] } };
  }

  if (!uploadRow || !aggState) {
    await admin.from("bill_pdf_regeneration_jobs").update({ status: "completed", phase: "aggregates", cursor: null, updated_at: new Date().toISOString() }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: null, more: false, counters });
  }

  const uploadId = uploadRow.id as string;

  if (aggState.stage !== "merge") {
  const { count: totalCount, error: countErr } = await admin.from("bills").select("id", { count: "exact", head: true }).eq("bill_upload_id", uploadId).eq("status", "finalized");
  if (countErr) {
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "bills_unreadable" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }
  const totalBills = totalCount ?? 0;
  if (totalBills === 0) {
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "no_finalized_bills" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  if (aggState.total_bills === 0) {
    aggState.total_bills = totalBills;
    aggState.chunk_index = 0;
    aggState.chunk_paths = { original: [], duplicate: [], triplicate: [] };
  } else if (aggState.total_bills !== totalBills) {
    const uploaded = Object.values(aggState.chunk_paths || {}).flat();
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "workbook_changed" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  const chunkIndex = aggState.chunk_index || 0;
  const chunkPaths = aggState.chunk_paths || { original: [], duplicate: [], triplicate: [] };
  const offset = chunkIndex * CHUNK_SIZE;

  const { data: chunkBills, error: chunkErr } = await admin.from("bills").select("*").eq("bill_upload_id", uploadId).eq("status", "finalized").order("sheet_order", { ascending: true }).order("id", { ascending: true }).range(offset, offset + CHUNK_SIZE - 1);
  if (chunkErr) {
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "chunk_unreadable" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }
  const billRows = (chunkBills ?? []) as Record<string, unknown>[];

  if (billRows.length === 0) {
    aggState.stage = "merge";
    const stateJson = JSON.stringify(aggState);
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ cursor: stateJson, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: stateJson, more: true, counters });
  }
  if (billRows.some((r) => r.sheet_order === null || r.sheet_order === undefined)) {
    const uploaded = Object.values(aggState.chunk_paths || {}).flat();
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "order_not_recoverable" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  const snapshots = billRows.map((r) => r.business_profile_snapshot);
  const nonNull = snapshots.filter((s) => s !== null && s !== undefined);
  if (aggState.chosen_snapshot === undefined) {
    if (nonNull.length === 0) aggState.chosen_snapshot = null;
    else if (nonNull.length === billRows.length && nonNull.every((s) => JSON.stringify(s) === JSON.stringify(nonNull[0]))) aggState.chosen_snapshot = nonNull[0];

    else {
      const uploaded = Object.values(aggState.chunk_paths || {}).flat();
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      counters.aggregates_processed += 1;
      counters.aggregates_failed += 1;
      const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
      if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextStatus = nextId ? "running" : "completed";
      const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
      return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "inconsistent_profile_snapshot" }], next_cursor: nextCursor, more: nextId !== null, counters });
    }
  } else {
    if (aggState.chosen_snapshot === null) {
      if (nonNull.length > 0) {
        const uploaded = Object.values(aggState.chunk_paths || {}).flat();
        if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
        counters.aggregates_processed += 1;
        counters.aggregates_failed += 1;
        const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
        if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
        const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
        const nextCursor = nextId ? nextId : null;
        const nextStatus = nextId ? "running" : "completed";
        const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
        if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
        return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "inconsistent_profile_snapshot" }], next_cursor: nextCursor, more: nextId !== null, counters });
      }
    } else {
      if (nonNull.length > 0 && !nonNull.every((s) => JSON.stringify(s) === JSON.stringify(aggState.chosen_snapshot))) {
        const uploaded = Object.values(aggState.chunk_paths || {}).flat();
        if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
        counters.aggregates_processed += 1;
        counters.aggregates_failed += 1;
        const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
        if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
        const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
        const nextCursor = nextId ? nextId : null;
        const nextStatus = nextId ? "running" : "completed";
        const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
        if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
        return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "inconsistent_profile_snapshot" }], next_cursor: nextCursor, more: nextId !== null, counters });
      }
    }
  }

  const billProfile = profileForBill(currentProfile, aggState.chosen_snapshot === undefined ? null : aggState.chosen_snapshot);
  const effectiveProfile = aggState.profile ? (aggState.profile as BusinessProfile) : billProfile.profile;
  if (!aggState.profile) {
    aggState.profile = effectiveProfile;
    aggState.snapshot = billProfile.snapshot;
  }

  const ids = billRows.map((r) => r.id as string);
  const { data: itemRows, error: itemErr } = await admin.from("bill_line_items").select("bill_id, sr_no, description, hsn_code, uom, quantity, rate, amount").in("bill_id", ids).order("sr_no", { ascending: true });
  if (itemErr) {
    const uploaded = Object.values(aggState.chunk_paths || {}).flat();
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "line_items_unreadable" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }
  const itemsByBill = new Map<string, BillLineItem[]>();
  for (const raw of (itemRows ?? []) as Record<string, unknown>[]) {
    const list = itemsByBill.get(raw.bill_id as string) ?? [];
    list.push({
      srNo: raw.sr_no === null ? null : Number(raw.sr_no),
      description: (raw.description as string | null) ?? "",
      hsnCode: (raw.hsn_code as string | null) ?? null,
      uom: (raw.uom as string | null) ?? null,
      quantity: raw.quantity === null ? null : Number(raw.quantity),
      rate: raw.rate === null ? null : Number(raw.rate),
      amount: raw.amount === null ? null : Number(raw.amount),
    });
    itemsByBill.set(raw.bill_id as string, list);
  }

  if (aggState.stage !== "merge") {
    const start = aggState.chunk_index * CHUNK_SIZE;
    const chunkBills = billRows;
    const stamp = Date.now();
    const chunkPathsNew = { original: [...(aggState.chunk_paths?.original || [])], duplicate: [...(aggState.chunk_paths?.duplicate || [])], triplicate: [...(aggState.chunk_paths?.triplicate || [])] };
    const uploadedThis: string[] = [];
    let ok = true;
    for (const kind of COPY_ORDER) {
      try {
        const bytes = renderBillDocument(
          chunkBills.map((r) => billFromRecord({ ...(r as unknown as BillRecord), copy: kind }, itemsByBill.get(r.id as string) ?? [], COPY_LABEL[kind])),
          COPY_LABEL[kind],
          null,
          effectiveProfile
        );
        const p = `${uploadId}/agg_${stamp}_chunk${aggState.chunk_index}_${kind}.pdf`;
        const { error: upErr } = await admin.storage.from(BUCKET).upload(p, bytes, { contentType: "application/pdf", upsert: true });
        if (upErr) { ok = false; break; }
        chunkPathsNew[kind].push(p);
        uploadedThis.push(p);
      } catch (err) {
        console.error("regenerate aggregate chunk render failed", uploadId, kind, err);
        ok = false;
        break;
      }
    }
    if (!ok) {
      if (uploadedThis.length > 0) await admin.storage.from(BUCKET).remove(uploadedThis);
      const stateJson = JSON.stringify({ upload_id: uploadId, stage: "render", chunk_index: aggState.chunk_index, total_bills: aggState.total_bills || totalBills, chunk_paths: aggState.chunk_paths || { original: [], duplicate: [], triplicate: [] }, chosen_snapshot: aggState.chosen_snapshot, profile: aggState.profile ?? effectiveProfile, snapshot: aggState.snapshot ?? billProfile.snapshot });
      const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ cursor: stateJson, updated_at: new Date().toISOString() }).eq("id", jobId);
      if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
      return json({ ok: false, job_id: jobId, phase: "aggregates", processed: 0, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "chunk_render_failed" }], next_cursor: stateJson, more: false, counters, error: "Aggregate chunk rendering failed" }, 500);
    }

    const nextIndex = aggState.chunk_index + 1;
    const moreChunks = nextIndex * CHUNK_SIZE < totalBills;
    const stateJson = JSON.stringify({ upload_id: uploadId, stage: moreChunks ? "render" : "merge", chunk_index: nextIndex, total_bills: totalBills, chunk_paths: chunkPathsNew, chosen_snapshot: aggState.chosen_snapshot, profile: aggState.profile ?? effectiveProfile, snapshot: aggState.snapshot ?? billProfile.snapshot });
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ cursor: stateJson, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: stateJson, more: true, counters });
  }

  }
  const mergeChunkPaths = aggState.chunk_paths || { original: [], duplicate: [], triplicate: [] };
  const stamp = Date.now();
  const baseName = (uploadRow as any).base_name ?? "workbook";
  const finalPaths = {
    original: `${uploadId}/${baseName}_v${stamp}_original.pdf`,
    duplicate: `${uploadId}/${baseName}_v${stamp}_duplicate.pdf`,
    triplicate: `${uploadId}/${baseName}_v${stamp}_triplicate.pdf`,
  };

  let pdfLib: any;
  try {
    // @ts-ignore
    pdfLib = await import("https://esm.sh/pdf-lib@1.17.1");
  } catch (err) {
    console.error("pdf-lib import failed", err);
    pdfLib = null;
  }

  const uploadedFinal: string[] = [];
  let ok = true;
  if (!pdfLib) {
    ok = false;
  } else {
    for (const kind of COPY_ORDER) {
      try {
        const merged = await pdfLib.PDFDocument.create();
        for (const partPath of mergeChunkPaths[kind]) {
          const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(partPath);
          if (dlErr || !blob) { ok = false; break; }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const partDoc = await pdfLib.PDFDocument.load(bytes);
          const pages = await merged.copyPages(partDoc, partDoc.getPageIndices());
          pages.forEach((pg: any) => merged.addPage(pg));
        }
        const mergedBytes = await merged.save();
        const { error: upErr } = await admin.storage.from(BUCKET).upload(finalPaths[kind], mergedBytes, { contentType: "application/pdf", upsert: true });
        if (upErr) { ok = false; break; }
        uploadedFinal.push(finalPaths[kind]);
      } catch (err) {
        console.error("merge failed", uploadId, kind, err);
        ok = false;
        break;
      }
    }
  }

  if (!ok) {
    if (uploadedFinal.length > 0) await admin.storage.from(BUCKET).remove(uploadedFinal);
    counters.aggregates_processed += 0;
    counters.aggregates_failed += 1;
    const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: false, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "merge_failed" }], next_cursor: nextCursor, more: nextId !== null, counters, error: "Aggregate merge failed" }, 500);
  }

  const { error: upRowErr } = await admin.from("bill_uploads").update({
    original_pdf_path: finalPaths.original,
    duplicate_pdf_path: finalPaths.duplicate,
    triplicate_pdf_path: finalPaths.triplicate,
  }).eq("id", uploadId);
  if (upRowErr) {
    await admin.storage.from(BUCKET).remove(Object.values(finalPaths));
    counters.aggregates_processed += 0;
    counters.aggregates_failed += 1;
    const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: (upRowErr as { message: string }).message }], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  const allChunks = Object.values(mergeChunkPaths).flat();
  if (allChunks.length > 0) {
    const { error } = await admin.storage.from(BUCKET).remove(allChunks);
    if (error) console.warn("regenerate: chunk cleanup failed", error.message);
  }
  const oldAgg = [(uploadRow as any).original_pdf_path, (uploadRow as any).duplicate_pdf_path, (uploadRow as any).triplicate_pdf_path].filter(
    (p): p is string => typeof p === "string" && p !== "" && !Object.values(finalPaths).includes(p)
  );
  if (oldAgg.length > 0) {
    const { error } = await admin.storage.from(BUCKET).remove(oldAgg);
    if (error) console.warn("regenerate: old aggregate cleanup failed", error.message);
  }

  counters.aggregates_processed += 1;
  counters.aggregates_succeeded += 1;

  const { data: nextRows, error: nextErr } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
  if (nextErr) return json({ ok: false, error: nextErr.message }, 500);
  const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
  const nextCursor = nextId ? nextId : null;
  const nextStatus = nextId ? "running" : "completed";
  const { error: _cpErr } = await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_succeeded: counters.aggregates_succeeded, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
  if (_cpErr) return json({ ok: false, error: _cpErr.message }, 500);

  return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 1, failed: 0, failures: [], next_cursor: nextCursor, more: nextId !== null, counters });
});
