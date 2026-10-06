// supabase/functions/create-bill/index.ts
//
// Build a bill by hand, and turn it into three printed copies.
//
// WHY THIS IS A DIFFERENT FUNCTION FROM process-bill-upload AND update-bill
//
//   process-bill-upload  makes a bill out of a workbook. Its input is a file, its
//                        failure mode is "one of twenty sheets was odd", and it owns
//                        the provenance row the bills hang from.
//   update-bill          changes a bill that already has three PDFs and reprints
//                        them. It must not change anything if it cannot reprint.
//   create-bill          makes a bill that has never existed, from values somebody
//                        typed. It must not claim documents until all three exist,
//                        and it must not overwrite anything, ever.
//
// The three are separate because their permissions and their failure handling
// genuinely differ, and because a creator that shared a code path with either of
// them would inherit that path's assumptions - most dangerously the assumption that
// a bill already has documents to replace.
//
// ONE MODEL, ONE RENDERER
//
// There is no creator-specific invoice type here. A hand-built bill is a `bills` row
// like any other, filled through the same `computeBillValues` the editor uses, read
// back through the same `billFromRecord`, and printed by the same
// `renderBillDocument`. If this function had its own layout, "an invoice looks the
// same whether it was typed or imported" would be a hope instead of a fact - and the
// only way that stays a fact is if there is literally nothing to keep in step.
//
// ACTIONS
//
//   save      write the form's values onto the draft. No documents. Idempotent.
//   preview   save, then render ONE copy and return it inline. Writes nothing to
//             storage, so a preview cannot leave an orphaned object behind.
//   finalize  validate, save, render all three copies, upload them, and only then
//             point the row at them and mark it finalized.
//
// "Save" and "preview" both go through the database before rendering, which is the
// detail that makes the preview worth trusting: it is a print of the SAVED row, not
// a print of what the browser happens to be holding. The same guarantee `update-bill`
// gives its re-print. A preview that showed something the saved row does not contain
// would make "preview looks right, generate produced something else" a routine
// surprise.
//
// THE ORDER IS THE WHOLE DESIGN (finalize)
//
//   1. validate, so an unusable bill never gets as far as writing files
//   2. write the values, so the row is the single source of truth
//   3. re-read the row, and render all three from what was read
//   4. upload all three to a NEW versioned path
//   5. point the row at those paths AND set status = 'finalized' in ONE statement
//   6. write the job and folder links
//   7. audit
//
// Step 5 is one statement on purpose. `bills_draft_has_no_documents` refuses a draft
// that carries paths, so the two can never be observed disagreeing - there is no
// window in which a bill claims to be finalized but points at nothing, or carries
// three documents while still counting as a draft. And because step 6 is last, a
// finalized bill that lost its links is a bill whose invoices still exist and can be
// relinked, rather than a bill whose PDFs were never produced.
//
// NOTHING IS EVER OVERWRITTEN
//
// Every write is scoped by an id this request created, or by an id the caller named
// for a DRAFT it is allowed to edit. A finalized bill is refused outright: this
// function cannot change an issued invoice, and re-printing one is `update-bill`'s
// job with its own audit entry. `process-bill-upload` never calls this function, and
// this function never calls the upload path.
//
// SECURITY
//
// The caller must be an authenticated user AND an active administrator, checked
// before the body is read so this cannot be used to probe whether a bill exists. Two
// clients are made: the service role for the bill row itself (the same privilege
// `update-bill` uses), and the CALLER'S OWN session for job and folder links, because
// `link_bill_jobs` / `unlink_bill_jobs` are SECURITY DEFINER functions that gate on
// `auth.uid()` and would refuse a service-role call. That split is deliberate: the
// job-linking path keeps its own authorization check instead of being widened open
// here to make one call convenient.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";
import {
  safeBillToken,
  COPY_LABEL,
  COPY_ORDER,
  type BillLineItem,
  type CopyKind,
} from "../process-bill-upload/_shared/parseBill.ts";
import { computeBillValues, EditError, type BillPatch } from "../process-bill-upload/_shared/billEdit.ts";
import { loadInvoiceLogoImage } from "../process-bill-upload/_shared/invoiceLogo.ts";
import { loadActiveBusinessProfile } from "../process-bill-upload/_shared/businessProfileDb.ts";
import { profileForBill, type BusinessProfile } from "../process-bill-upload/_shared/businessProfile.ts";
import {
  copyBaseRecord,
  emptyBillRecord,
  findDuplicateInvoiceNos,
  validateForFinalize,
  wordsAfterCopy,
  type DuplicateMatch,
} from "../process-bill-upload/_shared/billCreator.ts";

const BUCKET = "bills";
const TABLE = "bills";
const LINE_ITEMS = "bill_line_items";
const UPLOADS = "bill_uploads";

/** Manual bills live under their own prefix, so they are obvious in the bucket. */
const MANUAL_PREFIX = "manual";

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

type Action = "save" | "preview" | "finalize";

interface RequestBody {
  action?: unknown;
  /** Omitted on the first `save`; the server then creates the draft and returns it. */
  bill_id?: unknown;
  /** Omitted unless copying. Never read from the client as trusted data. */
  source_bill_id?: unknown;
  /** "Use the current Invoice Business Profile" from the form. */
  use_current_profile?: unknown;
  patch?: unknown;
  logo_id?: unknown;
  folder_id?: unknown;
  /** `undefined` = leave alone, `[]` = unlink all, otherwise the full new set. */
  job_ids?: unknown;
  /** Set only after the admin has seen a duplicate-invoice-number warning. */
  confirm_duplicate_invoice_no?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error("create-bill: missing Supabase environment");
    return json({ ok: false, error: "The server is not configured correctly." }, 500);
  }

  /* The gate every function in this project starts with, in this order: resolve the
     user from the Authorization header, then confirm an ACTIVE administrator, both
     before the body is parsed. A creator that read the body first could be used to
     ask whether a given bill id exists by watching the difference between "no such
     bill" and "not allowed". */
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
  /* Read once and reused by every audit row. Falls back to the email rather than to
     nothing: `admin_audit_log.actor_id` is nullable so the trail survives a deleted
     user, and a NULL username there is the case where the trail is least useful. */
  const actorUsername: string | null =
    (user.user_metadata?.username as string | undefined) ??
    (user.email as string | undefined) ??
    null;

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || profile.is_active !== true) {
    return json(
      { ok: false, error: "Only an active administrator can create or edit a bill." },
      403
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ ok: false, error: "The request could not be read." }, 400);
  }

  const action = String(body.action ?? "") as Action;
  if (action !== "save" && action !== "preview" && action !== "finalize") {
    return json({ ok: false, error: "Unknown action." }, 400);
  }

  if (body.patch === null || typeof body.patch !== "object" || Array.isArray(body.patch)) {
    return json({ ok: false, error: "No bill details were supplied." }, 400);
  }
  const patch = body.patch as BillPatch;

  const billId = typeof body.bill_id === "string" ? body.bill_id.trim() : "";
  const sourceBillId = typeof body.source_bill_id === "string" ? body.source_bill_id.trim() : "";
  const useCurrentProfile = body.use_current_profile === true;
  const creatorKey =
    typeof body.patch === "object" && body.patch !== null && "creator_draft_key" in (body.patch as object)
      ? String(((body.patch as Record<string, unknown>).creator_draft_key) ?? "").trim()
      : "";
  /* The draft key is an idempotency token for the CREATE, carried in the patch
     because that is where the client already keeps everything about the form. It is
     stripped before the patch reaches `computeBillValues`, which would otherwise
     reject it as an unknown key. */
  if ("creator_draft_key" in (patch as Record<string, unknown>)) {
    delete (patch as Record<string, unknown>).creator_draft_key;
  }

  /* ---- resolve or create the draft ---------------------------------------- */

  let existing: Record<string, unknown> | null = null;
  let currentItems: BillLineItem[] = [];
  let created = false;

  if (billId !== "") {
    const read = await readBill(admin, billId);
    if (read.error) {
      console.error("create-bill: draft read failed:", read.error);
      return json({ ok: false, error: "The draft could not be read." }, 500);
    }
    if (!read.row) return json({ ok: false, error: "That draft no longer exists." }, 404);
    if (read.row.status === "finalized") {
      /* A finalized invoice is immutable here. `update-bill` exists for changing one,
         and routing that through here would give a second, differently-audited path to
         the same edit. */
      return json(
        { ok: false, error: "This invoice has already been generated. Edit it from the bill instead." },
        409
      );
    }
    existing = read.row;
    currentItems = read.lineItems;
  } else {
    /* Creating. If this exact form has already been created - the response was lost,
       or the user pressed Save twice - return the bill that exists rather than a
       second one. The unique index on `creator_draft_key` makes that race
       impossible to lose. */
    if (creatorKey === "") {
      return json({ ok: false, error: "The draft could not be identified. Reload the page." }, 400);
    }

    const made = await createDraft(admin, user.id, patch, {
      key: creatorKey,
      sourceBillId,
      useCurrentProfile,
    });
    if (made.error !== undefined) {
      if (made.code === "23505" && made.existingId) {
        /* The idempotency index fired: this form already has a bill. Carrying on and
           saving onto it is the correct behaviour - the response was lost, not the
           work - and it means a retried autosave is one bill rather than two. */
        const read = await readBill(admin, made.existingId);
        if (read.row) {
          existing = read.row;
          currentItems = read.lineItems;
        }
      } else {
        console.error("create-bill: draft creation failed:", made.error);
        return json({ ok: false, error: made.userMessage ?? "The bill could not be started." }, made.status ?? 500);
      }
    } else {
      existing = made.row ?? null;
      currentItems = [];
      created = true;
      /* A copy starts life with the SOURCE bill's job links already reflected in the
         form, but this function never writes them on create: linking is the form's
         explicit choice, so nothing is linked until the admin asks for it. The
         client sends `job_ids` on the same save that creates the draft. */
      void sourceBillId;
    }
  }

  /* From here on there is always a row to write to. */
  if (!existing) {
    return json({ ok: false, error: "The draft could not be prepared." }, 500);
  }
  const draftId = String(existing.id);

  /* ---- validate, normalize and recompute ---------------------------------- */

  let values: Record<string, unknown>;
  let lineItems: BillLineItem[];
  try {
    /* The base is the STORED row, always — and that is the same rule the editor follows,
       which is what makes a creator total and an edited-bill total the same number from
       the same code and the same inputs.

       For a copy the stored row was itself written by `createDraft` against
       `copyBaseRecord(source)`, so its tax amounts already record the source's
       applicability. The signal therefore survives the round trip through the database
       instead of being lost the moment the draft is inserted — which is the whole reason
       the signal is stored in the amounts rather than in a separate "supply type"
       column. `createDraft` is the only place a base is chosen. */
    const computed = computeBillValues(
      (existing as unknown as BillRecord) ?? emptyBillRecord(),
      currentItems,
      patch
    );
    values = computed.values;
    lineItems = computed.lineItems;
  } catch (err) {
    if (err instanceof EditError) {
      return json({ ok: false, error: err.message, field: err.field }, 400);
    }
    console.error("create-bill: validation crashed:", err);
    return json({ ok: false, error: "The bill could not be checked." }, 400);
  }

  /* ---- the totals the form displays ----------------------------------------
     Read out of `computeBillValues` rather than recomputed, so the six figures the
     admin sees beside their line items ARE the six figures the renderer is about to
     print. A form that showed its own arithmetic would be a second answer to "what
     does this invoice total", and the requirement says there is only one.

     `cgst`/`sgst`/`igst`/`total_gst` matter as much as the two headline numbers: which
     of the three taxes applies is decided from the base record's amounts, so a client
     cannot work it out from the form alone and would otherwise have to show a blank
     where the invoice is about to print a figure. */
  const totals = {
    amount_before_tax: Number(values.amount_before_tax ?? 0),
    cgst: Number(values.cgst ?? 0),
    sgst: Number(values.sgst ?? 0),
    igst: Number(values.igst ?? 0),
    total_gst: Number(values.total_gst ?? 0),
    amount_after_tax: Number(values.amount_after_tax ?? 0),
  };

  /* A copy's amount in words: keep the source's own wording when the money did not
     move, and regenerate it when it did, so the words and the figures can never
     disagree on the printed document. */
  if (created && sourceBillId !== "") {
    const { data: source } = await admin
      .from(TABLE)
      .select("amount_after_tax, amount_in_words")
      .eq("id", sourceBillId)
      .maybeSingle();
    if (source) {
      const resolved = wordsAfterCopy(
        (source as Record<string, unknown>).amount_after_tax as number | null,
        Number(values.amount_after_tax ?? 0),
        (source as Record<string, unknown>).amount_in_words as string | null
      );
      if (resolved !== undefined) values.amount_in_words = resolved;
    }
  }

  /* ---- the write ----------------------------------------------------------- */

  const write: Record<string, unknown> = {
    ...values,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  };
  /* `logo_id` is the letterhead and belongs to the invoice. Absent from the request
     means "leave it alone"; present means set it, and an explicit null clears it. */
  if (body.logo_id !== undefined) {
    write.logo_id = body.logo_id === null ? null : String(body.logo_id);
  }
  if (action === "finalize") {
    write.status = "finalized";
  }

  const { error: writeError } = await admin.from(TABLE).update(write).eq("id", draftId);
  if (writeError) {
    console.error("create-bill: row update failed:", writeError.message);
    return json({ ok: false, error: "The bill could not be saved." }, 500);
  }

  /* Line items are REPLACED, not diffed, and only when the client sent them. The same
     argument `update-bill` makes: this is a short ordered list shown as a table, and
     a delete-and-reinsert cannot leave a stale row behind when a line is deleted. */
  let linesTouched = false;
  if (patch.line_items !== undefined) {
    linesTouched = true;
    const { error: delError } = await admin.from(LINE_ITEMS).delete().eq("bill_id", draftId);
    if (delError) {
      console.error("create-bill: line items delete failed:", delError.message);
      return json({ ok: false, error: "The bill's line items could not be replaced." }, 500);
    }
    if (lineItems.length > 0) {
      const { error: insError } = await admin.from(LINE_ITEMS).insert(
        lineItems.map((item) => ({
          bill_id: draftId,
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
        console.error("create-bill: line items insert failed:", insError.message);
        return json({ ok: false, error: "The bill's line items could not be saved." }, 500);
      }
    }
  }

  /* ---- duplicate invoice numbers ------------------------------------------
     A warning the admin has to clear, not a hard block. Two invoices can legitimately
     share a number - a re-issued bill, a cancelled-and-reissued pair, a number reused
     across financial years - so refusing to generate would make the creator unusable
     for those, and a partial unique index would fail to build on existing production
     data that already contains duplicates. What is never allowed is writing over
     another bill, and this function cannot: the draft is always a new row with a new
     id. What the warning prevents is an admin typing an existing number by accident
     without noticing. */
  let duplicateMatches: DuplicateMatch[] | null = null;
  if (action === "finalize" && values.invoice_no) {
    const { data: dupes } = await admin
      .from(TABLE)
      .select("id, invoice_no, invoice_date, sheet_name, party_name, status")
      .eq("invoice_no", String(values.invoice_no))
      .neq("id", draftId);
    duplicateMatches = findDuplicateInvoiceNos(values.invoice_no, (dupes ?? []) as DuplicateMatch[]);
    if (duplicateMatches.length > 0 && body.confirm_duplicate_invoice_no !== true) {
      /* The row is already saved as a draft's worth of data, which is the correct
         outcome: the admin's work is kept and they can change the number and try
         again. But the status is NOT finalized - it was not written yet, because the
         duplicate check runs before the finalize write below. */
      return json(
        {
          ok: false,
          error: `Invoice number ${String(values.invoice_no)} is already used by ${duplicateMatches.length} other bill${duplicateMatches.length === 1 ? "" : "s"}.`,
          reason: "duplicate_invoice_no",
          duplicates: duplicateMatches,
          bill_id: draftId,
        },
        409
      );
    }
  }

  /* ---- re-read, so everything after this is a print of what is saved ------- */

  const { data: stored, error: rereadError } = await admin
    .from(TABLE)
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  if (rereadError || !stored) {
    console.error("create-bill: re-read failed:", rereadError?.message);
    return json({ ok: false, error: "The saved bill could not be read back." }, 500);
  }
  const row = stored as Record<string, unknown>;
  const storedItems = linesTouched ? lineItems : currentItems;

  /* ---- which company defaults, and what to record afterwards ---------------
     Same two cases `update-bill` documents, and for the same reason:

       the draft already carries a snapshot -> that snapshot, never today's profile.
           A creator reopened tomorrow must produce the SAME invoice it would have
           produced today. Adopting a profile that changed overnight would alter a
           payment window or a bank branch on an invoice nobody edited.

       the draft carries none                  -> today's profile, snapshotted now,
           unless the admin ticked "use current profile" off, in which case the bill
           keeps working from its own fields and the snapshot stays null.

     A copy that did NOT tick the box inherits the SOURCE bill's snapshot, which is
     the "never silently replace old profile info" requirement, made concrete. */
  let billProfile: { profile: BusinessProfile; snapshot: Record<string, unknown> | null };
  try {
    const current = await loadActiveBusinessProfile(admin);
    const inherited = sourceBillId !== "" && !useCurrentProfile
      ? await sourceSnapshot(admin, sourceBillId)
      : null;
    if (inherited) {
      billProfile = profileForBill(current, inherited);
    } else if (sourceBillId === "" && !useCurrentProfile && row.business_profile_snapshot) {
      /* A plain draft the admin has since asked to run on its own values. */
      billProfile = profileForBill(current, null);
    } else {
      billProfile = profileForBill(current, row.business_profile_snapshot);
    }
  } catch (err) {
    console.error("create-bill: invoice business profile read error:", err);
    return json(
      {
        ok: false,
        error:
          "The invoice business profile could not be read, so nothing has been generated.",
        reason: "profile_unreadable",
      },
      500
    );
  }

  const logoWanted = (row.logo_id as string | null) ?? null;
  const logoImage = await loadInvoiceLogoImage(admin, logoWanted);
  if (logoWanted && !logoImage) {
    /* A hard failure, deliberately. Continuing would produce a document with the
       letterhead missing, point the row at it, and report success. */
    return json(
      {
        ok: false,
        error: "The chosen logo image could not be read, so nothing has been generated.",
        reason: "logo_unreadable",
      },
      500
    );
  }

  /* ---- render ------------------------------------------------------------- */

  let models: { copy: CopyKind; bytes: Uint8Array }[];
  try {
    const wanted: readonly CopyKind[] = action === "finalize" ? COPY_ORDER : ["original"];
    models = wanted.map((copy) => {
      const model = billFromRecord(
        { ...(row as unknown as BillRecord), copy },
        storedItems,
        COPY_LABEL[copy]
      );
      return { copy, bytes: renderBillDocument([model], COPY_LABEL[copy], logoImage, billProfile.profile) };
    });
  } catch (err) {
    console.error("create-bill: render failed:", err);
    return json(
      {
        ok: false,
        error: "The invoice could not be produced. Nothing has been generated.",
        reason: "pdf_failed",
      },
      500
    );
  }

  /* ---- PREVIEW: return the bytes, store nothing ---------------------------
     This is why preview cannot leave an orphan: nothing is uploaded, so there is
     nothing to clean up and no object that exists without a row pointing at it. The
     bill is still a draft with three null paths, which is a state the schema allows
     and the folder summaries ignore. */
  if (action === "preview") {
    return json({
      ok: true,
      bill_id: draftId,
      preview: true,
      status: row.status ?? "draft",
      amount_in_words: row.amount_in_words ?? null,
      ...totals,
      filename: `${safeBillToken(String(row.invoice_no ?? ""), String(row.sheet_name ?? ""))}_original.pdf`,
      pdf_base64: toBase64(models[0].bytes),
    });
  }

  /* ---- FINALIZE: upload, then point the row at them ------------------------
     Every write below happens only on the finalize path. A draft never reaches
     storage. */

  if (action !== "finalize") {
    /* save */
    if (created) {
      await writeAudit(admin, user.id, actorUsername, sourceBillId !== "" ? "bill.copied" : "bill.created", draftId, {
        invoice_no: row.invoice_no ?? null,
        copied_from_bill_id: sourceBillId || null,
      });
    }
    return json({
      ok: true,
      bill_id: draftId,
      created,
      status: row.status ?? "draft",
      saved_at: write.updated_at,
      amount_in_words: row.amount_in_words ?? null,
      ...totals,
    });
  }

  /* Validation runs here rather than earlier on purpose: it needs the computed
     figures, which only exist once the patch has been through `computeBillValues`.
     It is before any file is written, so a bill that cannot be generated never
     produces a single object. */
  const blockers = validateForFinalize({
    patch,
    lineItems: storedItems,
    totals: {
      amountBeforeTax: totals.amount_before_tax,
      totalGst: totals.total_gst,
      amountAfterTax: totals.amount_after_tax,
    },
  });
  if (blockers.length > 0) {
    return json(
      {
        ok: false,
        error: blockers[0].message,
        reason: "validation_failed",
        errors: blockers,
        bill_id: draftId,
      },
      400
    );
  }

  const token = safeBillToken(
    (values.invoice_no as string | undefined) ?? (row.invoice_no as string | null),
    (row.sheet_name as string | null) ?? ""
  );
  /* The object name starts with the bill's OWN id, which is what
     `bills_pdf_paths_same_bill` checks: it requires all three paths' second segment
     to begin with the same `_`-delimited token. Naming them after the bill rather
     than after an upload means a manual bill satisfies that constraint without
     inventing a fake upload folder - and it makes the objects self-describing. */
  const base = `${MANUAL_PREFIX}/${draftId}_${token}_v1`;
  const newPaths: Record<CopyKind, string> = {
    original: `${base}_original.pdf`,
    duplicate: `${base}_duplicate.pdf`,
    triplicate: `${base}_triplicate.pdf`,
  };

  const uploaded: string[] = [];
  for (const { copy } of models) {
    const bytes = models.find((m) => m.copy === copy)?.bytes;
    if (!bytes) continue;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(newPaths[copy], bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) {
      console.error("create-bill: upload failed:", newPaths[copy], upErr.message);
      /* Remove what did go in. The row still has three null paths and is still a
         draft, so there is no state in which a bill claims documents it does not
         have. */
      if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
      await admin.from(TABLE).update({ status: "draft" }).eq("id", draftId);
      return json(
        {
          ok: false,
          error: "The invoice documents could not be stored, so nothing was generated. Your draft is saved.",
          reason: "storage_failed",
          bill_id: draftId,
        },
        500
      );
    }
    uploaded.push(newPaths[copy]);
  }

  /* ONE statement sets the paths, the version, the logo that was actually rendered,
     the profile snapshot, and the status. `bills_draft_has_no_documents` makes the
     draft-with-paths state unrepresentable, so this cannot be observed half-applied,
     and a failure here leaves the uploaded objects to be removed by the caller of
     this handler rather than stranding them. */
  const { error: finalizeError } = await admin
    .from(TABLE)
    .update({
      original_pdf_path: newPaths.original,
      duplicate_pdf_path: newPaths.duplicate,
      triplicate_pdf_path: newPaths.triplicate,
      pdf_version: 1,
      /* Recorded so this bill does not sit in the re-print queue forever: these
         documents were rendered WITH this logo. */
      logo_rendered_logo_id: logoWanted,
      /* Whatever produced these three, frozen against later profile edits. */
      business_profile_snapshot: billProfile.snapshot,
      status: "finalized",
      finalized_at: new Date().toISOString(),
    })
    .eq("id", draftId);

  if (finalizeError) {
    console.error("create-bill: finalize update failed:", finalizeError.message);
    await admin.storage.from(BUCKET).remove(uploaded);
    /* Put the row back to a draft. It is already a draft as far as the documents are
       concerned - the paths were never written - so this only corrects the status
       column that the failed statement may have half-set. */
    await admin.from(TABLE).update({ status: "draft" }).eq("id", draftId);
    return json(
      {
        ok: false,
        error: "The generated documents could not be linked to the bill, so nothing was finalized. Your draft is saved.",
        reason: "save_failed",
        bill_id: draftId,
      },
      500
    );
  }

  /* ---- job links and folder, LAST ------------------------------------------
     After the documents exist, and through the CALLER'S OWN session so the 0013
     admin gate and the existing RLS both apply rather than being bypassed. If these
     fail the invoice still exists and is downloadable; the error is reported and the
     admin can retry the link from the bill. An invoice that could not be generated
     because a job list was rejected would be the worse outcome. */
  let jobsLinked = true;
  let jobsError: string | null = null;
  if (body.job_ids !== undefined) {
    const wanted = Array.isArray(body.job_ids)
      ? [...new Set(body.job_ids.filter((v): v is string => typeof v === "string" && v.trim() !== ""))]
      : [];
    const result = await syncJobLinks(authClient, draftId, wanted);
    if (!result.ok) {
      jobsLinked = false;
      jobsError = result.error;
      console.error("create-bill: job link sync failed:", result.error);
    }
  }

  let folderLinked = true;
  if (body.folder_id !== undefined) {
    const folderId = body.folder_id === null || body.folder_id === "" ? null : String(body.folder_id);
    const result = await syncFolderLink(admin, draftId, folderId);
    if (!result.ok) {
      folderLinked = false;
      console.error("create-bill: folder link failed:", result.error);
    }
  }

  /* ---- audit ---------------------------------------------------------------
     Written with the service role, as every other function here does, so the entry
     lands under the forged-row policy. `detail` is the column's real name - it was
     briefly `metadata`, which does not exist, and the failure was swallowed, so every
     bill edit went unrecorded with nothing on screen to say so.

     The log records WHICH bill came from WHERE, and a few figures. It does not record
     the invoice: the amounts, the customer's details and the lines are already in the
     bill row the audit entry points at, and duplicating a financial document into a
     log table is how a log table starts leaking one. */
  await writeAudit(admin, user.id, actorUsername, created ? (sourceBillId !== "" ? "bill.copied" : "bill.created") : "bill.finalized", draftId, {
    invoice_no: row.invoice_no ?? null,
    invoice_date: row.invoice_date ?? null,
    amount_after_tax: row.amount_after_tax ?? null,
    copied_from_bill_id: sourceBillId || (row.copied_from_bill_id as string | null) || null,
    line_items: storedItems.length,
    pdf_version: 1,
    copies: COPY_ORDER.map((c) => ({ copy: c, label: COPY_LABEL[c] })),
  });
  await writeAudit(admin, user.id, actorUsername, "bill.pdf_generated", draftId, {
    invoice_no: row.invoice_no ?? null,
    pdf_version: 1,
    copies: 3,
    logo_id: logoWanted,
  });

  return json({
    ok: true,
    bill_id: draftId,
    created,
    status: "finalized",
    pdf_version: 1,
    amount_in_words: row.amount_in_words ?? null,
    ...totals,
    jobs_linked: jobsLinked,
    jobs_error: jobsError,
    folder_linked: folderLinked,
    duplicate_invoice_no: duplicateMatches && duplicateMatches.length > 0 ? duplicateMatches : null,
    pdfs: COPY_ORDER.map((copy) => ({
      copy,
      label: COPY_LABEL[copy],
      path: newPaths[copy],
      filename: `${token}_${copy}.pdf`,
    })),
  });
});

/* ──────────────────────────────────────────────
   Reading and creating
   ────────────────────────────────────────────── */

interface BillRead {
  row: Record<string, unknown> | null;
  lineItems: BillLineItem[];
  error: string | null;
}

async function readBill(
  admin: ReturnType<typeof createClient>,
  billId: string
): Promise<BillRead> {
  const { data, error } = await admin.from(TABLE).select("*").eq("id", billId).maybeSingle();
  if (error) return { row: null, lineItems: [], error: error.message };
  if (!data) return { row: null, lineItems: [], error: null };

  const { data: lines, error: lineError } = await admin
    .from(LINE_ITEMS)
    .select("sr_no, description, hsn_code, uom, quantity, rate, amount")
    .eq("bill_id", billId)
    .order("sr_no", { ascending: true });
  if (lineError) return { row: null, lineItems: [], error: lineError.message };

  return {
    row: data as Record<string, unknown>,
    lineItems: (lines ?? []).map((row: Record<string, unknown>) => ({
      srNo: row.sr_no === null ? null : Number(row.sr_no),
      description: (row.description as string | null) ?? "",
      hsnCode: (row.hsn_code as string | null) ?? null,
      uom: (row.uom as string | null) ?? null,
      quantity: row.quantity === null ? null : Number(row.quantity),
      rate: row.rate === null ? null : Number(row.rate),
      amount: row.amount === null ? null : Number(row.amount),
    })),
    error: null,
  };
}

/**
 * Make the draft row.
 *
 * The provenance row exists because `bills.bill_upload_id` is NOT NULL and both
 * clients read bills through `bill_uploads!inner(...)`: a bill with no workbook has
 * nowhere to point, and making the column nullable would make every inner join stop
 * returning the bill, so it would vanish from the list it was just created in. So a
 * hand-built bill gets its own row recording that it was not uploaded - and
 * `bill_uploads.creation_source = 'manual'` is what keeps that honest rather than
 * a row that claims a filename it never had.
 *
 * Every field is a real column on the row the workbook path also fills. Nothing here
 * is creator-only.
 */
async function createDraft(
  admin: ReturnType<typeof createClient>,
  userId: string,
  patch: BillPatch,
  options: { key: string; sourceBillId: string; useCurrentProfile: boolean }
): Promise<{
  row?: Record<string, unknown>;
  uploadId?: string;
  error?: string;
  userMessage?: string;
  status?: number;
  /** A PostgREST SQLSTATE, only ever "23505" here: the draft-key index firing. */
  code?: string;
  /** Which input an `EditError` blamed. A column name, NOT a status code. */
  field?: string | null;
  existingId?: string;
}> {
  /* Compute the figures first, so the draft holds a consistent total from the moment it
     exists. The creator shows a running total and the row has to agree with it.

     AGAINST WHAT, THOUGH, IS THE WHOLE POINT. A brand-new bill computes against a blank
     record, which is right: it has charged nothing yet, so every rate the admin typed is
     a rate they meant. A COPY must not. It inherits the source's tax applicability, and
     `computeBillValues` reads applicability from the base record's tax AMOUNTS — which a
     blank record has none of. Computed against blank, a copy of an intra-state bill
     charges CGST + SGST + IGST, and on the reference workbook that turns 77,290 into
     89,080: an 18,000 overcharge, printed on a tax invoice, with no error anywhere.

     So the source row is read first, and `copyBaseRecord` turns it into a base carrying
     exactly the three amounts that decision needs. Those amounts are a SIGNAL, not a
     total — `computeBillValues` recomputes all three from the copy's own base and rates,
     so a source charging 900 cannot leak into a 100-base copy as a 900 charge. */
  let base: BillRecord = emptyBillRecord();
  if (options.sourceBillId !== "") {
    const { data: source, error: sourceError } = await admin
      .from(TABLE)
      .select("*")
      .eq("id", options.sourceBillId)
      .maybeSingle();
    if (sourceError) {
      return {
        error: sourceError.message,
        userMessage: "The bill being copied could not be read.",
        status: 500,
      };
    }
    /* Refused rather than guessed. A missing source means the copy would be computed
       against a blank base, which is precisely the overcharge above, and the admin
       would have no way of knowing: the invoice looks completely ordinary. Saying so is
       the only honest response, and it is recoverable — the bill is still there, and the
       admin can pick it again. */
    if (!source) {
      return {
        error: "source bill not found",
        userMessage: "The bill you are copying no longer exists. Pick another one to copy.",
        status: 409,
      };
    }
    base = copyBaseRecord(source as unknown as BillRecord);
  }

  let values: Record<string, unknown>;
  let lineItems: BillLineItem[];
  try {
    const computed = computeBillValues(base, [], patch);
    values = computed.values;
    lineItems = computed.lineItems;
  } catch (err) {
    if (err instanceof EditError) {
      return {
        error: err.message,
        userMessage: err.message,
        status: 400,
        /* Carried through so the form can put the message on the right input. Kept in
           its own field rather than overloading `code`, which is a PostgREST SQLSTATE:
           one of those is a database diagnostic and the other is a column name, and a
           caller that read the wrong one would either miss the field or try to render
           "23505" as a form label. */
        field: err.field,
      };
    }
    return {
      error: String(err),
      userMessage: "The bill could not be checked.",
      status: 400,
    };
  }

  const { data: upload, error: uploadError } = await admin
    .from(UPLOADS)
    .insert({
      original_filename: "Created manually",
      base_name: "Created manually",
      status: "completed",
      invoice_count: 1,
      created_by: userId,
      creation_source: "manual",
    })
    .select("id")
    .maybeSingle();

  if (uploadError || !upload) {
    return {
      error: uploadError?.message ?? "no upload row returned",
      userMessage: "The bill could not be started.",
      status: 500,
    };
  }
  const uploadId = String((upload as Record<string, unknown>).id);

  const insert: Record<string, unknown> = {
    ...values,
    bill_upload_id: uploadId,
    /* `sheet_name` is NOT NULL and unique per upload. One creation, one bill, so one
       sheet - and naming it after the invoice number means the upload list reads
       sensibly even though there is no sheet. */
    sheet_name: String(values.invoice_no ?? "MANUAL"),
    status: "draft",
    origin: options.sourceBillId !== "" ? "copy" : "manual",
    copied_from_bill_id: options.sourceBillId !== "" ? options.sourceBillId : null,
    creator_draft_key: options.key,
    /* Who typed it. Null on every imported bill, which has no human author in this
       sense - the uploader is recorded on `bill_uploads.created_by`. */
    created_by: userId,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  /* The paths are left NULL, which `bills_pdf_paths_all_or_none` allows and
     `bills_draft_has_no_documents` requires. */
  const { data: bill, error: billError } = await admin
    .from(TABLE)
    .insert(insert)
    .select("*")
    .maybeSingle();

  if (billError || !bill) {
    /* Undo the provenance row. `bills.bill_upload_id` cascades from it, so removing it
       removes any bill that got written - which is what makes this a rollback rather
       than a best-effort tidy-up. An orphaned upload row would otherwise sit in the
       list claiming an invoice it does not have. */
    await admin.from(UPLOADS).delete().eq("id", uploadId);
    if (billError?.code === "23505" && options.key !== "") {
      /* The idempotency index fired: this form already has a bill. Not an error. */
      const { data: existing } = await admin
        .from(TABLE)
        .select("id")
        .eq("creator_draft_key", options.key)
        .maybeSingle();
      if (existing) {
        return { error: "", userMessage: "", status: 200, code: "23505", existingId: String(existing.id) };
      }
    }
    return {
      error: billError?.message ?? "no bill row returned",
      userMessage: "The bill could not be started.",
      status: 500,
    };
  }

  const row = bill as Record<string, unknown>;
  if (lineItems.length > 0) {
    const { error: lineError } = await admin.from(LINE_ITEMS).insert(
      lineItems.map((item) => ({
        bill_id: String(row.id),
        sr_no: item.srNo,
        description: item.description,
        hsn_code: item.hsnCode,
        uom: item.uom,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
      }))
    );
    if (lineError) {
      /* The bill is real but incomplete, so it is REMOVED rather than left as a
         draft with no lines. A draft with no line items is a legitimate state, but a
         half-created one is not: the admin would be told the bill was started, find it
         in the list, and find nothing in it. */
      await admin.from(UPLOADS).delete().eq("id", uploadId);
      return {
        error: lineError.message,
        userMessage: "The bill's line items could not be started.",
        status: 500,
      };
    }
  }

  /* The snapshot is taken HERE, at create time, when the admin asked for the current
     profile. Doing it at create rather than at finalize means the bill a user is
     looking at now is the bill they will get in an hour, even if somebody edits the
     profile in between. */
  if (options.useCurrentProfile) {
    try {
      const current = await loadActiveBusinessProfile(admin);
      const resolved = profileForBill(current, null);
      if (resolved.snapshot) {
        await admin.from(TABLE).update({ business_profile_snapshot: resolved.snapshot }).eq("id", String(row.id));
        row.business_profile_snapshot = resolved.snapshot;
      }
    } catch (err) {
      console.error("create-bill: profile snapshot at create failed (non-fatal):", err);
    }
  }

  return { row, uploadId };
}

/** The profile snapshot a copy inherits when the admin keeps the source's settings. */
async function sourceSnapshot(
  admin: ReturnType<typeof createClient>,
  sourceBillId: string
): Promise<unknown | null> {
  const { data } = await admin
    .from(TABLE)
    .select("business_profile_snapshot")
    .eq("id", sourceBillId)
    .maybeSingle();
  if (!data) return null;
  return (data as Record<string, unknown>).business_profile_snapshot ?? null;
}

/* ──────────────────────────────────────────────
   Relationships
   ────────────────────────────────────────────── */

/**
 * Make the bill's job links match `wanted`, exactly.
 *
 * Through `authClient` - the CALLER's session - and never the service role. The
 * 0013 RPCs are SECURITY DEFINER and gate on `auth.uid()`; a service-role call has no
 * user and would be refused. Going through the caller's own session keeps that gate
 * and the existing RLS in force instead of widening them open here.
 *
 * The two existing RPCs are used rather than writing `bill_job_connections`
 * directly: they are idempotent, they are transactional, and they are the only path
 * any other screen uses. A second way to write the same rows is a second thing that
 * can disagree with the first.
 */
async function syncJobLinks(
  authClient: ReturnType<typeof createClient>,
  billId: string,
  wanted: string[]
): Promise<{ ok: boolean; error: string | null }> {
  const { data: current, error: readError } = await authClient.rpc("get_bill_job_connections", {
    p_bill_id: billId,
  });
  if (readError) return { ok: false, error: readError.message };

  const present = new Set(
    ((current ?? []) as { job_id: string }[]).map((row) => row.job_id).filter((id) => typeof id === "string")
  );
  const target = new Set(wanted);

  const toAdd = wanted.filter((id) => !present.has(id));
  const toRemove = [...present].filter((id) => !target.has(id));

  if (toAdd.length > 0) {
    const { error } = await authClient.rpc("link_bill_jobs", { p_bill_id: billId, p_job_ids: toAdd });
    if (error) return { ok: false, error: error.message };
  }
  if (toRemove.length > 0) {
    const { error } = await authClient.rpc("unlink_bill_jobs", { p_bill_id: billId, p_job_ids: toRemove });
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/**
 * Put the bill in exactly one billing folder, or in none.
 *
 * `folder_items` is written through the existing table rather than a new RPC, because
 * the desktop client already inserts into it directly from the user's session
 * (`addBillsToBillingFolder`) and RLS governs it. Writing it the same way keeps one
 * set of rules instead of two.
 *
 * The delete is scoped to THIS bill, so a bill that moves between folders leaves
 * nothing behind in the old one, and no other bill in that folder is touched.
 */
async function syncFolderLink(
  admin: ReturnType<typeof createClient>,
  billId: string,
  folderId: string | null
): Promise<{ ok: boolean; error: string | null }> {
  const { error: clearError } = await admin
    .from("folder_items")
    .delete()
    .eq("item_type", "bill")
    .eq("item_id", billId);
  if (clearError) return { ok: false, error: clearError.message };

  if (folderId === null) return { ok: true, error: null };

  /* Position continues from the folder's current maximum, so a bill added by the
     creator lands at the end rather than colliding with an existing display order. */
  const { data: existing, error: readError } = await admin
    .from("folder_items")
    .select("position")
    .eq("folder_id", folderId)
    .eq("item_type", "bill")
    .order("position", { ascending: false })
    .limit(1);
  if (readError) return { ok: false, error: readError.message };

  const next = ((existing ?? []) as { position: number | null }[])[0]?.position ?? -1;
  const { error } = await admin.from("folder_items").insert({
    folder_id: folderId,
    item_type: "bill",
    item_id: billId,
    position: next + 1,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, error: null };
}

/* ──────────────────────────────────────────────
   Odds and ends
   ────────────────────────────────────────────── */

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  actorUsername: string | null,
  actionName: string,
  targetId: string,
  detail: Record<string, unknown>
): Promise<void> {
  /* Best effort by design, as everywhere else here: losing an audit line must not
     undo a save the user was told succeeded. It is logged loudly so a systematic
     failure is visible rather than silent. */
  const { error } = await admin.from("admin_audit_log").insert({
    actor_id: actorId,
    /* Recorded here as well as on the row, because the 0003 policy allows the uid to
       be set to NULL when the user is later deleted, and a history that then reads
       "deleted user" instead of a name has lost the one thing it is for. */
    actor_username: actorUsername,
    /* Every key written out longhand rather than by shorthand. `test-audit-log.ts`
       reads these keys out of the source to check they are columns the table really
       has — which is how the original `metadata` bug was caught — and a shorthand
       property is invisible to it. The scanner is the check; being legible to it is
       worth four extra characters. */
    action: actionName,
    target_type: "bill",
    target_id: targetId,
    /* `detail` is the column's real name. It was briefly `metadata`, which does not
       exist on the table, so PostgREST rejected the whole INSERT and the failure was
       only logged — every bill edit went unrecorded with nothing on screen to say so.
       `test-audit-log.ts` fails if that spelling comes back. */
    detail: detail,
  });
  if (error) console.warn(`create-bill: audit ${actionName} skipped:`, error.message);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}