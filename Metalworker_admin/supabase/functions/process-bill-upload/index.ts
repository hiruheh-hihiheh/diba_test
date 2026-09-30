// supabase/functions/process-bill-upload
//
// Turns one uploaded tax-invoice .xlsx into three print-ready PDFs plus the
// relational rows that describe them.
//
// WHY THIS RUNS ON THE SERVER
// The browser admin and the mobile admin must produce byte-identical documents
// from the same workbook. Doing the parse and the render here, rather than in
// either client, is the only way to guarantee that without shipping two copies
// of a parser and hoping they stay in step. It also keeps the service-role key
// on the server, and avoids needing LibreOffice, a native converter, or any
// dependency the Deno runtime might not have.
//
// A workbook holds several invoices, each printed three times (ORIGINAL /
// DUPLICATE / TRIPLICATE). Those three blocks are three PHYSICAL COPIES of one
// bill, so this function writes ONE `bills` row per worksheet and three PDF
// objects, each PDF holding one page per invoice. No financial figure is ever
// stored three times over.
//
// ORDER OF OPERATIONS (deliberate)
//   method -> environment -> authentication -> ACTIVE-ADMIN check -> body parse
// Authorization is settled before a single byte of the uploaded workbook is
// read, so an unauthenticated caller cannot use this as a file parser.
//
//   1. insert  bill_uploads  (status 'uploaded')  -> gives us the upload id
//   2. parse    workbook -> one ParsedBill per worksheet
//   3. render   three PDF documents
//   4. upload   three objects into the private `bills` bucket
//   5. insert  one `bills` row + its line items per worksheet
//   6. update  bill_uploads -> 'completed' with the three storage paths
//
// Any failure after step 1 unwinds: the partial rows are deleted and the
// uploaded objects are removed, so a failed upload can never leave an orphaned
// PDF or a half-populated bill behind.

import { createClient } from "npm:@supabase/supabase-js@2";

import { readXlsx } from "./_shared/xlsx.ts";
import {
  BillFormatError,
  COPY_LABEL,
  COPY_ORDER,
  type BillCopy,
  type ParsedBill,
  parseBills,
  sanitizeBaseName,
} from "./_shared/parseBill.ts";
import { renderBillDocument } from "./_shared/renderBill.ts";

/** Private bucket created by migration 0005_bills.sql. */
const BUCKET = "bills";

/** Refuse anything larger than the bucket's own 50 MB limit. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Guards against a decompression bomb in a hostile workbook. */
const MAX_WORKBOOK_BYTES = 64 * 1024 * 1024;

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

/** Decode standard base64 to bytes. Throws on malformed input. */
function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) throw new Error("File content is not valid base64.");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ──────────────────────────────────────────────
   Row mapping
   ────────────────────────────────────────────── */

/**
 * The `bills` row for a worksheet.
 *
 * Values come from the ORIGINAL copy: the three blocks are the same invoice
 * printed three times, and ORIGINAL is the one an auditor treats as the record.
 * The parser cross-checks the copies against each other, so a workbook whose
 * copies disagree is a template problem, not a data-entry one.
 */
function toBillRow(parsed: ParsedBill, uploadId: string): Record<string, unknown> {
  const o = parsed.original;
  return {
    bill_upload_id: uploadId,
    sheet_name: parsed.sheetName,
    invoice_no: o.invoiceNo,
    invoice_date: o.invoiceDate,
    our_challan_no: o.ourChallanNo,
    our_challan_date: o.ourChallanDate,
    your_challan_no: o.yourChallanNo,
    your_challan_date: o.yourChallanDate,
    order_no: o.orderNo,
    order_no_label: o.orderNoLabel,
    order_date: o.orderDate,
    eway_bill_no: o.ewayBillNo,
    place_of_supply: o.placeOfSupply,
    state: o.state,
    state_code: o.stateCode,
    transporter_mode: o.transporterMode,
    vehicle_number: o.vehicleNumber,
    party_gst_no: o.partyGstNo,
    party_name: o.partyName,
    total_quantity: o.totalQuantity,
    amount_before_tax: o.amountBeforeTax,
    cgst: o.cgst,
    sgst: o.sgst,
    igst: o.igst,
    total_gst: o.totalGst,
    amount_after_tax: o.amountAfterTax,
    reverse_charge_gst: o.reverseChargeGst,
    round_off: o.roundOff,
    amount_in_words: o.amountInWords,
    job_kind: o.jobKind,
    seller_name: o.sellerName,
    // The workbook's address cell is a single long string; keep the postal and
    // tax lines alongside it so the detail screen can show the full identity.
    seller_address: [o.sellerTaxLine, o.sellerAddress, o.sellerContact]
      .filter((part): part is string => !!part)
      .join("\n") || null,
    bank_details: o.bankLines.length > 0 ? o.bankLines : null,
    terms: o.termsLines.length > 0 ? o.termsLines.join("\n") : null,
  };
}

function toLineItemRows(
  billId: string,
  items: BillCopy["lineItems"]
): Record<string, unknown>[] {
  return items.map((item) => ({
    bill_id: billId,
    sr_no: item.srNo,
    description: item.description,
    hsn_code: item.hsnCode,
    uom: item.uom,
    quantity: item.quantity,
    rate: item.rate,
    amount: item.amount,
  }));
}

/* ──────────────────────────────────────────────
   Handler
   ────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let uploadId: string | null = null;
  const uploadedPaths: string[] = [];

  try {
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    // ---------------- Environment ----------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing Supabase environment variables");
      return json(
        { ok: false, error: "Server configuration error. Missing Supabase environment variables." },
        500
      );
    }

    // ---------------- Authorization FIRST ----------------
    // Same gate as every other function in this project: the caller must be
    // authenticated AND an active admin. Inactive admins are refused here, not
    // just hidden in the UI, because this function writes to storage.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Not authenticated" }, 401);

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData?.user) {
      console.error("Authentication error:", userError);
      return json({ ok: false, error: "Not authenticated" }, 401);
    }
    // Bound once, so no later use has to re-narrow `userData`.
    const user = userData.user;

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: adminProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || !adminProfile) {
      console.error("Admin profile error:", profileError);
      return json({ ok: false, error: "Admin profile not found." }, 403);
    }
    if (adminProfile.role !== "admin") {
      return json({ ok: false, error: "Admin access only." }, 403);
    }
    if (!adminProfile.is_active) {
      return json({ ok: false, error: "Your admin account is inactive." }, 403);
    }

    // ---------------- Body (only now) ----------------
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const filename = String(body?.filename ?? "").trim();
    const contentBase64 = String(body?.content_base64 ?? "");

    if (!filename || !contentBase64) {
      return json({ ok: false, error: "Missing 'filename' or 'content_base64'." }, 400);
    }
    // The extension is the client's cheap first gate; the ZIP signature below is
    // the real one, so a renamed .xls or a .txt is refused regardless.
    if (!/\.xlsx$/i.test(filename)) {
      return json({ ok: false, error: "Only .xlsx workbooks are supported." }, 415);
    }
    // Reject before decoding: base64 inflates by 4/3, and we hold the decoded
    // bytes in memory.
    if (contentBase64.length * 0.75 > MAX_UPLOAD_BYTES) {
      return json({ ok: false, error: "That workbook is larger than 50 MB." }, 413);
    }

    let fileBytes: Uint8Array;
    try {
      fileBytes = base64ToBytes(contentBase64);
    } catch (err) {
      return json(
        { ok: false, error: err instanceof Error ? err.message : "Could not read the file." },
        400
      );
    }

    // "PK\x03\x04" - every .xlsx is a ZIP, so this rejects .xls, .csv and .pdf
    // renamed to .xlsx before any parsing is attempted.
    if (fileBytes.length < 4 || fileBytes[0] !== 0x50 || fileBytes[1] !== 0x4b) {
      return json(
        {
          ok: false,
          error:
            "That file could not be read as an Excel workbook. Please upload the original .xlsx file.",
        },
        415
      );
    }
    if (fileBytes.length > MAX_WORKBOOK_BYTES) {
      return json({ ok: false, error: "That workbook is too large to process." }, 413);
    }

    // ---------------- 1. Reserve the upload row ----------------
    const baseName = sanitizeBaseName(filename);
    const { data: uploadRow, error: uploadError } = await adminClient
      .from("bill_uploads")
      .insert({
        original_filename: filename,
        base_name: baseName,
        status: "uploaded",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (uploadError || !uploadRow) {
      console.error("bill_uploads insert error:", uploadError);
      return json({ ok: false, error: "Could not start the bill upload." }, 500);
    }
    uploadId = uploadRow.id as string;

    // ---------------- 2. Parse ----------------
    let parsed: ParsedBill[];
    try {
      const workbook = await readXlsx(fileBytes);
      parsed = parseBills(workbook.sheets).bills;
    } catch (err) {
      if (err instanceof BillFormatError) {
        // A format problem is the uploader's to fix, so it is a 422 with the
        // sheet name they need to look at - not a generic 500.
        await rollback(adminClient, uploadId, uploadedPaths);
        uploadId = null;
        return json({ ok: false, error: err.message, reason: "unrecognized_format" }, 422);
      }
      console.error("Workbook parse error:", err);
      await rollback(adminClient, uploadId, uploadedPaths);
      uploadId = null;
      return json(
        {
          ok: false,
          error: "That workbook could not be opened. It may be corrupt or password protected.",
          reason: "unreadable_workbook",
        },
        422
      );
    }

    // ---------------- 3. Render ----------------
    let pdfs: { kind: (typeof COPY_ORDER)[number]; path: string; bytes: Uint8Array }[];
    try {
      pdfs = COPY_ORDER.map((kind) => ({
        kind,
        path: `${uploadId}/${baseName}_${kind}.pdf`,
        bytes: renderBillDocument(
          parsed.map((b) => b[kind]),
          COPY_LABEL[kind]
        ),
      }));
    } catch (err) {
      console.error("PDF render error:", err);
      await rollback(adminClient, uploadId, uploadedPaths);
      uploadId = null;
      return json(
        { ok: false, error: "The bill PDFs could not be generated.", reason: "pdf_failed" },
        500
      );
    }

    // ---------------- 4. Upload the PDFs ----------------
    for (const pdf of pdfs) {
      const { error } = await adminClient.storage
        .from(BUCKET)
        .upload(pdf.path, pdf.bytes, { contentType: "application/pdf", upsert: false });
      if (error) {
        console.error("Storage upload error:", pdf.path, error);
        uploadedPaths.push(pdf.path);
        await rollback(adminClient, uploadId, uploadedPaths);
        uploadId = null;
        return json(
          { ok: false, error: "The bill PDFs could not be saved.", reason: "storage_failed" },
          500
        );
      }
      uploadedPaths.push(pdf.path);
    }

    // ---------------- 5. Insert bills + line items ----------------
    const billRows = parsed.map((p) => toBillRow(p, uploadId as string));
    const { data: insertedBills, error: billsError } = await adminClient
      .from("bills")
      .insert(billRows)
      .select("id, sheet_name");

    if (billsError || !insertedBills) {
      console.error("bills insert error:", billsError);
      await rollback(adminClient, uploadId, uploadedPaths);
      uploadId = null;
      return json(
        { ok: false, error: "The bill records could not be saved.", reason: "save_failed" },
        500
      );
    }

    // Line items are inserted per bill rather than in one batch so a single
    // malformed sheet cannot roll the whole upload back.
    const insertedIds = (insertedBills as { id: string; sheet_name: string }[]).map((b) => b.id);
    for (const [i, p] of parsed.entries()) {
      const lines = toLineItemRows(insertedIds[i], p.original.lineItems);
      if (lines.length === 0) continue;
      const { error: linesError } = await adminClient.from("bill_line_items").insert(lines);
      if (linesError) {
        console.error("bill_line_items insert error:", linesError);
        await rollback(adminClient, uploadId, uploadedPaths);
        uploadId = null;
        return json(
          { ok: false, error: "The bill line items could not be saved.", reason: "save_failed" },
          500
        );
      }
    }

    // ---------------- 6. Finalize the upload row ----------------
    const pathFor = (kind: (typeof COPY_ORDER)[number]): string =>
      `${uploadId}/${baseName}_${kind}.pdf`;
    const { error: finalizeError } = await adminClient
      .from("bill_uploads")
      .update({
        status: "completed",
        invoice_count: insertedIds.length,
        original_pdf_path: pathFor("original"),
        duplicate_pdf_path: pathFor("duplicate"),
        triplicate_pdf_path: pathFor("triplicate"),
      })
      .eq("id", uploadId as string);

    if (finalizeError) {
      console.error("bill_uploads finalize error:", finalizeError);
      await rollback(adminClient, uploadId, uploadedPaths);
      uploadId = null;
      return json(
        { ok: false, error: "The bill upload could not be finalized.", reason: "save_failed" },
        500
      );
    }

    // ---------------- Audit (never blocks the write) ----------------
    // Written server-side with the service role, so the entry is still recorded
    // under the forged-row policy from 0003. A failure here is logged and
    // ignored: losing an audit line must not lose the upload.
    const { error: auditError } = await adminClient.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_username: user.user_metadata?.username ?? null,
      action: "bill.uploaded",
      target_type: "bill_upload",
      target_id: uploadId as string,
      metadata: {
        filename,
        invoice_count: insertedIds.length,
        invoice_nos: parsed.map((p) => p.original.invoiceNo),
      },
    });
    if (auditError) console.warn("Audit log write skipped:", auditError.message);

    return json({
      ok: true,
      upload_id: uploadId,
      base_name: baseName,
      invoice_count: insertedIds.length,
      bills: (insertedBills as { id: string; sheet_name: string }[]).map((b) => ({
        id: b.id,
        sheet_name: b.sheet_name,
      })),
      pdfs: COPY_ORDER.map((kind) => ({
        copy: kind,
        label: COPY_LABEL[kind],
        path: pathFor(kind),
        filename: `${baseName}_${kind}.pdf`,
      })),
    });
  } catch (error) {
    console.error("Unexpected process-bill-upload error:", error);
    if (uploadId) {
      // Best effort: the env vars are in scope here, so build a client for the
      // unwind. A failure to clean up is logged, never surfaced as a new error.
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseServiceRoleKey) {
        await rollback(createClient(supabaseUrl, supabaseServiceRoleKey), uploadId, uploadedPaths);
      }
    }
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected server error." },
      500
    );
  }
});

/**
 * Undo a partially-completed upload.
 *
 * `bills` and `bill_line_items` cascade from `bill_uploads`, so deleting the
 * upload row removes the bills and their lines in one statement; the PDFs then
 * go from storage. Every step is independent and best-effort, because this runs
 * on the failure path where the real error must still be reported.
 */
async function rollback(
  adminClient: ReturnType<typeof createClient>,
  uploadId: string,
  uploadedPaths: string[]
): Promise<void> {
  if (uploadedPaths.length > 0) {
    const { error } = await adminClient.storage.from(BUCKET).remove(uploadedPaths);
    if (error) console.warn("Rollback: PDF cleanup failed:", error.message);
  }
  const { error } = await adminClient.from("bill_uploads").delete().eq("id", uploadId);
  if (error) console.warn("Rollback: upload row cleanup failed:", error.message);
}
