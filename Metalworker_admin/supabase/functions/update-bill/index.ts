// supabase/functions/update-bill/index.ts
//
// Save an edited bill and re-print its three copies.
//
// WHY A SEPARATE FUNCTION
// `process-bill-upload` creates bills from a workbook. This one changes one that
// already exists. They are separate because their failure modes are different and
// their permissions should be separable in principle: an upload can fail halfway
// through twenty invoices, while an edit touches exactly one and must either
// completely succeed or leave nothing changed.
//
// WHAT IT DOES
//   1. resolve the caller and confirm they are an ACTIVE administrator
//   2. read the bill and its line items
//   3. merge the submitted patch, validate it, and recompute the derived figures
//   4. write the row and replace the line items
//   5. render ORIGINAL / DUPLICATE / TRIPLICATE from the STORED values
//   6. upload all three to a NEW versioned path
//   7. point the row at the new paths, and remove the objects it replaced
//   8. audit what changed
//
// THE ORDER IS THE WHOLE DESIGN
//
//   * The row is written BEFORE the documents, because a document that disagrees
//     with its own row is the failure this feature could easily introduce.
//   * The row's PATHS are updated AFTER all three uploads succeed, so a failure
//     halfway through leaves the previous three documents in place and still
//     reachable from the row.
//   * If the documents cannot be produced after the row was written, the row is
//     RESTORED to its previous values. A save that reports failure while leaving
//     new numbers in the database and old numbers on the PDF is the one outcome
//     that cannot be allowed: the next person to open the bill would see a total
//     that the printed document does not support.
//
// ISOLATION
// Every statement is scoped by `bill_id`. There is no statement anywhere in this
// file that can touch a sibling invoice, and the three objects it writes are named
// with the bill's own id, so editing bill 316 cannot alter 315 or 317.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import { safeBillToken, COPY_LABEL, COPY_ORDER, type BillLineItem } from "../process-bill-upload/_shared/parseBill.ts";
import { computeBillValues, EditError, type BillPatch } from "../process-bill-upload/_shared/billEdit.ts";
import { loadInvoiceLogoImage } from "../process-bill-upload/_shared/invoiceLogo.ts";
import { loadActiveBusinessProfile } from "../process-bill-upload/_shared/businessProfileDb.ts";
import { profileForBill } from "../process-bill-upload/_shared/businessProfile.ts";

const BUCKET = "bills";
const TABLE = "bills";
const LINE_ITEMS = "bill_line_items";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error("update-bill: missing Supabase environment");
    return json({ ok: false, error: "The server is not configured correctly." }, 500);
  }

  /* Same gate as every other function here: the caller must be an authenticated
     user AND an active administrator. Checked before the body is read, so this
     cannot be used to probe whether a bill id exists. */
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Sign in again to continue." }, 401);

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
    return json({ ok: false, error: "Only an active administrator can edit a bill." }, 403);
  }

  let body: { bill_id?: unknown; patch?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "The request could not be read." }, 400);
  }

  const billId = typeof body.bill_id === "string" ? body.bill_id.trim() : "";
  if (billId === "") return json({ ok: false, error: "No bill was selected." }, 400);
  if (body.patch === null || typeof body.patch !== "object" || Array.isArray(body.patch)) {
    return json({ ok: false, error: "No changes were supplied." }, 400);
  }
  const patch = body.patch as BillPatch;

  /* ---- read the bill as it is now -----------------------------------------
     Needed both to merge the patch onto and, later, to restore if the documents
     cannot be produced. */
  const { data: existing, error: readError } = await admin
    .from(TABLE)
    .select("*")
    .eq("id", billId)
    .maybeSingle();
  if (readError) {
    console.error("update-bill: read failed:", readError.message);
    return json({ ok: false, error: "That bill could not be read." }, 500);
  }
  if (!existing) return json({ ok: false, error: "That bill no longer exists." }, 404);

  const { data: existingLines, error: linesError } = await admin
    .from(LINE_ITEMS)
    .select("sr_no, description, hsn_code, uom, quantity, rate, amount")
    .eq("bill_id", billId)
    .order("sr_no", { ascending: true });
  if (linesError) {
    console.error("update-bill: line items read failed:", linesError.message);
    return json({ ok: false, error: "That bill's line items could not be read." }, 500);
  }

  const currentItems: BillLineItem[] = (existingLines ?? []).map((row: Record<string, unknown>) => {
    const r = row as Record<string, unknown>;
    return {
      srNo: r.sr_no === null ? null : Number(r.sr_no),
      description: (r.description as string | null) ?? "",
      hsnCode: (r.hsn_code as string | null) ?? null,
      uom: (r.uom as string | null) ?? null,
      quantity: r.quantity === null ? null : Number(r.quantity),
      rate: r.rate === null ? null : Number(r.rate),
      amount: r.amount === null ? null : Number(r.amount),
    };
  });

  /* ---- validate and recompute -------------------------------------------- */
  let values: Record<string, unknown>;
  let lineItems: BillLineItem[];
  try {
    const computed = computeBillValues(existing as BillRecord, currentItems, patch);
    values = computed.values;
    lineItems = computed.lineItems;
  } catch (err) {
    if (err instanceof EditError) {
      return json({ ok: false, error: err.message, field: err.field }, 400);
    }
    console.error("update-bill: validation crashed:", err);
    return json({ ok: false, error: "The changes could not be checked." }, 400);
  }

  /* ---- write the row, then the line items --------------------------------- */
  const nextVersion = (Number((existing as Record<string, unknown>).pdf_version) || 1) + 1;

  const { error: updateError } = await admin
    .from(TABLE)
    .update({ ...values, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", billId);
  if (updateError) {
    console.error("update-bill: row update failed:", updateError.message);
    return json({ ok: false, error: "The bill could not be saved." }, 500);
  }

  if (patch.line_items !== undefined) {
    // Replaced rather than diffed. The line items of an invoice are a short,
    // ordered list that the editor presents as a table, so a delete-and-reinsert is
    // both simpler and less error-prone than matching rows, and it cannot leave a
    // stale row behind when the user deletes a line. Ordering is preserved by
    // `sr_no`, which is re-numbered from the submitted order.
    const { error: delError } = await admin.from(LINE_ITEMS).delete().eq("bill_id", billId);
    if (delError) {
      await restore(admin, billId, existing, currentItems);
      console.error("update-bill: line items delete failed:", delError.message);
      return json({ ok: false, error: "The bill's line items could not be replaced." }, 500);
    }
    if (lineItems.length > 0) {
      const { error: insError } = await admin.from(LINE_ITEMS).insert(
        lineItems.map((item) => ({
          bill_id: billId,
          sr_no: item.srNo,
          description: item.description,
          hsn_code: item.hsnCode,
          uom: item.uom,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
        }))
      );
      if (insError) {
        await restore(admin, billId, existing, currentItems);
        console.error("update-bill: line items insert failed:", insError.message);
        return json({ ok: false, error: "The bill's line items could not be saved." }, 500);
      }
    }
  }

  /* ---- render the three copies from the STORED values --------------------
     Read back from the database rather than assembled from the patch, so the
     document is provably a print of what is saved. A field the client did not send
     comes from the row, a derived field comes from the row the write above just
     produced, and a field outside the model entirely is simply not printed. */
  const { data: stored, error: rereadError } = await admin
    .from(TABLE)
    .select("*")
    .eq("id", billId)
    .maybeSingle();
  if (rereadError || !stored) {
    await restore(admin, billId, existing, currentItems);
    console.error("update-bill: re-read failed:", rereadError?.message);
    return json({ ok: false, error: "The saved bill could not be read back." }, 500);
  }

  const uploadId = (existing as Record<string, unknown>).bill_upload_id as string;
  const token = safeBillToken(
    (values.invoice_no as string | undefined) ?? (existing.invoice_no as string | null),
    existing.sheet_name as string
  );

  /* The version is part of the object name. Overwriting an object in place does not
     change its URL, and a browser will not re-fetch a URL it has already fetched —
     so an invoice that was edited would keep showing its pre-edit document to
     anyone who had opened it. A new name is a new URL, which is the only reliable
     cache-bust available without a query string the signed URL would not carry. */
  const base = `${uploadId}/${billId}_${token}_v${nextVersion}`;
  const newPaths: Record<string, string> = {
    original: `${base}_original.pdf`,
    duplicate: `${base}_duplicate.pdf`,
    triplicate: `${base}_triplicate.pdf`,
  };
  const rendered: Record<string, Uint8Array> = {};

  /* An edit does not change WHICH letterhead the invoice is on, so the re-print has
     to carry the same logo the previous documents had. Omitting it would mean every
     edit silently stripped the logo off the bills that had one — the row would still
     say `logo_id` while the new PDF showed nothing, which is precisely the mismatch
     this feature exists to avoid.

     A logo that cannot be loaded is a hard failure here, and deliberately so. It
     would otherwise produce a document with the logo missing, repoint the row at it,
     and report success. Restoring is the honest outcome: the edit is refused, the
     previous three documents stay in place, and the admin is told why. */
  const logoImage = await loadInvoiceLogoImage(admin, (stored as Record<string, unknown>).logo_id as string | null);
  const logoWanted = ((stored as Record<string, unknown>).logo_id as string | null) ?? null;
  if (logoWanted && !logoImage) {
    await restore(admin, billId, existing, currentItems);
    console.error("update-bill: logo could not be loaded for", billId, logoWanted);
    return json(
      {
        ok: false,
        error: "The bill was not saved because its logo image could not be read. Nothing has changed.",
        reason: "logo_unreadable",
      },
      500
    );
  }

  /* Which company-level DEFAULTS this re-print uses, and what to record against the
     bill afterwards. This is where historical safety is actually decided, so it is
     worth being explicit about the two cases:

       the bill already carries a snapshot -> that snapshot, NOT today's profile.
           An edit re-prints an invoice that already exists. If it picked up a
           profile that has been changed since, the corrected document would differ
           from the original one in ways the admin never asked for and cannot see —
           a different payment window, a different bank branch — and it would carry
           the same invoice number. A re-print has to reproduce the invoice.

       the bill carries none              -> today's profile, snapshotted now.
           Either the bill predates the feature, or this is its first print with a
           profile configured. Both mean "finalise it against what is in force".

     The current profile is only read when it will be used, so a bill with a
     snapshot does not depend on the profile table being readable at all. */
  let billProfile;
  try {
    const current = await loadActiveBusinessProfile(admin);
    billProfile = profileForBill(
      current,
      (stored as Record<string, unknown>).business_profile_snapshot
    );
  } catch (err) {
    await restore(admin, billId, existing, currentItems);
    console.error("update-bill: invoice business profile read error:", err);
    return json(
      {
        ok: false,
        error:
          "The bill was not saved because the invoice business profile could not be read. Nothing has changed.",
        reason: "profile_unreadable",
      },
      500
    );
  }

  try {
    for (const copy of COPY_ORDER) {
      const model = billFromRecord(
        { ...(stored as BillRecord), copy },
        lineItems,
        COPY_LABEL[copy]
      );
      rendered[copy] = renderBillDocument([model], COPY_LABEL[copy], logoImage, billProfile.profile);
    }
  } catch (err) {
    await restore(admin, billId, existing, currentItems);
    console.error("update-bill: render failed:", err);
    return json(
      { ok: false, error: "The bill was not saved because its PDFs could not be produced. Nothing has changed.", reason: "pdf_failed" },
      500
    );
  }

  /* Upload all three before changing the row's paths, so a failure part-way leaves
     the previous three documents in place and still reachable. */
  const uploaded: string[] = [];
  for (const copy of COPY_ORDER) {
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(newPaths[copy], rendered[copy], { contentType: "application/pdf", upsert: false });
    if (upErr) {
      console.error("update-bill: upload failed:", newPaths[copy], upErr.message);
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      await restore(admin, billId, existing, currentItems);
      return json(
        { ok: false, error: "The bill was not saved because its PDFs could not be stored. Nothing has changed.", reason: "storage_failed" },
        500
      );
    }
    uploaded.push(newPaths[copy]);
  }

  const { error: pathError } = await admin
    .from(TABLE)
    .update({
      original_pdf_path: newPaths.original,
      duplicate_pdf_path: newPaths.duplicate,
      triplicate_pdf_path: newPaths.triplicate,
      pdf_version: nextVersion,
      /* These three documents were just rendered WITH this logo, so that is what
         they now contain. Recording it here is what keeps the bill out of the
         re-print queue: without it, editing any bill that carries a logo would
         mark it as owing a logo it already has, and it would be re-printed on
         every subsequent queue pass, forever. */
      logo_rendered_logo_id: logoWanted,
      /* Whatever produced these three documents, recorded so a later profile edit
         cannot reach this bill. Written on every finalisation rather than only on
         the first, because a bill that had none is exactly the bill that would
         otherwise adopt today's settings on its next re-print. */
      business_profile_snapshot: billProfile.snapshot,
    })
    .eq("id", billId);
  if (pathError) {
    // The row still points at the previous three, which are still there, so the
    // only thing to clean up is what was just uploaded.
    console.error("update-bill: path update failed:", pathError.message);
    await admin.storage.from(BUCKET).remove(uploaded);
    await restore(admin, billId, existing, currentItems);
    return json(
      { ok: false, error: "The bill was not saved because its PDFs could not be linked. Nothing has changed.", reason: "save_failed" },
      500
    );
  }

  /* Only now are the previous objects unreferenced. Removing them is reported, never
     fatal: the row already points at the new ones, and a leftover object costs
     storage but cannot mislead anyone. */
  const superseded = [
    (existing as Record<string, unknown>).original_pdf_path,
    (existing as Record<string, unknown>).duplicate_pdf_path,
    (existing as Record<string, unknown>).triplicate_pdf_path,
  ].filter((p): p is string => typeof p === "string" && p !== "" && !uploaded.includes(p));
  if (superseded.length > 0) {
    const { error: rmError } = await admin.storage.from(BUCKET).remove(superseded);
    if (rmError) console.warn("update-bill: previous PDFs not removed:", rmError.message, superseded);
  }

  /* Audit. Written with the service role so the entry is recorded under the
     forged-row policy, and a failure is logged and ignored: losing an audit line
     must not undo a save the user was told succeeded. */
  const changed = Object.keys(values).filter((k) => {
    const before = (existing as Record<string, unknown>)[k];
    const after = values[k];
    return String(before ?? "") !== String(after ?? "");
  });
  const { error: auditError } = await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    actor_username: user.user_metadata?.username ?? null,
    action: "bill.updated",
    target_type: "bill",
    target_id: billId,
    /* `detail` is the column's name (migration 0003). It was briefly `metadata`,
       which does not exist on the table: PostgREST rejects the whole INSERT with
       "column admin_audit_log.metadata does not exist", and because the failure was
       only logged, every bill edit went unrecorded with nothing on screen to say so.
       `test-audit-log.ts` now fails if that spelling comes back. */
    detail: {
      invoice_no: values.invoice_no ?? existing.invoice_no ?? null,
      sheet_name: existing.sheet_name ?? null,
      fields_changed: changed,
      line_items: lineItems.length,
      pdf_version: nextVersion,
      previous_documents_removed: superseded.length,
    },
  });
  if (auditError) console.warn("update-bill: audit skipped:", auditError.message);

  return json({
    ok: true,
    bill_id: billId,
    pdf_version: nextVersion,
    amount_after_tax: values.amount_after_tax ?? null,
    amount_in_words: values.amount_in_words ?? null,
    pdfs: COPY_ORDER.map((copy) => ({
      copy,
      label: COPY_LABEL[copy],
      path: newPaths[copy],
      filename: `${token}_${copy}.pdf`,
    })),
  });
});

/**
 * Put a bill back the way it was.
 *
 * Only ever called after the row has already been written and the save then failed,
 * so its job is to undo a partial write. It restores the columns the patch touched
 * and, if line items were sent, the original rows.
 *
 * Best effort by design: a failure here is logged, because the caller is already
 * returning an error and the previous documents are still in place and still
 * reachable from the row — a bill that reverted its numbers but kept its old PDFs is
 * a far better state than one left claiming a save that did not happen.
 */
async function restore(
  admin: ReturnType<typeof createClient>,
  billId: string,
  previous: Record<string, unknown>,
  previousLines: BillLineItem[]
): Promise<void> {
  const restoreColumns: Record<string, unknown> = {};
  for (const key of Object.keys(previous)) {
    // `id`, `created_at` and the audit columns are not patch targets, but restoring
    // them is harmless and keeps this from needing a second list to stay in step.
    if (key === "id" || key === "bill_upload_id") continue;
    restoreColumns[key] = previous[key];
  }
  const { error } = await admin.from(TABLE).update(restoreColumns).eq("id", billId);
  if (error) {
    console.error("update-bill: RESTORE FAILED:", error.message);
    return;
  }

  const { data: current } = await admin.from(LINE_ITEMS).select("id").eq("bill_id", billId);
  if (Array.isArray(current) && current.length > 0) {
    await admin.from(LINE_ITEMS).delete().eq("bill_id", billId);
  }
  if (previousLines.length > 0) {
    const { error: lineError } = await admin.from(LINE_ITEMS).insert(
      previousLines.map((item) => ({
        bill_id: billId,
        sr_no: item.srNo,
        description: item.description,
        hsn_code: item.hsnCode,
        uom: item.uom,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
      }))
    );
    if (lineError) console.error("update-bill: RESTORE line items FAILED:", lineError.message);
  }
  console.log("update-bill: bill restored to its previous state");
}
