import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import { safeBillToken, COPY_LABEL, COPY_ORDER, type BillLineItem } from "../process-bill-upload/_shared/parseBill.ts";
import { loadInvoiceLogoImage } from "../process-bill-upload/_shared/invoiceLogo.ts";
import { loadActiveBusinessProfile } from "../process-bill-upload/_shared/businessProfileDb.ts";
import { profileForBill, profileFromRow, type BusinessProfile } from "../process-bill-upload/_shared/businessProfile.ts";

const BUCKET = "bills";

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

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
  const { data: profile } = await admin.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
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
    const { data } = await admin.from("bill_pdf_regeneration_jobs").select("*").eq("id", body.job_id).maybeSingle();
    job = (data as Record<string, unknown> | null) ?? null;
    if (!job || job.status !== "running") {
      return json({ ok: false, error: "That regeneration job is not active." }, 409);
    }
  } else {
    const { data: running } = await admin.from("bill_pdf_regeneration_jobs").select("*").eq("status", "running").maybeSingle();
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

  if (phase === "bills") {
    let state: { bill_id: string; copy: string; completed: Record<string, string>; profile?: BusinessProfile; snapshot?: unknown } | null = null;
    let billRow: Record<string, unknown> | null = null;

    if (cursorRaw && cursorRaw.startsWith("{")) {
      try {
        state = JSON.parse(cursorRaw);
      } catch {
        state = null;
      }
      if (state) {
        const { data } = await admin.from("bills").select("*").eq("id", state.bill_id).maybeSingle();
        billRow = (data as Record<string, unknown> | null) ?? null;
      }
    }

    if (!billRow) {
      // find next finalized bill
      let q = admin.from("bills").select("*").eq("status", "finalized").order("id", { ascending: true }).limit(1);
      if (cursorRaw && !cursorRaw.startsWith("{")) q = q.gt("id", cursorRaw);
      const { data, error: billsErr } = await q;
      if (billsErr) {
        await admin.from("bill_pdf_regeneration_jobs").update({ last_error: billsErr.message, updated_at: new Date().toISOString() }).eq("id", jobId);
        return json({ ok: false, error: billsErr.message }, 500);
      }
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) {
        // move to aggregates
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

    const copy = state!.copy as "original" | "duplicate" | "triplicate";
    const completed = state!.completed || {};
    const billId = billRow.id as string;
    const nextVersion = (Number(billRow.pdf_version) || 1) + 1;
    const token = safeBillToken((billRow.invoice_no as string | null) ?? null, billRow.sheet_name as string);
    const path = `${billRow.bill_upload_id as string}/${billId}_${token}_v${nextVersion}_${copy}.pdf`;

    // render one copy
    let logo = null;
    const logoId = (billRow.logo_id as string | null) ?? null;
    if (logoId) {
      logo = await loadInvoiceLogoImage(admin, logoId);
      if (!logo) {
        // fail bill, advance
        counters.bills_processed += 1;
        counters.bills_failed += 1;
        // remove any completed copies
        const uploaded = Object.values(completed);
        if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
        // advance
        const { data: nextRows } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
        const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
        const nextPhase = nextId ? "bills" : "aggregates";
        const nextCursor = nextId ? nextId : null;
        await admin.from("bill_pdf_regeneration_jobs").update({
          phase: nextPhase,
          cursor: nextCursor,
          bills_processed: counters.bills_processed,
          bills_failed: counters.bills_failed,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "logo_unreadable" }], next_cursor: nextCursor, more: true, counters });
      }
    }

    // load items
    const { data: itemRows, error: itemErr } = await admin.from("bill_line_items").select("sr_no, description, hsn_code, uom, quantity, rate, amount").eq("bill_id", billId).order("sr_no", { ascending: true });
    if (itemErr) {
      // fail bill
      counters.bills_processed += 1;
      counters.bills_failed += 1;
      const uploaded = Object.values(completed);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      const { data: nextRows } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextPhase = nextId ? "bills" : "aggregates";
      await admin.from("bill_pdf_regeneration_jobs").update({ phase: nextPhase, cursor: nextCursor, bills_processed: counters.bills_processed, bills_failed: counters.bills_failed, updated_at: new Date().toISOString() }).eq("id", jobId);
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

    let billProfile: { profile: BusinessProfile; snapshot: unknown };
    if (state && state.profile) {
      billProfile = { profile: state.profile, snapshot: state.snapshot };
    } else {
      billProfile = profileForBill(currentProfile, billRow.business_profile_snapshot);
      if (state) {
        state.profile = billProfile.profile;
        state.snapshot = billProfile.snapshot;
      }
    }

    let rendered: Uint8Array;
    try {
      const model = billFromRecord({ ...(billRow as unknown as BillRecord), copy: copy as "original" | "duplicate" | "triplicate" }, items, COPY_LABEL[copy as "original" | "duplicate" | "triplicate"]);
      rendered = renderBillDocument([model], COPY_LABEL[copy as "original" | "duplicate" | "triplicate"], logo, billProfile.profile);
    } catch (err) {
      console.error("regenerate: render failed", billId, copy, err);
      const uploaded = Object.values(completed);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      counters.bills_processed += 1;
      counters.bills_failed += 1;
      const { data: nextRows } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextPhase = nextId ? "bills" : "aggregates";
      await admin.from("bill_pdf_regeneration_jobs").update({
        phase: nextPhase,
        cursor: nextCursor,
        bills_processed: counters.bills_processed,
        bills_failed: counters.bills_failed,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "pdf_failed" }], next_cursor: nextCursor, more: true, counters });
    }

    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, rendered, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error("regenerate: upload failed", path, upErr.message);
      const uploaded = Object.values(completed);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      counters.bills_processed += 1;
      counters.bills_failed += 1;
      const { data: nextRows } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextPhase = nextId ? "bills" : "aggregates";
      await admin.from("bill_pdf_regeneration_jobs").update({
        phase: nextPhase,
        cursor: nextCursor,
        bills_processed: counters.bills_processed,
        bills_failed: counters.bills_failed,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "storage_failed" }], next_cursor: nextCursor, more: true, counters });
    }

    completed[copy] = path;

    // determine if all done
    const allDone = completed.original && completed.duplicate && completed.triplicate;
    if (allDone) {
      // repoint
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
        const { data: nextRows } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
        const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
        const nextCursor = nextId ? nextId : null;
        const nextPhase = nextId ? "bills" : "aggregates";
        await admin.from("bill_pdf_regeneration_jobs").update({
          phase: nextPhase,
          cursor: nextCursor,
          bills_processed: counters.bills_processed,
          bills_failed: counters.bills_failed,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 0, failed: 1, failures: [{ bill_id: billId, invoice_no: (billRow.invoice_no as string | null) ?? null, reason: "save_failed" }], next_cursor: nextCursor, more: true, counters });
      }
      // cleanup superseded
      const superseded = [billRow.original_pdf_path, billRow.duplicate_pdf_path, billRow.triplicate_pdf_path].filter(
        (p): p is string => typeof p === "string" && p !== "" && !Object.values(completed).includes(p)
      );
      if (superseded.length > 0) {
        const { error } = await admin.storage.from(BUCKET).remove(superseded);
        if (error) console.warn("regenerate: cleanup failed", error.message, superseded);
      }

      counters.bills_processed += 1;
      counters.bills_succeeded += 1;

      const { data: nextRows } = await admin.from("bills").select("id").eq("status", "finalized").gt("id", billId).order("id", { ascending: true }).limit(1);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextPhase = nextId ? "bills" : "aggregates";
      await admin.from("bill_pdf_regeneration_jobs").update({
        phase: nextPhase,
        cursor: nextCursor,
        bills_processed: counters.bills_processed,
        bills_succeeded: counters.bills_succeeded,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);

      return json({ ok: true, job_id: jobId, phase: "bills", processed: 1, succeeded: 1, failed: 0, failures: [], next_cursor: nextCursor, more: true, counters });
    }

    // not all done: save state
    const nextCopy = copy === "original" ? "duplicate" : copy === "duplicate" ? "triplicate" : "triplicate";
    const stateJson = JSON.stringify({ bill_id: billId, copy: nextCopy, completed, profile: state?.profile ?? billProfile.profile, snapshot: state?.snapshot ?? billProfile.snapshot });
    await admin.from("bill_pdf_regeneration_jobs").update({
      cursor: stateJson,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    return json({ ok: true, job_id: jobId, phase: "bills", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: stateJson, more: true, counters });
  }

  // aggregates phase
  let aggState: { upload_id: string; copy: string; completed: Record<string, string>; profile?: BusinessProfile; snapshot?: unknown } | null = null;
  let uploadRow: Record<string, unknown> | null = null;

  if (cursorRaw && cursorRaw.startsWith("{")) {
    try {
      aggState = JSON.parse(cursorRaw);
    } catch {
      aggState = null;
    }
    if (aggState) {
      const { data } = await admin.from("bill_uploads").select("*").eq("id", aggState.upload_id).maybeSingle();
      uploadRow = (data as Record<string, unknown> | null) ?? null;
    }
  }

  if (!uploadRow) {
    let q = admin.from("bill_uploads").select("*").eq("creation_source", "workbook").order("id", { ascending: true }).limit(1);
    if (cursorRaw && !cursorRaw.startsWith("{")) q = q.gt("id", cursorRaw);
    const { data } = await q;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) {
      await admin.from("bill_pdf_regeneration_jobs").update({ status: "completed", phase: "aggregates", cursor: null, updated_at: new Date().toISOString() }).eq("id", jobId);
      return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: null, more: false, counters });
    }
    uploadRow = rows[0];
    aggState = { upload_id: uploadRow.id as string, copy: "original", completed: {} };
  }

  if (!uploadRow || !aggState) {
    await admin.from("bill_pdf_regeneration_jobs").update({ status: "completed", phase: "aggregates", cursor: null, updated_at: new Date().toISOString() }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: null, more: false, counters });
  }

  const uploadId = uploadRow.id as string;
  const copy = aggState.copy as "original" | "duplicate" | "triplicate";
  const completed = aggState.completed || {};

  const { data: bills, error: billsErr } = await admin.from("bills").select("*").eq("bill_upload_id", uploadId).eq("status", "finalized").order("sheet_order", { ascending: true }).order("id", { ascending: true });
  if (billsErr) {
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "bills_unreadable" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }
  const billRows = (bills ?? []) as Record<string, unknown>[];

  if (billRows.length > 10) {
    const uploaded = Object.values(completed);
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "aggregate_too_large_for_edge_function" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }
  if (billRows.length === 0 || billRows.some((r) => r.sheet_order === null || r.sheet_order === undefined)) {
    // fail upload, advance
    const uploaded = Object.values(completed);
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({
      phase: "aggregates",
      cursor: nextCursor,
      aggregates_processed: counters.aggregates_processed,
      aggregates_failed: counters.aggregates_failed,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: billRows.length === 0 ? "no_finalized_bills" : "order_not_recoverable" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  // snapshots
  const snapshots = billRows.map((r) => r.business_profile_snapshot);
  const nonNull = snapshots.filter((s) => s !== null && s !== undefined);
  let chosenSnapshot: unknown = null;
  if (nonNull.length === 0) {
    chosenSnapshot = null;
  } else if (nonNull.length === snapshots.length && nonNull.every((s) => deepEqual(s, nonNull[0]))) {
    chosenSnapshot = nonNull[0];
  } else if (nonNull.every((s) => deepEqual(s, nonNull[0]))) {
    // mixed null/non-null -> inconsistent
    const uploaded = Object.values(completed);
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({
      phase: "aggregates",
      cursor: nextCursor,
      aggregates_processed: counters.aggregates_processed,
      aggregates_failed: counters.aggregates_failed,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "inconsistent_profile_snapshot" }], next_cursor: nextCursor, more: nextId !== null, counters });
  } else {
    const uploaded = Object.values(completed);
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({
      phase: "aggregates",
      cursor: nextCursor,
      aggregates_processed: counters.aggregates_processed,
      aggregates_failed: counters.aggregates_failed,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "inconsistent_profile_snapshot" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  let aggBillProfile: { profile: BusinessProfile; snapshot: unknown };
  if (aggState && aggState.profile) {
    aggBillProfile = { profile: aggState.profile, snapshot: aggState.snapshot };
  } else {
    aggBillProfile = profileForBill(currentProfile, chosenSnapshot);
    if (aggState) {
      aggState.profile = aggBillProfile.profile;
      aggState.snapshot = aggBillProfile.snapshot;
    }
  }
  const effectiveProfile = aggBillProfile.profile;

  const ids = billRows.map((r) => r.id as string);
  const { data: itemRows, error: itemErr } = await admin.from("bill_line_items").select("bill_id, sr_no, description, hsn_code, uom, quantity, rate, amount").in("bill_id", ids).order("sr_no", { ascending: true });
  if (itemErr) {
    const uploaded = Object.values(completed);
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: nextCursor, aggregates_processed: counters.aggregates_processed, aggregates_failed: counters.aggregates_failed, status: nextStatus, updated_at: new Date().toISOString() }).eq("id", jobId);
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

  const stamp = Date.now();
  const baseName = (uploadRow.base_name as string) ?? "workbook";
  const aggPaths = {
    original: `${uploadId}/${baseName}_v${stamp}_original.pdf`,
    duplicate: `${uploadId}/${baseName}_v${stamp}_duplicate.pdf`,
    triplicate: `${uploadId}/${baseName}_v${stamp}_triplicate.pdf`,
  };

  let bytes: Uint8Array;
  try {
    bytes = renderBillDocument(
      billRows.map((r) => billFromRecord({ ...(r as unknown as BillRecord), copy: copy }, itemsByBill.get(r.id as string) ?? [], COPY_LABEL[copy])),
      COPY_LABEL[copy],
      null,
      effectiveProfile
    );
  } catch (err) {
    console.error("regenerate aggregate render failed", uploadId, copy, err);
    const uploaded = Object.values(completed);
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({
      phase: "aggregates",
      cursor: nextCursor,
      aggregates_processed: counters.aggregates_processed,
      aggregates_failed: counters.aggregates_failed,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "render_failed" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  const { error: upErr } = await admin.storage.from(BUCKET).upload(aggPaths[copy], bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) {
    console.error("regenerate aggregate upload failed", aggPaths[copy], upErr.message);
    const uploaded = Object.values(completed);
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    counters.aggregates_processed += 1;
    counters.aggregates_failed += 1;
    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({
      phase: "aggregates",
      cursor: nextCursor,
      aggregates_processed: counters.aggregates_processed,
      aggregates_failed: counters.aggregates_failed,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: "storage_failed" }], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  completed[copy] = aggPaths[copy];

  const allDone = completed.original && completed.duplicate && completed.triplicate;
  if (allDone) {
    const { error: upRowErr } = await admin.from("bill_uploads").update({
      original_pdf_path: completed.original,
      duplicate_pdf_path: completed.duplicate,
      triplicate_pdf_path: completed.triplicate,
    }).eq("id", uploadId);

    if (upRowErr) {
      const uploaded = Object.values(completed);
      await admin.storage.from(BUCKET).remove(uploaded);
      counters.aggregates_processed += 1;
      counters.aggregates_failed += 1;
      const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
      const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
      const nextCursor = nextId ? nextId : null;
      const nextStatus = nextId ? "running" : "completed";
      await admin.from("bill_pdf_regeneration_jobs").update({
        phase: "aggregates",
        cursor: nextCursor,
        aggregates_processed: counters.aggregates_processed,
        aggregates_failed: counters.aggregates_failed,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
      return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 0, failed: 1, failures: [{ upload_id: uploadId, reason: upRowErr.message }], next_cursor: nextCursor, more: nextId !== null, counters });
    }

    const oldAgg = [uploadRow.original_pdf_path, uploadRow.duplicate_pdf_path, uploadRow.triplicate_pdf_path].filter(
      (p): p is string => typeof p === "string" && p !== "" && !Object.values(completed).includes(p)
    );
    if (oldAgg.length > 0) {
      const { error } = await admin.storage.from(BUCKET).remove(oldAgg);
      if (error) console.warn("regenerate: aggregate cleanup failed", error.message);
    }

    counters.aggregates_processed += 1;
    counters.aggregates_succeeded += 1;

    const { data: nextRows } = await admin.from("bill_uploads").select("id").eq("creation_source", "workbook").gt("id", uploadId).order("id", { ascending: true }).limit(1);
    const nextId = nextRows && nextRows.length > 0 ? (nextRows[0] as Record<string, unknown>).id as string : null;
    const nextCursor = nextId ? nextId : null;
    const nextStatus = nextId ? "running" : "completed";
    await admin.from("bill_pdf_regeneration_jobs").update({
      phase: "aggregates",
      cursor: nextCursor,
      aggregates_processed: counters.aggregates_processed,
      aggregates_succeeded: counters.aggregates_succeeded,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 1, succeeded: 1, failed: 0, failures: [], next_cursor: nextCursor, more: nextId !== null, counters });
  }

  const nextCopy = copy === "original" ? "duplicate" : copy === "duplicate" ? "triplicate" : "triplicate";
  const stateJson = JSON.stringify({ upload_id: uploadId, copy: nextCopy, completed, profile: aggState?.profile ?? aggBillProfile.profile, snapshot: aggState?.snapshot ?? aggBillProfile.snapshot });
  await admin.from("bill_pdf_regeneration_jobs").update({
    cursor: stateJson,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);

  return json({ ok: true, job_id: jobId, phase: "aggregates", processed: 0, succeeded: 0, failed: 0, failures: [], next_cursor: stateJson, more: true, counters });
});