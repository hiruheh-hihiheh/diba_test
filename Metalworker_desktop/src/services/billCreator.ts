// Metalworker_desktop/src/services/billCreator.ts
//
// The Bill Creator's network layer: four calls to one `create-bill` edge function.
//
// WHY ONE FUNCTION AND FOUR ACTIONS
//
// Save, preview and finalize share almost everything — the same validation, the same
// `computeBillValues`, the same read-back, the same renderer. Splitting them into three
// endpoints would mean three places where a bug in the shared part has to be found
// three times, and would make "preview shows what finalize produces" a thing to be
// re-established rather than a structural property. Here it is structural: preview is
// the same code path with the upload step skipped.
//
// WHAT THE CLIENT IS NOT ALLOWED TO DO
//
// It does not compute a total to store, decide whether the invoice number is a duplicate,
// choose a PDF path, or mark a bill finalized. Every one of those is a decision about a
// financial document, and every one is made on the server from the saved row. What the
// client sends is what the admin typed; what it gets back is what the server decided.
//
// IT IS A MIRROR, NOT A SECOND IMPLEMENTATION
//
// One copy per app, byte-identical apart from the two lines that cannot be: the
// `supabase` import path, and the popup in `openCreatorPreview` — which a phone has no
// use for. Everything else, including the request body, is shared, so a bill created on
// a phone and one created at a desk are the same bill. `test-bill-creator.ts` runs both
// copies over the same input and requires the same body out.
//
// THE DUPLICATE-NUMBER CASE IS THE INTERESTING ONE
//
// The server answers a finalize with 409 and the list of bills already using that
// number, and the draft is still saved. So the client shows the list, and on
// confirmation re-sends the same finalize with `confirm_duplicate_invoice_no`. No second
// request, no re-sending of the form, no state to rebuild: the draft the admin is looking
// at is already the draft that would be finalized.
//
// IT IS A MIRROR, NOT A SECOND IMPLEMENTATION
//
// One copy per app, byte-identical apart from the two lines that cannot be: the
// `supabase` import path, and the popup in `openCreatorPreview` — which a phone has no
// use for and which the Expo copy answers with the same download the desktop one falls
// back to. Everything else, including the request body, is shared, so a bill created on
// a phone and one created at a desk are the same bill. `test-bill-creator.ts` runs both
// copies over the same input and requires the same body out.

import {
  LIKELY_TO_CHANGE_FIELDS,
  buildPatch,
  creatorTotals,
  lineAmount,
  readBank,
  readBankLines,
  readNumber,
  termsToPatch,
  type BankDetails,
  type CreatorFormValues,
  type CreatorLineDraft,
} from "./creatorForm";

import { supabase } from "../lib/supabase";

/* ──────────────────────────────────────────────
   What comes back
   ────────────────────────────────────────────── */

/** One bill that already uses an invoice number the admin has just typed. */
export interface CreatorDuplicate {
  bill_id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  sheet_name: string | null;
  party_name: string | null;
  status: string | null;
}

export interface CreatorFieldProblem {
  field: string;
  message: string;
}

/** One produced document. Its path is a private-storage key, never a public URL. */
export interface CreatorPdf {
  copy: "original" | "duplicate" | "triplicate";
  label: string;
  path: string;
  filename: string;
}

/**
 * Raised when the server refuses, with enough attached for the form to react rather than
 * just print a message.
 *
 * `field` is the input the server blamed, so the message can go beside that input instead
 * of in a banner nobody connects to the box they are looking at. `duplicates` is only
 * present for a duplicate invoice number, and it is what turns a hard stop into a
 * question: "this number is already used — is that intended?"
 */
export class CreatorError extends Error {
  readonly reason: string | null;
  readonly field: string | null;
  readonly problems: CreatorFieldProblem[];
  readonly duplicates: CreatorDuplicate[];
  /** The draft, when the server managed to save one before refusing. Never lost. */
  readonly billId: string | null;

  constructor(
    message: string,
    options: {
      reason?: string | null;
      field?: string | null;
      problems?: CreatorFieldProblem[];
      duplicates?: CreatorDuplicate[];
      billId?: string | null;
    } = {}
  ) {
    super(message);
    this.name = "CreatorError";
    this.reason = options.reason ?? null;
    this.field = options.field ?? null;
    this.problems = options.problems ?? [];
    this.duplicates = options.duplicates ?? [];
    this.billId = options.billId ?? null;
  }

  /** True when re-sending with the duplicate confirmed would be the next step. */
  get isDuplicateInvoiceNo(): boolean {
    return this.reason === "duplicate_invoice_no";
  }
}

export interface CreatorDraftRef {
  bill_id: string;
  status: "draft" | "finalized";
  amount_after_tax: number | null;
  amount_in_words: string | null;
}

export interface CreatorSaveResult extends CreatorDraftRef {
  /** True when this call created the draft rather than updating an existing one. */
  created: boolean;
  /** Present only on `save`; the ISO instant the row was written. */
  saved_at?: string;
}

export interface CreatorPreviewResult extends CreatorDraftRef {
  /** The ORIGINAL, base64. Only ever in memory — nothing is written to storage. */
  pdf_base64: string;
  filename: string;
}

export interface CreatorFinalizeResult extends CreatorDraftRef {
  pdf_version: number;
  jobs_linked: boolean;
  jobs_error: string | null;
  folder_linked: boolean;
  duplicate_invoice_no: CreatorDuplicate[] | null;
  pdfs: CreatorPdf[];
}

/* ──────────────────────────────────────────────
   The request
   ────────────────────────────────────────────── */

export interface CreatorRequest {
  /** Omitted on the first save; the server then creates the draft and returns its id. */
  billId?: string | null;
  /**
   * The bill being copied, for the audit trail and to inherit its profile snapshot.
   * Never trusted for anything else: the values are re-seeded from the form, not read
   * from the source at render time.
   */
  sourceBillId?: string | null;
  /** The `[ ] Use current Invoice Business Profile` box. */
  useCurrentProfile?: boolean;
  values: CreatorFormValues;
  lines?: readonly CreatorLineDraft[];
  amountInWords?: string;
  reverseChargeGst?: string | null;
  roundOff?: string | null;
  bank?: BankDetails | string[] | string | null;
  /**
   * The idempotency token for creating a draft. Generated once per form and reused for
   * every save, so a retried request — a flaky connection, an impatient double-click —
   * updates one bill instead of creating two.
   */
  draftKey?: string;
  logoId?: string | null;
  folderId?: string | null;
  jobIds?: readonly string[];
  confirmDuplicateInvoiceNo?: boolean;
}

/**
 * Build the body the function expects.
 *
 * Exported because it is worth testing directly: the mapping from a form to a patch is
 * where a field silently goes missing, and asserting on the whole body is easier to read
 * than asserting on four separate calls.
 *
 * A `logoId` of `undefined` means "leave the letterhead alone" and `null` means "print
 * without one". Those are different instructions and the distinction survives all the way
 * to the server, so it is preserved here rather than collapsed into falsy checks.
 */
export function buildCreatorBody(request: CreatorRequest, action: "save" | "preview" | "finalize") {
  const body: Record<string, unknown> = {
    action,
    patch: buildPatch({
      values: request.values,
      lines: request.lines,
      amountInWords: request.amountInWords,
      reverseChargeGst: request.reverseChargeGst,
      roundOff: request.roundOff,
    }),
  };
  if (request.billId) body.bill_id = request.billId;
  if (request.sourceBillId) body.source_bill_id = request.sourceBillId;
  if (request.useCurrentProfile !== undefined) {
    body.use_current_profile = request.useCurrentProfile;
  }
  if (request.draftKey) body.patch = { ...(body.patch as object), creator_draft_key: request.draftKey };
  if (request.logoId !== undefined) body.logo_id = request.logoId;
  if (request.folderId !== undefined) body.folder_id = request.folderId;
  if (request.jobIds !== undefined) body.job_ids = [...request.jobIds];
  if (request.confirmDuplicateInvoiceNo) body.confirm_duplicate_invoice_no = true;
  /* The bank rides inside the patch rather than beside it, because `applyPatch` is what
     validates and normalises it. Sending it separately would mean a second, unvalidated
     path to a column that the editor already knows how to write. */
  const bank = readBank(request.bank ?? null);
  if (bank) body.patch = { ...(body.patch as object), bank_details: bank };
  const terms = termsToPatch([
    request.values.term_1 ?? "",
    request.values.term_2 ?? "",
    request.values.term_3 ?? "",
  ]);
  if (terms) body.patch = { ...(body.patch as object), terms };
  return body;
}

interface CreatorWireResponse {
  ok?: boolean;
  error?: string;
  reason?: string;
  field?: string;
  errors?: CreatorFieldProblem[];
  bill_id?: string;
  created?: boolean;
  status?: "draft" | "finalized";
  saved_at?: string;
  amount_after_tax?: number | null;
  amount_in_words?: string | null;
  duplicates?: CreatorDuplicate[];
  duplicate_invoice_no?: CreatorDuplicate[] | null;
  pdf_base64?: string;
  filename?: string;
  pdf_version?: number;
  jobs_linked?: boolean;
  jobs_error?: string | null;
  folder_linked?: boolean;
  pdfs?: CreatorPdf[];
}

/**
 * Read the server's explanation out of a failed response.
 *
 * A non-2xx from an edge function carries its JSON body in `error.context`, and that body
 * is the ONLY place the specific reason lives — which field was rejected, or that the
 * documents could not be produced and nothing was changed. Without this the form shows a
 * generic failure for every refusal, including a duplicate invoice number the admin needs
 * to see in order to answer.
 */
async function readCreatorErrorBody(error: {
  context?: unknown;
  message?: string;
}): Promise<CreatorWireResponse | null> {
  try {
    const ctx = error.context;
    if (ctx && typeof (ctx as Response).text === "function") {
      const text = await (ctx as Response).text();
      if (!text) return null;
      const parsed = JSON.parse(text) as CreatorWireResponse;
      return parsed && typeof parsed === "object" ? parsed : null;
    }
  } catch {
    /* An unparseable body is not worth failing over; the transport message is still
       worth showing. */
  }
  return null;
}

async function callCreator(
  action: "save" | "preview" | "finalize",
  request: CreatorRequest
): Promise<CreatorWireResponse> {
  const { data, error } = await supabase.functions.invoke<CreatorWireResponse>(
    "create-bill",
    { body: buildCreatorBody(request, action) }
  );

  if (error) {
    const body = await readCreatorErrorBody(error);
    throw new CreatorError(body?.error ?? error.message ?? "The bill could not be saved.", {
      reason: body?.reason ?? "network",
      field: body?.field ?? null,
      problems: body?.errors ?? [],
      duplicates: body?.duplicates ?? [],
      billId: body?.bill_id ?? null,
    });
  }
  if (!data?.ok) {
    throw new CreatorError(data?.error ?? "The bill could not be saved.", {
      reason: data?.reason ?? null,
      field: data?.field ?? null,
      problems: data?.errors ?? [],
      duplicates: data?.duplicates ?? [],
      billId: data?.bill_id ?? null,
    });
  }
  return data;
}

/* ──────────────────────────────────────────────
   The four actions
   ────────────────────────────────────────────── */

function draftRef(data: CreatorWireResponse, fallbackId: string | null): CreatorDraftRef {
  return {
    bill_id: data.bill_id ?? fallbackId ?? "",
    status: data.status ?? "draft",
    amount_after_tax: data.amount_after_tax ?? null,
    amount_in_words: data.amount_in_words ?? null,
  };
}

/** Write the form's values onto the draft. No documents, nothing irreversible. */
export async function saveCreatorDraft(request: CreatorRequest): Promise<CreatorSaveResult> {
  const data = await callCreator("save", request);
  return { ...draftRef(data, request.billId ?? null), created: data.created === true, saved_at: data.saved_at };
}

/**
 * Render the saved draft and hand back the ORIGINAL.
 *
 * The bytes come from the server's real renderer reading the SAVED row — not from the
 * form — so this is a print of what would be finalized rather than an approximation of
 * it. Nothing is written to storage, which is why a preview cannot leave an orphaned
 * document behind no matter how many times it is opened.
 */
export async function previewCreatorDraft(request: CreatorRequest): Promise<CreatorPreviewResult> {
  const data = await callCreator("preview", request);
  return {
    ...draftRef(data, request.billId ?? null),
    pdf_base64: data.pdf_base64 ?? "",
    filename: data.filename ?? "invoice.pdf",
  };
}

/**
 * Validate, render all three copies, store them, and mark the bill finalized.
 *
 * All of it or none of it: if any step fails the draft is still a draft with no documents
 * and the admin's work is intact. A bill that reports success here has three files in
 * private storage and a row pointing at all three.
 */
export async function finalizeCreatorDraft(request: CreatorRequest): Promise<CreatorFinalizeResult> {
  const data = await callCreator("finalize", request);
  return {
    ...draftRef(data, request.billId ?? null),
    pdf_version: data.pdf_version ?? 1,
    jobs_linked: data.jobs_linked !== false,
    jobs_error: data.jobs_error ?? null,
    folder_linked: data.folder_linked !== false,
    duplicate_invoice_no: data.duplicate_invoice_no ?? null,
    pdfs: data.pdfs ?? [],
  };
}

/** What happened when a preview was shown, so the caller can say so rather than guess. */
export type PreviewOpenResult = "opened" | "downloaded" | "failed";

/**
 * Show a preview's PDF without touching the network for it.
 *
 * A preview is base64 from the server, already in memory, and a blob URL is the only
 * honest way to show it: a `data:` URL long enough to hold a PDF is refused by several
 * browsers, and re-fetching the bytes from storage would be a second request for
 * something we are already holding.
 *
 * Falls back to downloading when the popup is blocked, because "nothing happened" is the
 * one outcome an admin cannot act on. A blocked popup is a browser policy, not a failure
 * of the preview, and the file is still correct — so the fallback is a real download
 * rather than an error message.
 *
 * Returns what it did instead of showing a message itself, so the form decides where that
 * message goes and the two apps can say it in their own words.
 */
export function openCreatorPreview(base64: string, filename: string): PreviewOpenResult {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return "failed";
  }
  if (bytes.length === 0) return "failed";

  /* A fresh object URL each time. Revoking the previous one is what stops a form left
     open through twenty previews from holding twenty whole PDFs in memory; a form that
     previews repeatedly is normal, not a stress case.

     Copied into a plain `ArrayBuffer` first rather than handed to `Blob` as a
     `Uint8Array`: the two apps compile against different DOM lib versions, and one of
     them types a `BlobPart` as a view over a non-resizable `ArrayBuffer`. A copy that
     satisfies both is a few lines; a `#if` in a service module is not something anyone
     should have to maintain. */
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  const tab = typeof window === "undefined" ? null : window.open(url, "_blank", "noopener");
  if (tab) {
    return "opened";
  }

  /* Blocked, or no window at all — which is the normal case in a phone webview. */
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.click();
    return "downloaded";
  } catch {
    return "failed";
  }
}

/* ──────────────────────────────────────────────
   Re-exported, so a form imports from one place
   ────────────────────────────────────────────── */

export {
  LIKELY_TO_CHANGE_FIELDS,
  buildPatch,
  creatorTotals,
  lineAmount,
  readBank,
  readBankLines,
  readNumber,
  termsToPatch,
  type BankDetails,
  type CreatorFormValues,
  type CreatorLineDraft,
};