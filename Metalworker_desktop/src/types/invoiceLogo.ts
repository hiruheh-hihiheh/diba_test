// src/types/invoiceLogo.ts
//
// The reusable letterhead logos that print in the header of a tax invoice.
//
// WHAT A LOGO IS, AND WHAT IT IS NOT
// A logo is an asset the company owns and reuses. It is NOT part of any bill's
// data, it is not stored per bill, and no uploaded workbook or bill PDF is ever
// modified to add one. A bill carries only a reference to the logo it should
// print, and the PDF is re-rendered from that reference. That is what lets one
// logo be used by hundreds of invoices with the image stored exactly once.
//
// The stored PDF is a snapshot, so a bill also records WHICH logo is actually
// baked into its current documents. The two are allowed to disagree, and that
// disagreement is the signal that a re-print is outstanding — see
// `logo_rendered_logo_id` below. The most common case of that disagreement is
// not an error at all: it is a logo that has just been assigned and whose
// invoices are still being re-printed.

/** The image formats the PDF writer can embed, and so the only ones accepted. */
export const INVOICE_LOGO_MIME_TYPES = ["image/png", "image/jpeg"] as const;

export type InvoiceLogoMimeType = (typeof INVOICE_LOGO_MIME_TYPES)[number];

/** A human label per format, for the picker and for error messages. */
export const INVOICE_LOGO_FORMAT_LABEL: Record<InvoiceLogoMimeType, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
};

/**
 * Ceilings on an uploaded logo, mirroring the edge function's own limits.
 *
 * These exist so an unusable file is refused with a sentence the admin can act
 * on, at the moment they choose it, rather than accepted into the library and
 * then discovered to be unprintable at re-print time. The bucket enforces the
 * MIME types independently; the pixel caps are the renderer's.
 */
export const INVOICE_LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const INVOICE_LOGO_MAX_EDGE = 3000;
export const INVOICE_LOGO_MAX_PIXELS = 4_000_000;

/** One row of the library, as the screens consume it. */
export interface InvoiceLogo {
  id: string;
  /** The admin's name for it. Free text; the library is not a fixed enum. */
  name: string;
  /** Bucket-relative object name in the private `invoice-logos` bucket. */
  storage_path: string;
  /** The admin's original filename, shown for provenance only. */
  file_name: string | null;
  /** Intrinsic pixel size, recorded at upload so layout needs no image load. */
  pixel_width: number | null;
  pixel_height: number | null;
  content_type: string | null;
  byte_size: number | null;
  created_at: string;
  updated_at: string | null;

  /**
   * How many bills currently carry this logo.
   *
   * Always present on a list response, including 0: a new logo renders as an
   * ordinary row rather than needing the client to merge two lists. See
   * `get_invoice_logo_usage` in migration 0011.
   */
  bill_count: number;
}

/**
 * A logo as a bill refers to it, for display next to a bill.
 *
 * Deliberately smaller than `InvoiceLogo`: a bill list embeds this on every row,
 * and nothing there needs the storage path or the byte size. It is also
 * deliberately NOT the same as a count — a bill knows which logo it has, not how
 * many other bills share it.
 */
export interface BillLogoRef {
  id: string;
  name: string;
  storage_path: string;
  pixel_width: number | null;
  pixel_height: number | null;
}

/** A bill's logo state, as the edit screen and preview need it. */
export interface BillLogoState {
  /**
   * Which logo SHOULD print. Null means no logo, which is the state of every
   * bill that existed before this feature.
   */
  logo_id: string | null;
  /**
   * Which logo is actually in the stored PDFs.
   *
   * Equal to `logo_id` means the documents are current. Different means the
   * documents predate the current choice and are being re-printed. This is null on
   * every pre-existing bill, which is correct: they were all printed with no logo.
   */
  logo_rendered_logo_id: string | null;
  /** The embedded logo, present whenever `logo_id` is set. */
  logo: BillLogoRef | null;
}

/** True when the stored documents do not yet match the bill's logo. */
export function billLogoIsStale(state: Pick<BillLogoState, "logo_id" | "logo_rendered_logo_id">): boolean {
  return state.logo_id !== state.logo_rendered_logo_id;
}

/** The result of one assign-or-remove operation over any number of bills. */
export interface BillLogoApplyResult {
  ok: boolean;
  error?: string;
  reason?: string;
  /** Bills whose logo actually changed, and so are now queued for re-printing. */
  assigned: number;
  /** Bills that already had exactly this logo, left untouched and not re-printed. */
  unchanged: number;
  /** Bills re-printed during this call. */
  reprinted: number;
  /**
   * True when more bills are still waiting to be re-printed.
   *
   * The caller repeats the call with no bill ids to drain the next batch. A bill
   * leaves the queue the moment its documents are current, so repeating is the
   * whole of the recovery story — an interrupted job resumes by being repeated.
   */
  more_work: boolean;
  /**
   * Bills that could not be re-printed, each with a reason.
   *
   * Reported rather than hidden: an invoice that quietly printed without its logo
   * is worse than one the admin is told about, and the assignment itself is still
   * correct and still retryable.
   */
  failures: { bill_id: string; invoice_no: string | null; reason: string }[];
}

/** Why a re-print failed, in the admin's words rather than a code. */
export function logoReprintFailureReason(reason: string): string {
  switch (reason) {
    case "logo_unreadable":
      return "its logo image could not be read";
    case "pdf_failed":
      return "the invoice could not be laid out";
    case "storage_failed":
      return "the PDFs could not be saved";
    case "save_failed":
      return "the new PDFs could not be recorded";
    case "bill_missing":
      return "the bill no longer exists";
    default:
      return "it could not be re-printed";
  }
}
