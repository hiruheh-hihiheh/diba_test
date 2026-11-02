// supabase/functions/process-bill-upload/_shared/importWorkbook.ts
//
// The workbook import, from bytes to stored bills and PDFs, for both document
// types.
//
// ORDER, AND WHY
//   1. read the workbook and classify every sheet by its printed title;
//   2. decide (`planImport`): reject, ask to confirm a mixed workbook, or import;
//   3. parse every sheet of every group with its own parser;
//   4. read the business profile;
//   — nothing has been written yet; every rejection above leaves no trace —
//   5. import each document type as its own logical upload: upload row, bills,
//      line items, three PDFs per bill, the group's aggregate PDFs;
//   6. if ANY group fails, undo EVERY group created so far (rows and files), so
//      a mixed workbook is imported completely or not at all.
//
// The database and storage are reached through `ImportPorts`, so the whole flow,
// including the cross-group rollback, is exercised by the self-tests without
// Supabase. `process-bill-upload/index.ts` supplies the real ports.

import { readXlsx } from "./xlsx.ts";
import {
  BillFormatError,
  COPY_LABEL,
  COPY_ORDER,
  copyDisagreements,
  parseSheet,
  safeBillToken,
  sanitizeBaseName,
  type BillCopy,
  type CopyKind,
  type DocumentType,
  type ParsedBill,
} from "./parseBill.ts";
import { parseChallanSheet } from "./parseChallan.ts";
import { classifyWorkbook, planImport, SECTION_NAMES } from "./documentType.ts";
import { renderBillDocument } from "./renderBill.ts";
import { toBillRecord } from "./billDocument.ts";
import { profileToSnapshot, type BusinessProfile } from "./businessProfile.ts";

export interface ImportPorts {
  /** Insert a `bill_uploads` row and return its id. */
  insertUpload(row: Record<string, unknown>): Promise<string>;
  /** Insert bills, returning their ids in the order given. */
  insertBills(rows: Record<string, unknown>[]): Promise<string[]>;
  insertLineItems(rows: Record<string, unknown>[]): Promise<void>;
  updateBillPaths(billId: string, paths: Record<CopyKind, string>): Promise<void>;
  finalizeUpload(uploadId: string, patch: Record<string, unknown>): Promise<void>;
  uploadPdf(path: string, bytes: Uint8Array): Promise<void>;
  /** Best effort; failures are logged, never thrown. */
  removePdfs(paths: string[]): Promise<void>;
  /** Best effort; bills and line items cascade from the upload row. */
  deleteUpload(uploadId: string): Promise<void>;
  loadProfile(): Promise<BusinessProfile>;
  /** Best effort; an audit failure never fails an import. */
  audit(entry: { action: string; target_id: string; detail: Record<string, unknown> }): Promise<void>;
  newGroupId(): string;
  log?(message: string, detail?: unknown): void;
}

export interface ImportRequest {
  bytes: Uint8Array;
  filename: string;
  /** The section the admin uploaded from. */
  section: DocumentType;
  /** True once the admin has confirmed splitting a mixed workbook. */
  confirmMixed: boolean;
  userId: string;
}

export interface ImportResponse {
  status: number;
  body: Record<string, unknown>;
}

/** A failure inside one group's import, with the status and reason to report. */
class ImportFailure extends Error {
  readonly status: number;
  readonly reason: string;
  constructor(status: number, reason: string, message: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

interface GroupResult {
  upload_id: string;
  document_type: DocumentType;
  section: string;
  base_name: string;
  invoice_count: number;
  sheets: string[];
  bills: { id: string; sheet_name: string; invoice_no: string | null; job_kind: string | null; paths: Record<CopyKind, string> }[];
  aggregate_pdfs: { copy: CopyKind; label: string; path: string; filename: string; scope: "workbook" }[];
}

function lineItemRows(billId: string, documentType: DocumentType, items: BillCopy["lineItems"]): Record<string, unknown>[] {
  return items.map((item) => ({
    bill_id: billId,
    sr_no: item.srNo,
    description: item.description,
    hsn_code: item.hsnCode,
    uom: item.uom,
    quantity: item.quantity,
    rate: item.rate,
    amount: item.amount,
    // Only a challan has a REMARKS column; an invoice line never carries the key.
    ...(documentType === "delivery_challan" ? { remarks: item.remarks ?? null } : {}),
  }));
}

const GROUP_SUFFIX: Record<DocumentType, string> = {
  tax_invoice: "_tax_invoices",
  delivery_challan: "_delivery_challans",
};

export async function importWorkbook(ports: ImportPorts, req: ImportRequest): Promise<ImportResponse> {
  const log = ports.log ?? (() => {});

  /* ---- 1-2. read, classify, decide: nothing is written ------------------- */
  let sheets;
  try {
    sheets = (await readXlsx(req.bytes)).sheets;
  } catch (err) {
    log("workbook read error", String(err));
    return {
      status: 422,
      body: { ok: false, reason: "unreadable_workbook", error: "That workbook could not be opened. It may be corrupt or password protected." },
    };
  }

  const classification = classifyWorkbook(sheets);
  const plan = planImport(classification, req.section, req.confirmMixed);
  if (plan.action === "reject") {
    return { status: plan.status, body: { ok: false, reason: plan.reason, error: plan.message, ...(plan.detail ?? {}) } };
  }
  if (plan.action === "confirm_mixed") {
    return {
      status: 409,
      body: { ok: false, reason: "mixed_workbook", needs_confirmation: true, error: plan.message, preview: plan.preview },
    };
  }

  /* ---- 3. parse every sheet of every group ------------------------------- */
  const groups: { documentType: DocumentType; sheetIndexes: number[]; parsed: ParsedBill[] }[] = [];
  try {
    for (const g of plan.groups) {
      const parse = g.documentType === "delivery_challan" ? parseChallanSheet : parseSheet;
      groups.push({ ...g, parsed: g.sheetIndexes.map((i) => parse(sheets[i])) });
    }
  } catch (err) {
    if (err instanceof BillFormatError) {
      return { status: 422, body: { ok: false, reason: "unrecognized_format", error: err.message, sheet: err.sheetName } };
    }
    throw err;
  }

  /* ---- 4. the defaults every bill of this upload is printed with --------- */
  let profile: BusinessProfile;
  try {
    profile = await ports.loadProfile();
  } catch (err) {
    log("business profile read error", String(err));
    return {
      status: 500,
      body: { ok: false, reason: "profile_unreadable", error: "The invoice business profile could not be read, so the bills were not saved." },
    };
  }

  /* ---- 5-6. import each group; undo all of them on any failure ----------- */
  const sourceGroupId = plan.mixed ? ports.newGroupId() : null;
  const created: { uploadId: string; paths: string[] }[] = [];
  const results: GroupResult[] = [];
  try {
    for (const g of groups) {
      results.push(await importGroup(ports, req, g, profile, sourceGroupId, plan.mixed, created));
    }
  } catch (err) {
    for (const c of created) {
      if (c.paths.length > 0) await ports.removePdfs(c.paths);
      await ports.deleteUpload(c.uploadId);
    }
    if (err instanceof ImportFailure) {
      return { status: err.status, body: { ok: false, reason: err.reason, error: err.message } };
    }
    log("unexpected import error", String(err));
    return { status: 500, body: { ok: false, reason: "import_failed", error: err instanceof Error ? err.message : "Unexpected server error." } };
  }

  for (const [i, r] of results.entries()) {
    const parsed = groups[i].parsed;
    const disagreements = parsed.map((p) => ({ sheet: p.sheetName, fields: copyDisagreements(p) })).filter((d) => d.fields.length > 0);
    await ports.audit({
      action: "bill.uploaded",
      target_id: r.upload_id,
      detail: {
        filename: req.filename,
        document_type: r.document_type,
        source_group_id: sourceGroupId,
        invoice_count: r.invoice_count,
        invoice_nos: parsed.map((p) => p.original.invoiceNo),
        job_kinds: parsed.map((p) => p.original.jobKind),
        documents_per_bill: 3,
        synthesized_copies: parsed
          .filter((p) => p.sourceCopies.length < COPY_ORDER.length)
          .map((p) => ({
            sheet: p.sheetName,
            canonical: p.canonicalKind,
            source_copies: p.sourceCopies,
            generated_copies: COPY_ORDER.filter((k) => !p.sourceCopies.includes(k)),
          })),
        copy_disagreements: disagreements,
      },
    });
  }

  // The group for the section the admin uploaded from is also returned in the
  // response's top-level fields, so a client that predates mixed workbooks still
  // reads a correct single-upload answer.
  const primary = results.find((r) => r.document_type === req.section) ?? results[0];
  return {
    status: 200,
    body: {
      ok: true,
      mixed: plan.mixed,
      source_group_id: sourceGroupId,
      uploads: results,
      upload_id: primary.upload_id,
      document_type: primary.document_type,
      base_name: primary.base_name,
      invoice_count: primary.invoice_count,
      bills: primary.bills,
      aggregate_pdfs: primary.aggregate_pdfs,
    },
  };
}

async function importGroup(
  ports: ImportPorts,
  req: ImportRequest,
  group: { documentType: DocumentType; sheetIndexes: number[]; parsed: ParsedBill[] },
  profile: BusinessProfile,
  sourceGroupId: string | null,
  mixed: boolean,
  created: { uploadId: string; paths: string[] }[]
): Promise<GroupResult> {
  const { documentType, sheetIndexes, parsed } = group;
  const baseName = sanitizeBaseName(req.filename) + (mixed ? GROUP_SUFFIX[documentType] : "");

  let uploadId: string;
  try {
    uploadId = await ports.insertUpload({
      original_filename: req.filename,
      base_name: baseName,
      status: "uploaded",
      created_by: req.userId,
      document_type: documentType,
      source_group_id: sourceGroupId,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    ports.log?.("bill_uploads insert error", detail);
    throw new ImportFailure(500, "save_failed", `Could not start the bill upload.${detail ? ` (${detail})` : ""}`);
  }
  const mine = { uploadId, paths: [] as string[] };
  created.push(mine);

  const upload = async (path: string, bytes: Uint8Array): Promise<void> => {
    // Recorded before the attempt, so a half-written object is still cleaned up.
    mine.paths.push(path);
    try {
      await ports.uploadPdf(path, bytes);
    } catch {
      throw new ImportFailure(500, "storage_failed", "The bill PDFs could not be saved.");
    }
  };

  /* Bills, in worksheet order. `sheet_order` is the sheet's position in the
     SOURCE workbook, so each group keeps the original order and a sheet can be
     traced back to its place in the file even after a mixed workbook is split. */
  const snapshot = profileToSnapshot(profile);
  const billRows = parsed.map((p, i) => ({
    ...toBillRecord(p, uploadId),
    sheet_order: sheetIndexes[i] + 1,
    business_profile_snapshot: Object.keys(snapshot).length > 0 ? snapshot : null,
  }));
  let billIds: string[];
  try {
    billIds = await ports.insertBills(billRows);
    if (billIds.length !== parsed.length) throw new Error("bill count mismatch");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    ports.log?.("bills insert error", detail);
    throw new ImportFailure(500, "save_failed", `The bill records could not be saved.${detail ? ` (${detail})` : ""}`);
  }

  for (const [i, p] of parsed.entries()) {
    const lines = lineItemRows(billIds[i], documentType, p.original.lineItems);
    if (lines.length === 0) continue;
    try {
      await ports.insertLineItems(lines);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      ports.log?.("bill_line_items insert error", detail);
      throw new ImportFailure(500, "save_failed", `The bill line items could not be saved.${detail ? ` (${detail})` : ""}`);
    }
  }

  const bills: GroupResult["bills"] = [];
  for (const [i, p] of parsed.entries()) {
    const billId = billIds[i];
    const base = `${uploadId}/${billId}_${safeBillToken(p.original.invoiceNo, p.sheetName)}_v1`;
    const paths: Record<CopyKind, string> = {
      original: `${base}_original.pdf`,
      duplicate: `${base}_duplicate.pdf`,
      triplicate: `${base}_triplicate.pdf`,
    };
    for (const kind of COPY_ORDER) {
      let bytes: Uint8Array;
      try {
        // All three copies from the canonical block; only the designation differs.
        bytes = renderBillDocument([p.original], COPY_LABEL[kind], null, profile);
      } catch (err) {
        ports.log?.("PDF render error", { billId, kind, error: String(err) });
        throw new ImportFailure(500, "pdf_failed", "The bill PDFs could not be generated.");
      }
      await upload(paths[kind], bytes);
    }
    try {
      await ports.updateBillPaths(billId, paths);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      ports.log?.("bill path update error", detail);
      throw new ImportFailure(500, "save_failed", `The bill documents could not be linked to the bill.${detail ? ` (${detail})` : ""}`);
    }
    bills.push({ id: billId, sheet_name: p.sheetName, invoice_no: p.original.invoiceNo, job_kind: p.original.jobKind, paths });
  }

  /* The group's own aggregate: one document per copy holding only this group's
     bills, so a mixed workbook never becomes one mixed PDF. A failure here is not
     fatal — the bills are complete; only the convenience document is missing. */
  const aggregatePaths: Record<CopyKind, string> = {
    original: `${uploadId}/${baseName}_original.pdf`,
    duplicate: `${uploadId}/${baseName}_duplicate.pdf`,
    triplicate: `${uploadId}/${baseName}_triplicate.pdf`,
  };
  const written: CopyKind[] = [];
  for (const kind of COPY_ORDER) {
    try {
      const bytes = renderBillDocument(parsed.map((b) => b[kind]), COPY_LABEL[kind], null, profile);
      mine.paths.push(aggregatePaths[kind]);
      await ports.uploadPdf(aggregatePaths[kind], bytes);
      written.push(kind);
    } catch (err) {
      ports.log?.("aggregate PDF error", { kind, error: String(err) });
    }
  }

  try {
    await ports.finalizeUpload(uploadId, {
      status: "completed",
      invoice_count: billIds.length,
      original_pdf_path: written.includes("original") ? aggregatePaths.original : null,
      duplicate_pdf_path: written.includes("duplicate") ? aggregatePaths.duplicate : null,
      triplicate_pdf_path: written.includes("triplicate") ? aggregatePaths.triplicate : null,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    ports.log?.("bill_uploads finalize error", detail);
    throw new ImportFailure(500, "save_failed", `The bill upload could not be finalized.${detail ? ` (${detail})` : ""}`);
  }

  return {
    upload_id: uploadId,
    document_type: documentType,
    section: SECTION_NAMES[documentType],
    base_name: baseName,
    invoice_count: billIds.length,
    sheets: parsed.map((p) => p.sheetName),
    bills,
    aggregate_pdfs: written.map((kind) => ({
      copy: kind,
      label: COPY_LABEL[kind],
      path: aggregatePaths[kind],
      filename: `${baseName}_${kind}.pdf`,
      scope: "workbook" as const,
    })),
  };
}
