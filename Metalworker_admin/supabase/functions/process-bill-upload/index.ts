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
// bill, so this function writes ONE `bills` row per worksheet. No financial
// figure is ever stored three times over.
//
// ONE DOCUMENT PER BILL, NOT PER WORKBOOK
// This used to render
//
//     renderBillDocument(parsed.map((b) => b[kind]), COPY_LABEL[kind])
//
// which is ONE document containing every invoice in the workbook, and stored its
// path on `bill_uploads`. Every bill then pointed at the same file, so
// "Download Original" on one bill handed back a PDF of all of them, and the only
// way to delete a bill's documents was to delete the whole upload.
//
// The workbook is the SOURCE. The invoice is the RECORD. So each bill now gets
// its own three documents, named after it, and its own three columns
// (migration 0007):
//
//     <upload-id>/<bill-id>_<token>_original.pdf
//     <upload-id>/<bill-id>_<token>_duplicate.pdf
//     <upload-id>/<bill-id>_<token>_triplicate.pdf
//
// The bill's id is in the path, so two invoices can never collide. The three
// copies are still three renderings of ONE invoice — 20 sheets produce 20 bills
// and 60 documents, not 60 bills.
//
// The aggregate "whole workbook" documents are STILL produced and still stored on
// `bill_uploads`, clearly separate, so a user who wants every invoice in one file
// can have it. Nothing that reads a single bill ever touches them.
//
// ORDER OF OPERATIONS (deliberate)
//   method -> environment -> authentication -> ACTIVE-ADMIN check -> body parse
// Authorization is settled before a single byte of the uploaded workbook is
// read, so an unauthenticated caller cannot use this as a file parser.
//
// The import itself lives in `_shared/importWorkbook.ts`:
//   1. classify every sheet as a Tax Invoice or a Delivery Challan from its
//      printed title (checked against its item table), and decide: reject an
//      unrecognised sheet or a workbook uploaded into the wrong section, ask the
//      admin to confirm a mixed workbook, or import;
//   2. parse every sheet with its own document parser and read the profile -
//      all BEFORE anything is written, so a rejection leaves nothing behind;
//   3. per document type, as its own logical upload: insert the upload row and
//      bills, render + upload THREE documents per bill, then the group's own
//      aggregate documents, and mark the upload completed.
//
// The bill rows are written BEFORE the PDFs because the filename contains the
// bill's id, which only exists once the row does. Any failure in any group
// unwinds every group: rows deleted, uploaded objects removed.

import { createClient } from "npm:@supabase/supabase-js@2";

import type { CopyKind } from "./_shared/parseBill.ts";
import { isDocumentType } from "./_shared/documentType.ts";
import { importWorkbook, type ImportPorts } from "./_shared/importWorkbook.ts";
import { loadActiveBusinessProfile } from "./_shared/businessProfileDb.ts";

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

type Client = ReturnType<typeof createClient>;

/** The real database and storage behind `importWorkbook`. */
function supabasePorts(adminClient: Client, user: { id: string; user_metadata?: { username?: string } }): ImportPorts {
  return {
    async insertUpload(row) {
      const { data, error } = await adminClient.from("bill_uploads").insert(row).select("id").single();
      if (error || !data) {
        console.error("bill_uploads insert error:", error);
        throw new Error(error?.message ?? "no row");
      }
      return data.id as string;
    },
    async insertBills(rows) {
      const { data, error } = await adminClient.from("bills").insert(rows).select("id");
      if (error || !data) {
        console.error("bills insert error:", error);
        throw new Error(error?.message ?? "no rows");
      }
      return (data as { id: string }[]).map((r) => r.id);
    },
    async insertLineItems(rows) {
      const { error } = await adminClient.from("bill_line_items").insert(rows);
      if (error) {
        console.error("bill_line_items insert error:", error);
        throw new Error(error.message);
      }
    },
    async updateBillPaths(billId, paths: Record<CopyKind, string>) {
      const { error } = await adminClient
        .from("bills")
        .update({ original_pdf_path: paths.original, duplicate_pdf_path: paths.duplicate, triplicate_pdf_path: paths.triplicate })
        .eq("id", billId);
      if (error) {
        console.error("bill path update error:", billId, error);
        throw new Error(error.message);
      }
    },
    async finalizeUpload(uploadId, patch) {
      const { error } = await adminClient.from("bill_uploads").update(patch).eq("id", uploadId);
      if (error) {
        console.error("bill_uploads finalize error:", error);
        throw new Error(error.message);
      }
    },
    async uploadPdf(path, bytes) {
      const { error } = await adminClient.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (error) {
        console.error("Storage upload error:", path, error);
        throw new Error(error.message);
      }
    },
    async removePdfs(paths) {
      const { error } = await adminClient.storage.from(BUCKET).remove(paths);
      if (error) console.warn("Rollback: PDF cleanup failed:", error.message);
    },
    async deleteUpload(uploadId) {
      // Bills and line items cascade from the upload row.
      const { error } = await adminClient.from("bill_uploads").delete().eq("id", uploadId);
      if (error) console.warn("Rollback: upload row cleanup failed:", error.message);
    },
    loadProfile: () => loadActiveBusinessProfile(adminClient),
    async audit(entry) {
      const { error } = await adminClient.from("admin_audit_log").insert({
        actor_id: user.id,
        actor_username: user.user_metadata?.username ?? null,
        action: entry.action,
        target_type: "bill_upload",
        target_id: entry.target_id,
        // `detail` is the column's name (migration 0003); `test-audit-log.ts`
        // fails if the old `metadata` spelling comes back.
        detail: entry.detail,
      });
      if (error) console.warn("Audit log write skipped:", error.message);
    },
    newGroupId: () => crypto.randomUUID(),
    log: (message, detail) => console.error(message, detail === undefined ? "" : JSON.stringify(detail)),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
    // The caller must be authenticated AND an active admin, settled before a
    // single byte of the workbook is read.
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
    // The section the admin uploaded from. A client from before Challan Bills
    // existed sends none, and only ever uploaded Tax Invoices.
    const section = body?.document_type === undefined ? "tax_invoice" : body.document_type;
    if (!isDocumentType(section)) {
      return json({ ok: false, error: "Unknown document type." }, 400);
    }
    const confirmMixed = body?.confirm_mixed === true;

    if (!filename || !contentBase64) {
      return json({ ok: false, error: "Missing 'filename' or 'content_base64'." }, 400);
    }
    if (!/\.xlsx$/i.test(filename)) {
      return json({ ok: false, error: "Only .xlsx workbooks are supported." }, 415);
    }
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

    // "PK\x03\x04" - every .xlsx is a ZIP.
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

    const result = await importWorkbook(supabasePorts(adminClient, user), {
      bytes: fileBytes,
      filename,
      section,
      confirmMixed,
      userId: user.id,
    });
    return json(result.body, result.status);
  } catch (error) {
    console.error("Unexpected process-bill-upload error:", error);
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Unexpected server error." },
      500
    );
  }
});
