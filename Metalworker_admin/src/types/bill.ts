// src/types/bill.ts
//
// Types for the Bills section: tax-invoice workbooks uploaded as .xlsx and
// rendered server-side into three print-ready PDFs (original / duplicate /
// triplicate).
//
// Do not confuse these with `billGroup.ts`, which is the older "Group Bills"
// feature holding photo groups. That one is untouched; this file is new.
//
// The three copies are three PRINT COPIES of one bill, never three bills, so
// every financial column below is per-invoice and already counted once.

/** The three print copies. Order is fixed: it is the print order of a triplicate book. */
export type BillCopy = "original" | "duplicate" | "triplicate";

export const BILL_COPIES: readonly BillCopy[] = ["original", "duplicate", "triplicate"] as const;

/** Human label printed on the copy itself and used in every button and column. */
export const BILL_COPY_LABEL: Record<BillCopy, string> = {
  original: "Original",
  duplicate: "Duplicate",
  triplicate: "Triplicate",
};

/** `bills.bill_upload_id` -> `bill_uploads`. */
export interface BillUpload {
  id: string;
  original_filename: string;
  base_name: string;
  status: "uploaded" | "completed" | "failed";
  /** Bucket-relative object names, i.e. "<upload-id>/SAMPLE_original.pdf". */
  original_pdf_path: string | null;
  duplicate_pdf_path: string | null;
  triplicate_pdf_path: string | null;
  invoice_count: number;
  created_by: string | null;
  created_at: string;
}

/**
 * A `bills` row joined with the three fields of its upload needed for display.
 *
 * `supabase.from("bills").select("*, bill_uploads(...)")` produces this shape;
 * `bills` alone produces `BillRow` (see the service's internal type).
 */
export interface Bill extends BillColumns {
  bill_upload_id: string;
  sheet_name: string;

  // This bill's OWN documents (migration 0007). Each is a one-invoice document, so
  // a bill's View / Download / Print can never hand back a sibling's figures.
  //
  // All three are null together on rows created before 0007, which is how a legacy
  // row is recognised. They are NOT back-filled with the workbook PDF: doing so
  // would point every sibling at a document containing all of them, which is the
  // exact bug 0007 exists to fix.
  original_pdf_path: string | null;
  duplicate_pdf_path: string | null;
  triplicate_pdf_path: string | null;

  // From the joined upload. `original_filename` is the SOURCE WORKBOOK, shown as
  // provenance only — it is never the bill's identity, and it is never a document
  // this bill resolves to.
  original_filename: string;
  base_name: string;
  /** The upload's own status, renamed so it cannot be read as a `bills` column. */
  upload_status: BillUpload["status"] | null;
}

/** Columns that live on `bills` itself. */
export interface BillColumns {
  id: string;
  invoice_no: string | null;
  invoice_date: string | null;

  our_challan_no: string | null;
  our_challan_date: string | null;
  your_challan_no: string | null;
  your_challan_date: string | null;

  order_no: string | null;
  /** Which template label was found, e.g. "Service Order No." or "Purchase Order No." */
  order_no_label: string | null;
  order_date: string | null;

  eway_bill_no: string | null;
  place_of_supply: string | null;
  state: string | null;
  state_code: string | null;
  transporter_mode: string | null;
  vehicle_number: string | null;

  party_gst_no: string | null;
  party_name: string | null;

  total_quantity: number | null;
  amount_before_tax: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  total_gst: number | null;
  amount_after_tax: number | null;
  reverse_charge_gst: number | null;
  round_off: number | null;
  amount_in_words: string | null;

  job_kind: string | null;
  seller_name: string | null;
  seller_address: string | null;
  bank_details: string[] | null;
  terms: string | null;
}

export interface BillLineItem {
  id: string;
  bill_id: string;
  sr_no: number | null;
  description: string | null;
  hsn_code: string | null;
  uom: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
}

/** Stages the upload walks through, in the order the server performs them. */
export type BillUploadStage =
  | "reading"
  | "uploading"
  | "validating"
  | "parsing"
  | "generating_pdfs"
  | "uploading_pdfs"
  | "saving"
  | "completed"
  | "failed";

/** Client-side mirror of the server pipeline, so progress is reported honestly. */
export const BILL_UPLOAD_STAGE_ORDER: readonly BillUploadStage[] = [
  "reading",
  "uploading",
  "validating",
  "parsing",
  "generating_pdfs",
  "uploading_pdfs",
  "saving",
  "completed",
] as const;

export const BILL_UPLOAD_STAGE_LABEL: Record<BillUploadStage, string> = {
  reading: "Reading file",
  uploading: "Uploading workbook",
  validating: "Validating workbook",
  parsing: "Reading invoices",
  generating_pdfs: "Generating PDFs",
  uploading_pdfs: "Uploading PDFs",
  saving: "Saving bill records",
  completed: "Completed",
  failed: "Failed",
};

/**
 * A file the user chose, already in memory, before it is handed to the edge
 * function. Both clients build one of these; the service does the rest.
 */
export interface PickedWorkbook {
  name: string;
  /** Base64, no data-URI prefix. */
  base64: string;
  /** Size of the original file in bytes. */
  size: number;
}

export interface BillUploadResult {
  upload_id: string;
  base_name: string;
  /** Sheets parsed. Each is ONE bill, printed three times. */
  invoice_count: number;
  /**
   * One entry per bill, each with ITS OWN three documents.
   *
   * `job_kind` is the workbook's own classification, returned verbatim so the
   * upload summary can count WITH METAL against LABOUR JOB without guessing from
   * sheet names.
   */
  bills: {
    id: string;
    sheet_name: string;
    invoice_no: string | null;
    job_kind: string | null;
    paths: { original: string; duplicate: string; triplicate: string };
  }[];
  /**
   * The optional whole-workbook documents, one per print copy. These contain
   * EVERY invoice in the upload and are never what a single bill's View /
   * Download / Print resolves to.
   */
  aggregate_pdfs: {
    copy: BillCopy;
    label: string;
    path: string;
    filename: string;
    scope: "workbook";
  }[];
}

/**
 * `get_folder_bill_summary` (migration 0006). Every figure is over UNIQUE bill
 * records, never over print copies, so a folder holding both sample bills
 * reports 2 bills and not 6.
 */
export interface FolderBillSummary {
  total_bills: number;
  total_quantity: number;
  total_amount_before_tax: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  total_gst: number;
  total_amount_after_tax: number;
  total_round_off: number;
  average_bill_value: number;
  average_quantity: number;
  average_amount_before_tax: number;
}

export const EMPTY_FOLDER_BILL_SUMMARY: FolderBillSummary = {
  total_bills: 0,
  total_quantity: 0,
  total_amount_before_tax: 0,
  total_cgst: 0,
  total_sgst: 0,
  total_igst: 0,
  total_gst: 0,
  total_amount_after_tax: 0,
  total_round_off: 0,
  average_bill_value: 0,
  average_quantity: 0,
  average_amount_before_tax: 0,
};
