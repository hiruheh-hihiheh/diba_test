import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import { safeBillToken, COPY_LABEL, COPY_ORDER, type BillLineItem } from "../process-bill-upload/_shared/parseBill.ts";
import { loadInvoiceLogoImage } from "../process-bill-upload/_shared/invoiceLogo.ts";
import { loadActiveBusinessProfile } from "../process-bill-upload/_shared/businessProfileDb.ts";
import { profileForBill, type BusinessProfile } from "../process-bill-upload/_shared/businessProfile.ts";

const BUCKET = "bills";
const MAX_PER_CALL = 25;

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

type Failure = { bill_id?: string; upload_id?: string; invoice_no?: string | null; reason: string };

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function reprintBill(
  admin: Client,
  row: Record<string, unknown>,
  items: BillLineItem[],
  currentProfile: BusinessProfile
): Promise<{ ok: true; removed: number } | { ok: false; reason: string }> {
  const billId = row.id as string;
  const nextVersion = (Number(row.pdf_version) || 1) + 1;
  const token = safeBillToken((row.invoice_no as string | null) ?? null, row.sheet_name as string);
  const base = `${row.bill_upload_id as string}/${billId}_${token}_v${nextVersion}`;
  const newPaths = {
    original: `${base}_original.pdf`,
    duplicate: `${base}_duplicate.pdf`,
    triplicate: `${base}_triplicate.pdf`,
  };

  const billProfile = profileForBill(currentProfile, row.business_profile_snapshot);

  let logo = null;
  const logoId = (row.logo_id as string | null) ?? null;
  if (logoId) {
    logo = await loadInvoiceLogoImage(admin, logoId);
    if (!logo) return { ok: false, reason: "logo_unreadable" };
  }

  const rendered: Record<string, Uint8Array> = {};
  try {
    for (const copy of COPY_ORDER) {
      const model = billFromRecord({ ...(row as unknown as BillRecord), copy }, items, COPY_LABEL[copy]);
      rendered[copy] = renderBillDocument([model], COPY_LABEL[copy], logo, billProfile.profile);
    }
  } catch (err) {
    console.error("regenerate: render failed", billId, err);
    return { ok: false, reason: "pdf_failed" };
  }

  const uploaded: string[] = [];
  for (const copy of COPY_ORDER) {
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(newPaths[copy], rendered[copy], { contentType: "application/pdf", upsert: false });
    if (error) {
      console.error("regenerate: upload failed", newPaths[copy], error.message);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      return { ok: false, reason: "storage_failed" };
    }
    uploaded.push(newPaths[copy]);
  }

  const { error: repointError } = await admin
    .from("bills")
    .update({
      original_pdf_path: newPaths.original,
      duplicate_pdf_path: newPaths.duplicate,
      triplicate_pdf_path: newPaths.triplicate,
      pdf_version: nextVersion,
      logo_rendered_logo_id: logoId,
      business_profile_snapshot: billProfile.snapshot,
    })
    .eq("id", billId);

  if (repointError) {
    console.error("regenerate: repoint failed", billId, repointError.message);
    await admin.storage.from(BUCKET).remove(uploaded);
    return { ok: false, reason: "save_failed" };
  }

  const superseded = [row.original_pdf_path, row.duplicate_pdf_path, row.triplicate_pdf_path].filter(
    (p): p is string => typeof p === "string" && p !== "" && !uploaded.includes(p)
  );
  if (superseded.length > 0) {
    const { error } = await admin.storage.from(BUCKET).remove(superseded);
    if (error) console.warn("regenerate: cleanup failed", error.message, superseded);
  }

  return { ok: true, removed: superseded.length };
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

  let body: { job_id?: string; phase?: string; cursor?: string | null; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedLimit = Number(body.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_PER_CALL)
    : MAX_PER_CALL;

  // Resume or create a durable job.
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
  const cursor = (job.cursor as string | null) ?? null;

  let currentProfile: BusinessProfile;
  try {
    currentProfile = await loadActiveBusinessProfile(admin);
  } catch (err) {
    console.error("regenerate: profile load failed", err);
    await admin.from("bill_pdf_regeneration_jobs").update({ status: "failed", last_error: "profile_unreadable" }).eq("id", jobId);
    return json({ ok: false, error: "Business profile could not be loaded." }, 500);
  }

  const counters = {
    bills_processed: Number(job.bills_processed ?? 0),
    bills_succeeded: Number(job.bills_succeeded ?? 0),
    bills_failed: Number(job.bills_failed ?? 0),
    aggregates_processed: Number(job.aggregates_processed ?? 0),
    aggregates_succeeded: Number(job.aggregates_succeeded ?? 0),
    aggregates_failed: Number(job.aggregates_failed ?? 0),
  };

  if (phase === "bills") {
    let q = admin.from("bills").select("*").eq("status", "finalized").order("id", { ascending: true }).limit(limit);
    if (cursor) q = q.gt("id", cursor);
    const { data: rows, error } = await q;
    if (error) {
      await admin.from("bill_pdf_regeneration_jobs").update({ last_error: error.message }).eq("id", jobId);
      return json({ ok: false, error: error.message }, 500);
    }
    const billRows = (rows ?? []) as Record<string, unknown>[];
    if (billRows.length === 0) {
      // Advance to aggregates.
      await admin.from("bill_pdf_regeneration_jobs").update({ phase: "aggregates", cursor: null }).eq("id", jobId);
      return json({
        ok: true,
        job_id: jobId,
        phase: "bills",
        processed: 0,
        succeeded: 0,
        failed: 0,
        failures: [],
        next_cursor: null,
        more: true,
        counters,
      });
    }

    const ids = billRows.map((r) => r.id as string);
    const { data: itemRows, error: itemError } = await admin
      .from("bill_line_items")
      .select("bill_id, sr_no, description, hsn_code, uom, quantity, rate, amount")
      .in("bill_id", ids)
      .order("sr_no", { ascending: true });
    if (itemError) {
      await admin.from("bill_pdf_regeneration_jobs").update({ last_error: itemError.message }).eq("id", jobId);
      return json({ ok: false, error: itemError.message }, 500);
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

    let succeeded = 0;
    const failures: Failure[] = [];
    for (const row of billRows) {
      const result = await reprintBill(admin, row, itemsByBill.get(row.id as string) ?? [], currentProfile);
      if (result.ok) succeeded++;
      else failures.push({ bill_id: row.id as string, invoice_no: (row.invoice_no as string | null) ?? null, reason: result.reason });
    }

    const nextCursor = billRows[billRows.length - 1].id as string;
    const more = billRows.length === limit;

    counters.bills_processed += billRows.length;
    counters.bills_succeeded += succeeded;
    counters.bills_failed += failures.length;

    const newPhase = more ? "bills" : "aggregates";
    const newCursor = more ? nextCursor : null;
    await admin.from("bill_pdf_regeneration_jobs").update({
      phase: newPhase,
      cursor: newCursor,
      bills_processed: counters.bills_processed,
      bills_succeeded: counters.bills_succeeded,
      bills_failed: counters.bills_failed,
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    try {
      await admin.from("admin_audit_log").insert({
        actor_id: user.id,
        actor_username: user.user_metadata?.username ?? null,
        action: "bill.pdfs_regenerated",
        target_type: "bill_batch",
        target_id: jobId,
        detail: { phase: "bills", processed: billRows.length, succeeded, failed: failures.length, cursor: nextCursor },
      });
    } catch (e) {
      console.warn("audit skipped", e);
    }

    return json({
      ok: true,
      job_id: jobId,
      phase: "bills",
      processed: billRows.length,
      succeeded,
      failed: failures.length,
      failures,
      next_cursor: newCursor,
      more: true,
      counters,
    });
  }

  // aggregates phase
  let uq = admin.from("bill_uploads").select("id, base_name, original_pdf_path, duplicate_pdf_path, triplicate_pdf_path, creation_source").eq("creation_source", "workbook").order("id", { ascending: true }).limit(limit);
  if (cursor) uq = uq.gt("id", cursor);
  const { data: uploads, error: upErr } = await uq;
  if (upErr) {
    await admin.from("bill_pdf_regeneration_jobs").update({ last_error: upErr.message }).eq("id", jobId);
    return json({ ok: false, error: upErr.message }, 500);
  }
  const uploadRows = (uploads ?? []) as Record<string, unknown>[];
  if (uploadRows.length === 0) {
    await admin.from("bill_pdf_regeneration_jobs").update({ status: "completed", phase: "aggregates", cursor: null, updated_at: new Date().toISOString() }).eq("id", jobId);
    return json({
      ok: true,
      job_id: jobId,
      phase: "aggregates",
      processed: 0,
      succeeded: 0,
      failed: 0,
      failures: [],
      next_cursor: null,
      more: false,
      counters,
    });
  }

  let succeeded = 0;
  const failures: Failure[] = [];
  const cleanupWarnings: string[] = [];
  const aggregateResults: { upload_id: string; profile_source: "snapshot" | "current_profile" }[] = [];
  for (const upload of uploadRows) {
    const uploadId = upload.id as string;
    const { data: bills, error: bErr } = await admin
      .from("bills")
      .select("*")
      .eq("bill_upload_id", uploadId)
      .eq("status", "finalized")
      .order("sheet_order", { ascending: true })
      .order("id", { ascending: true });
    if (bErr || !bills || bills.length === 0) {
      failures.push({ upload_id: uploadId, reason: bErr?.message ?? "no_finalized_bills" });
      continue;
    }
    const billRows = bills as Record<string, unknown>[];

    // Verify all sheet_order present; otherwise cannot preserve order.
    if (billRows.some((r) => r.sheet_order === null || r.sheet_order === undefined)) {
      failures.push({ upload_id: uploadId, reason: "order_not_recoverable" });
      continue;
    }

    // Verify snapshots consistent.
    const snapshots = billRows.map((r) => r.business_profile_snapshot);
    const nonNull = snapshots.filter((s) => s !== null && s !== undefined);
    let chosenSnapshot: unknown = null;
    if (nonNull.length === 0) {
      chosenSnapshot = null; // use current profile
    } else if (nonNull.length === snapshots.length && nonNull.every((s) => deepEqual(s, nonNull[0]))) {
      chosenSnapshot = nonNull[0];
    } else if (nonNull.every((s) => deepEqual(s, nonNull[0])) && nonNull.length > 0) {
      // Mixed null/non-null is inconsistent.
      failures.push({ upload_id: uploadId, reason: "inconsistent_profile_snapshot" });
      continue;
    } else {
      failures.push({ upload_id: uploadId, reason: "inconsistent_profile_snapshot" });
      continue;
    }

    const billProfile = profileForBill(currentProfile, chosenSnapshot);
    const effectiveProfile = billProfile.profile;

    const ids = billRows.map((r) => r.id as string);
    const { data: itemRows, error: iErr } = await admin
      .from("bill_line_items")
      .select("bill_id, sr_no, description, hsn_code, uom, quantity, rate, amount")
      .in("bill_id", ids)
      .order("sr_no", { ascending: true });
    if (iErr) {
      failures.push({ upload_id: uploadId, reason: iErr.message });
      continue;
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
    const baseName = (upload.base_name as string) ?? "workbook";
    const aggPaths = {
      original: `${uploadId}/${baseName}_v${stamp}_original.pdf`,
      duplicate: `${uploadId}/${baseName}_v${stamp}_duplicate.pdf`,
      triplicate: `${uploadId}/${baseName}_v${stamp}_triplicate.pdf`,
    };

    const uploaded: string[] = [];
    let ok = true;
    for (const kind of COPY_ORDER) {
      try {
        const bytes = renderBillDocument(
          billRows.map((r) => billFromRecord({ ...(r as unknown as BillRecord), copy: kind }, itemsByBill.get(r.id as string) ?? [], COPY_LABEL[kind])),
          COPY_LABEL[kind],
          null,
          effectiveProfile
        );
        const { error: upError } = await admin.storage.from(BUCKET).upload(aggPaths[kind], bytes, { contentType: "application/pdf", upsert: false });
        if (upError) {
          console.error("regenerate aggregate upload failed", aggPaths[kind], upError.message);
          ok = false;
          break;
        }
        uploaded.push(aggPaths[kind]);
      } catch (err) {
        console.error("regenerate aggregate render failed", uploadId, kind, err);
        ok = false;
        break;
      }
    }

    if (!ok) {
      if (uploaded.length > 0) {
        const { error: rmErr } = await admin.storage.from(BUCKET).remove(uploaded);
        if (rmErr) cleanupWarnings.push(`cleanup_failed:${uploadId}:${rmErr.message}`);
      }
      failures.push({ upload_id: uploadId, reason: "render_or_upload_failed" });
      continue;
    }

    const { error: upRowErr } = await admin.from("bill_uploads").update({
      original_pdf_path: aggPaths.original,
      duplicate_pdf_path: aggPaths.duplicate,
      triplicate_pdf_path: aggPaths.triplicate,
    }).eq("id", uploadId);

    if (upRowErr) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(uploaded);
      if (rmErr) cleanupWarnings.push(`cleanup_failed:${uploadId}:${rmErr.message}`);
      failures.push({ upload_id: uploadId, reason: upRowErr.message });
      continue;
    }

    const oldAgg = [upload.original_pdf_path, upload.duplicate_pdf_path, upload.triplicate_pdf_path].filter(
      (p): p is string => typeof p === "string" && p !== "" && !Object.values(aggPaths).includes(p)
    );
    if (oldAgg.length > 0) {
      const { error: rmErr } = await admin.storage.from(BUCKET).remove(oldAgg);
      if (rmErr) cleanupWarnings.push(`old_cleanup_failed:${uploadId}:${rmErr.message}`);
    }

    // Update snapshot? Not stored on upload; skip.
    aggregateResults.push({ upload_id: uploadId, profile_source: chosenSnapshot === null ? "current_profile" : "snapshot" });
    succeeded++;
  }

  const nextCursor = uploadRows[uploadRows.length - 1].id as string;
  const more = uploadRows.length === limit;

  counters.aggregates_processed += uploadRows.length;
  counters.aggregates_succeeded += succeeded;
  counters.aggregates_failed += failures.length;

  const newPhase = more ? "aggregates" : "aggregates";
  const newCursor = more ? nextCursor : null;
  const newStatus = more ? "running" : "completed";
  await admin.from("bill_pdf_regeneration_jobs").update({
    phase: "aggregates",
    cursor: newCursor,
    aggregates_processed: counters.aggregates_processed,
    aggregates_succeeded: counters.aggregates_succeeded,
    aggregates_failed: counters.aggregates_failed,
    status: newStatus,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);

  try {
    await admin.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_username: user.user_metadata?.username ?? null,
      action: "bill.pdfs_regenerated",
      target_type: "upload_batch",
      target_id: jobId,
      detail: { phase: "aggregates", processed: uploadRows.length, succeeded, failed: failures.length, cleanupWarnings },
    });
  } catch (e) {
    console.warn("audit skipped", e);
  }

  return json({
    ok: true,
    job_id: jobId,
    phase: "aggregates",
    processed: uploadRows.length,
    succeeded,
    failed: failures.length,
    failures,
    cleanup_warnings: cleanupWarnings,
    aggregate_results: aggregateResults,
    next_cursor: newCursor,
    more,
    counters,
  });
});