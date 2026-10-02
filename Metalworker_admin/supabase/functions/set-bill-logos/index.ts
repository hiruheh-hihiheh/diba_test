// supabase/functions/set-bill-logos/index.ts
//
// Assign or remove a logo across many bills, and keep the printed PDFs honest.
//
// WHY THIS EXISTS
// A logo lives on `bills.logo_id` and nowhere else — the invoice's own data is
// untouched by the assignment, and the printed document is regenerated from it.
// That regeneration is what this function is for: a PDF already written and
// uploaded to storage is a snapshot, and changing which logo a bill carries
// cannot retroactively change a file that has already been produced.
//
// THE TWO PHASES, AND WHY THEY ARE SPLIT
//
//   1. ASSIGN   one SQL statement, however many bills were selected. This is what
//               makes "select 400 bills and assign a logo" a single round trip
//               instead of 400, and it is why the assignment is instant no matter
//               how big the selection is. See `set_bill_logo` in migration 0011.
//
//   2. RE-PRINT a bounded batch of bills whose stored documents no longer match
//               their logo. Each bill costs three renders, three uploads and a
//               row update, so doing 400 of them inside the assignment would hold
//               the request open for minutes and time out.
//
// The split is why the response reports `more_work`. When it is true the client
// calls again with no bill ids to drain the next batch; because a bill leaves the
// queue the moment its documents are brought up to date, that is just the same
// call repeated, and an interrupted job resumes by being repeated rather than by
// keeping a cursor anywhere.
//
// WHY A FAILED RE-PRINT IS NOT A FAILED ASSIGNMENT
// The row is the truth and it has already been written correctly. If a document
// cannot be produced, the bill stays in the queue and is reported — it is not
// rolled back, because rolling it back would discard a correct assignment and
// leave the admin with a logo they successfully applied that has silently
// vanished. This is the opposite trade-off from `update-bill`, where the row and
// the document are one edit and disagreeing between them would be the bug.
//
// NOTHING ELSE IS TOUCHED
// Every statement is scoped by bill id or by logo id. No bill's financial data,
// no line item, and no other bill's documents are read or written. A bill that
// cannot be re-printed keeps the documents it had.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import { safeBillToken, COPY_LABEL, COPY_ORDER, type BillLineItem } from "../process-bill-upload/_shared/parseBill.ts";
// `PdfImage` is only a type; the decoding is done inside `loadInvoiceLogoImage`,
// which returns null rather than throwing when a logo cannot be read.
import type { PdfImage } from "../process-bill-upload/_shared/pdfImage.ts";
import { loadInvoiceLogoImage } from "../process-bill-upload/_shared/invoiceLogo.ts";

const BUCKET = "bills";

/**
 * Ceiling on bills re-printed per invocation.
 *
 * Each bill is three renders plus three uploads plus two row reads and a write,
 * so this is deliberately modest: it keeps one request comfortably inside a
 * function timeout even on slow hardware, and the client simply calls again. It
 * is a throughput knob, not a correctness limit — nothing is lost or skipped by
 * stopping at it, because the queue is resumable.
 */
const MAX_REPRINT_PER_CALL = 40;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * One bill as it is stored, plus the line items it needs to be re-printed.
 */
type ReprintTarget = {
  id: string;
  row: Record<string, unknown>;
  lineItems: BillLineItem[];
};

/** A bill the re-print could not produce documents for. */
type ReprintFailure = {
  bill_id: string;
  invoice_no: string | null;
  reason: string;
};

/**
 * Re-print one bill's three copies with a logo, if it has one.
 *
 * The ordering is `update-bill`'s, unchanged and for the same reasons: render all
 * three first, upload all three, and only then repoint the row — so a failure
 * part-way leaves the previous three documents in place and still reachable from
 * the row, rather than a row that points at a file that was never written.
 *
 * `logo` is null for a bill whose logo was just removed. That is not a special
 * case: it is an ordinary render with the logo argument omitted, which produces
 * exactly the document this system produced before logos existed.
 */
async function reprint(
  admin: Client,
  target: ReprintTarget,
  logo: PdfImage | null
): Promise<{ ok: true; removed: number } | { ok: false; reason: string }> {
  const row = target.row;
  const billId = target.id;
  const nextVersion = (Number(row.pdf_version) || 1) + 1;
  const token = safeBillToken(
    (row.invoice_no as string | undefined) ?? (row.invoice_no as string | null),
    row.sheet_name as string
  );
  const base = `${row.bill_upload_id as string}/${billId}_${token}_v${nextVersion}`;
  const newPaths: Record<string, string> = {
    original: `${base}_original.pdf`,
    duplicate: `${base}_duplicate.pdf`,
    triplicate: `${base}_triplicate.pdf`,
  };

  const rendered: Record<string, Uint8Array> = {};
  try {
    for (const copy of COPY_ORDER) {
      const model = billFromRecord(
        { ...(row as unknown as BillRecord), copy },
        target.lineItems,
        COPY_LABEL[copy]
      );
      rendered[copy] = renderBillDocument([model], COPY_LABEL[copy], logo);
    }
  } catch (err) {
    console.error("set-bill-logos: render failed:", billId, err);
    return { ok: false, reason: "pdf_failed" };
  }

  const uploaded: string[] = [];
  for (const copy of COPY_ORDER) {
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(newPaths[copy], rendered[copy], { contentType: "application/pdf", upsert: false });
    if (error) {
      console.error("set-bill-logos: upload failed:", newPaths[copy], error.message);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      return { ok: false, reason: "storage_failed" };
    }
    uploaded.push(newPaths[copy]);
  }

  /* The row now records both that these are the current documents AND which logo
     they were printed with. Writing `logo_rendered_logo_id` is what takes the bill
     out of the queue — and it has to be written in the same statement as the
     paths, because a row pointing at a new document while still claiming an old
     logo would re-print itself forever. */
  const { error: repointError } = await admin
    .from("bills")
    .update({
      original_pdf_path: newPaths.original,
      duplicate_pdf_path: newPaths.duplicate,
      triplicate_pdf_path: newPaths.triplicate,
      pdf_version: nextVersion,
      logo_rendered_logo_id: (row.logo_id as string | null) ?? null,
    })
    .eq("id", billId);
  if (repointError) {
    // The row still points at the previous three, which are still there, so the
    // only thing to clean up is what was just uploaded.
    console.error("set-bill-logos: repoint failed:", billId, repointError.message);
    await admin.storage.from(BUCKET).remove(uploaded);
    return { ok: false, reason: "save_failed" };
  }

  /* Only now are the previous objects unreferenced. Removing them is reported,
     never fatal: the row already points at the new ones, and a leftover object
     costs storage but cannot mislead anyone. */
  const superseded = [row.original_pdf_path, row.duplicate_pdf_path, row.triplicate_pdf_path].filter(
    (p): p is string => typeof p === "string" && p !== "" && !uploaded.includes(p)
  );
  if (superseded.length > 0) {
    const { error } = await admin.storage.from(BUCKET).remove(superseded);
    if (error) console.warn("set-bill-logos: previous PDFs not removed:", error.message, superseded);
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
    console.error("set-bill-logos: missing Supabase environment");
    return json({ ok: false, error: "The server is not configured correctly." }, 500);
  }

  /* Same gate as every other function here: the caller must be an authenticated
     user AND an active administrator. Checked before the body is read, so this
     cannot be used to probe whether a bill id or logo id exists. */
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Sign in again to continue." }, 401);

  /* TWO CLIENTS, AND THE DIFFERENCE IS THE WHOLE POINT OF B1
     `authClient` carries the CALLER's Authorization header, so PostgREST runs the
     request as `authenticated` with `auth.uid()` resolving to `user.id`. It is the
     only client that must be used for the two RPCs, because both are
     SECURITY DEFINER and both do their own authorization with
     `auth.uid()` — a service-role request carries no user `sub`, so `auth.uid()`
     is NULL there, the function's own admin check could never pass, and every
     call would be refused with 42501. Routing them through `admin` would have
     looked correct and denied every legitimate caller.

     The flow, end to end, is therefore:

         caller JWT → authClient → SECURITY DEFINER RPC → auth.uid() → admin check

     `admin` below is for privileged BACKEND work where the caller's identity is
     irrelevant or has already been verified: reading bills and line items,
     storage, rendering, repointing paths, cleanup, and the audit row. Those need
     the service role precisely because they must work regardless of RLS. */
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData?.user) {
    return json({ ok: false, error: "Sign in again to continue." }, 401);
  }
  const user = userData.user;

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || profile.is_active !== true) {
    return json({ ok: false, error: "Only an active administrator can assign a logo." }, 403);
  }

  /* ---- read the request ---------------------------------------------------- */
  let body: { bill_ids?: unknown; logo_id?: unknown; limit?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "The request could not be read." }, 400);
  }

  /* Two modes, and the difference matters:
       assign  — carry bill_ids and logo_id. Writes the assignment.
       drain   — carry neither. Only re-prints what is still outstanding.
     Calling drain with no outstanding work is a cheap no-op rather than an
     error, so a client can always make one more call without having to know
     whether the previous one finished the queue. */
  const wantsAssign = body.bill_ids !== undefined;
  let billIds: string[] = [];
  let logoId: string | null = null;

  if (wantsAssign) {
    if (!Array.isArray(body.bill_ids) || body.bill_ids.length === 0) {
      return json({ ok: false, error: "No bills were selected." }, 400);
    }
    /* De-duplicated so a selection that somehow repeats an id cannot make the
       response counts disagree with the number of bills it names. */
    billIds = [...new Set(body.bill_ids.filter((v): v is string => typeof v === "string"))];
    if (billIds.length === 0) return json({ ok: false, error: "No bills were selected." }, 400);
    if (billIds.some((id) => !UUID_RE.test(id))) {
      return json({ ok: false, error: "The selection contains an id that is not a bill." }, 400);
    }
    // A missing `logo_id` is a removal, but only an explicit null is allowed to
    // mean one — an omitted field is a malformed request, not an instruction to
    // strip the logo off every selected bill.
    if (body.logo_id === undefined) {
      return json({ ok: false, error: "No logo was chosen." }, 400);
    }
    if (body.logo_id !== null && (typeof body.logo_id !== "string" || !UUID_RE.test(body.logo_id))) {
      return json({ ok: false, error: "That logo could not be identified." }, 400);
    }
    logoId = (body.logo_id as string | null) ?? null;
  }

  const requestedLimit = Number(body.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_REPRINT_PER_CALL)
    : MAX_REPRINT_PER_CALL;

  /* ---- phase 1: assign, in one statement ---------------------------------- */
  let assigned = 0;
  let unchanged = 0;

  if (wantsAssign) {
    /* `authClient`, NOT `admin`. See the two-client note where it is created:
       `set_bill_logo` authorizes itself with `auth.uid()`, which is only the
       caller when the caller's own JWT is presented. This is the call that
       actually writes the assignment. */
    const { data: result, error } = await authClient.rpc("set_bill_logo", {
      p_bill_ids: billIds,
      p_logo_id: logoId,
    });
    if (error) {
      // The RPC raises a clear message for the two cases a client can act on,
      // and 42501/23503 come through as ordinary PostgREST errors.
      console.error("set-bill-logos: set_bill_logo failed:", error.message);
      const friendly =
        error.code === "42501"
          ? "Only an active administrator can assign a logo."
          : error.code === "23503"
          ? "That logo no longer exists."
          : "The logo could not be assigned.";
      return json({ ok: false, error: friendly, reason: error.code }, error.code === "42501" ? 403 : 400);
    }

    for (const row of (result ?? []) as { bill_id: string; changed: boolean }[]) {
      if (row.changed) assigned++;
      else unchanged++;
    }

    /* A requested bill that matched nothing is worth saying out loud. Silently
       dropping it would hide a stale list the admin had on screen, and would make
       "assigned to 24" quietly wrong. */
    const found = assigned + unchanged;
    if (found < billIds.length) {
      return json(
        {
          ok: false,
          error: `${billIds.length - found} of the selected bills no longer exist. Nothing was changed.`,
          missing: billIds.length - found,
        },
        409
      );
    }
  }

  /* ---- phase 2: re-print a bounded batch ---------------------------------- */

  /* `authClient`, NOT `admin`, for the same reason as the assign call above:
     `list_bills_needing_logo_render` filters its result set with the caller's own
     `auth.uid()`, so under the service role it would not refuse loudly — it would
     return zero rows, and every bill would silently stay out of date. */
  const { data: queue, error: queueError } = await authClient.rpc("list_bills_needing_logo_render", {
    p_limit: limit,
  });
  if (queueError) {
    console.error("set-bill-logos: work queue failed:", queueError.message, queueError.code);
    // The assignment has already succeeded, so this is reported as a warning
    // rather than a failure: the bills are correct, their documents are not, and
    // the queue that would fix them is exactly what did not work.
    return json({
      ok: true,
      assigned,
      unchanged,
      reprinted: 0,
      more_work: true,
      warning: "The logos were assigned, but the PDFs could not be re-printed. Try Re-print again.",
    });
  }

  const queued = (queue ?? []) as {
    id: string;
    bill_upload_id: string;
    logo_id: string | null;
    has_logo: boolean;
  }[];

  let reprinted = 0;
  let removed = 0;
  const failures: ReprintFailure[] = [];

  if (queued.length > 0) {
    const ids = queued.map((q) => q.id);

    /* Two queries for the whole batch, not two per bill: the re-print is the slow
       part and it should not be spending its time on round trips. */
    const [{ data: billRows, error: billsError }, { data: itemRows, error: itemsError }] = await Promise.all([
      admin.from("bills").select("*").in("id", ids),
      admin
        .from("bill_line_items")
        .select("bill_id, sr_no, description, hsn_code, uom, quantity, rate, amount")
        .in("bill_id", ids)
        .order("sr_no", { ascending: true }),
    ]);

    if (billsError || itemsError) {
      console.error("set-bill-logos: batch read failed:", billsError?.message, itemsError?.message);
      return json({
        ok: true,
        assigned,
        unchanged,
        reprinted: 0,
        more_work: true,
        warning: "The logos were assigned, but the bills could not be read for re-printing.",
      });
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

    /* One download and one decode per logo, no matter how many bills carry it.
       A batch of forty bills with the same logo decodes that logo once. */
    const imageCache = new Map<string, PdfImage | null>();

    for (const entry of queued) {
      const row = (billRows ?? []).find((r: Record<string, unknown>) => r.id === entry.id) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        failures.push({ bill_id: entry.id, invoice_no: null, reason: "bill_missing" });
        continue;
      }

      let logo: PdfImage | null = null;
      if (entry.has_logo && entry.logo_id) {
        const key = entry.logo_id;
        if (imageCache.has(key)) {
          logo = imageCache.get(key) ?? null;
        } else {
          logo = await loadInvoiceLogoImage(admin, key);
          imageCache.set(key, logo);
        }
        if (!logo) {
          // The bytes exist but cannot be embedded — a format the writer cannot
          // read, or an image past its size ceiling. Reported per bill rather than
          // printed without a logo, because a silently logo-less invoice is worse
          // than one the admin is told about.
          failures.push({
            bill_id: entry.id,
            invoice_no: (row.invoice_no as string | null) ?? null,
            reason: "logo_unreadable",
          });
          continue;
        }
      }

      const result = await reprint(admin, { id: entry.id, row, lineItems: itemsByBill.get(entry.id) ?? [] }, logo);
      if (result.ok) {
        reprinted++;
        removed += result.removed;
      } else {
        failures.push({
          bill_id: entry.id,
          invoice_no: (row.invoice_no as string | null) ?? null,
          reason: result.reason,
        });
      }
    }
  }

  /* Is there still outstanding work? Asking for a single row is the cheapest way
     to find out that exists — one indexed read, rather than counting a queue that
     might hold thousands of rows. */
  const { data: stillQueued } = await authClient.rpc("list_bills_needing_logo_render", { p_limit: 1 });
  const moreWork = (stillQueued ?? []).length > 0;

  /* Audit, written with the service role and never allowed to fail the request:
     losing an audit line must not undo work the user was told succeeded. One row
     for the assignment, and one per re-printed bill is deliberately NOT written —
     the re-print changes no data a person entered, only the document it produces,
     and the assignment row already records which bills were affected. */
  if (wantsAssign) {
    const { error: auditError } = await admin.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_username: user.user_metadata?.username ?? null,
      action: logoId ? "bill.logo_assigned" : "bill.logo_removed",
      target_type: "invoice_logo",
      target_id: logoId ?? null,
      detail: {
        logo_id: logoId,
        bills_requested: billIds.length,
        bills_changed: assigned,
        bills_already_correct: unchanged,
        bills_reprinted: reprinted,
      },
    });
    if (auditError) console.warn("set-bill-logos: audit skipped:", auditError.message);
  }

  return json({
    ok: true,
    assigned,
    unchanged,
    reprinted,
    superseded_documents_removed: removed,
    more_work: moreWork,
    failures,
  });
});