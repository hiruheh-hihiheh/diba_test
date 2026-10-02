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
  eway_bill_date: string | null;
  place_of_supply: string | null;
  state: string | null;
  state_code: string | null;
  transporter_mode: string | null;
  vehicle_number: string | null;

  party_gst_no: string | null;
  party_name: string | null;
  /**
   * The billed-to address, one source line per row separated by newlines.
   *
   * A single text column rather than `address_line_1..4` because an address has a
   * variable number of lines and the invoice has to print them with the breaks the
   * workbook gave them. A fixed set of columns would have to drop or invent a line
   * for any address that is not exactly four.
   */
  party_address: string | null;
  recipient_label: string | null;
  recipient_note: string | null;

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

  /** Tax RATES as percentages: 9 means 9%, matching the workbook's "0.09" cell. */
  cgst_rate: number | null;
  sgst_rate: number | null;
  igst_rate: number | null;

  job_kind: string | null;
  seller_name: string | null;
  seller_address: string | null;
  /**
   * The seller's header, split out of `seller_address`.
   *
   * 0005 packed the descriptor, the GST/MSME line and the contact into one joined
   * string, which displays correctly and cannot be re-rendered with: the order is
   * only recoverable if none of the three was ever null. These are the same three
   * values as separate columns, and `seller_address` is still written for the
   * detail screen.
   */
  seller_descriptor: string | null;
  seller_tax_line: string | null;
  seller_contact: string | null;
  /** Label/value parts since the editing migration; an array of lines before it. */
  bank_details: BillBankDetails | string[] | null;
  terms: string | null;
  certification: string | null;
  on_behalf_of: string | null;
  signature_designation: string | null;
  receiver_signature: string | null;
  notes_extra: string | null;

  /** When the bill was last saved from the editor. Null = imported, never edited. */
  updated_at: string | null;
  /** Which re-print is stored: 1 after import, +1 per save. */
  pdf_version: number | null;
}

/**
 * One editable part of the bank block, keeping the label the invoice prints.
 *
 * The label is stored so that `label + value` reproduces the printed line exactly.
 * The template is inconsistent about the gap after the colon — "Bank Name: THE
 * FEDERAL BANK LTD" has one, "IFSC CODE:FDRL0001775" does not — and a renderer that
 * reinserted its own separator would retype every bank line on every re-print.
 */
export interface BillBankPart {
  label: string;
  value: string;
}

export type BillBankDetails = Record<string, BillBankPart>;

/** The four bank parts this template writes, in the order it prints them. */
export const BILL_BANK_PARTS: readonly { key: string; label: string }[] = [
  { key: "bank_name", label: "Bank name" },
  { key: "account_number", label: "Account number" },
  { key: "branch", label: "Branch" },
  { key: "ifsc_code", label: "IFSC code" },
] as const;

/**
 * The fields the bill editor may change, and the one thing it may not.
 *
 * The copy designation is deliberately absent: ORIGINAL / DUPLICATE / TRIPLICATE are
 * three printings of the same bill, so there is nothing for a user to choose. Saving
 * regenerates all three from the single edited record.
 *
 * `amount_in_words` has three cases, not two. `null` asks the server to rebuild the
 * words from the new total; a string keeps exactly what is typed; OMITTING the key
 * leaves the imported wording alone, because replacing it silently on every save
 * would alter the printed invoice for no reason anyone asked for.
 */
export interface BillPatch {
  job_kind?: string | null;

  invoice_no?: string | null;
  invoice_date?: string | null;
  our_challan_no?: string | null;
  our_challan_date?: string | null;
  your_challan_no?: string | null;
  your_challan_date?: string | null;
  order_no?: string | null;
  order_no_label?: string | null;
  order_date?: string | null;
  eway_bill_no?: string | null;
  eway_bill_date?: string | null;

  recipient_label?: string | null;
  recipient_note?: string | null;
  party_name?: string | null;
  party_address?: string | null;
  party_gst_no?: string | null;
  place_of_supply?: string | null;
  state?: string | null;
  state_code?: string | null;

  transporter_mode?: string | null;
  vehicle_number?: string | null;

  seller_name?: string | null;
  seller_descriptor?: string | null;
  seller_tax_line?: string | null;
  seller_address?: string | null;
  seller_contact?: string | null;

  /** Source values: what the business charged or decided, not what arithmetic gives. */
  cgst_rate?: number | null;
  sgst_rate?: number | null;
  igst_rate?: number | null;
  reverse_charge_gst?: number | null;
  round_off?: number | null;

  bank_details?: BillBankDetails | null;
  terms?: string | null;
  certification?: string | null;
  on_behalf_of?: string | null;
  signature_designation?: string | null;
  receiver_signature?: string | null;
  notes_extra?: string | null;

  amount_in_words?: string | null;

  line_items?: BillLineItemPatch[];
}

/** One editable line. `amount` is not listed: the server derives it as qty x rate. */
export interface BillLineItemPatch {
  sr_no?: number | null;
  description: string;
  hsn_code?: string | null;
  uom?: string | null;
  quantity?: number | null;
  rate?: number | null;
}

/** What a successful save returns: the new document version and its three paths. */
export interface BillUpdateResult {
  bill_id: string;
  pdf_version: number;
  amount_after_tax: number | null;
  amount_in_words: string | null;
  pdfs: { copy: BillCopy; label: string; path: string; filename: string }[];
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
 * `get_folder_bill_summary` (migrations 0006 + 0009 + 0010). Every figure is over
 * UNIQUE bill records, never over print copies, so a folder holding both sample
 * bills reports 2 bills and not 6.
 *
 * Nothing here is a second opinion: the RPC is the only place these numbers exist,
 * and this type only describes it. The client performs no arithmetic on them.
 *
 * WHICH BILLS EACH FIGURE COVERS (migration 0010, decided per aggregate)
 * A bill's financial columns are nullable — a template may legitimately omit a
 * field — so a bill whose grand total was never imported has
 * `amount_after_tax = NULL`. That splits the folder into two populations:
 *
 *   all bills   = every distinct `bills` row linked to the folder.
 *   valid bills = all bills whose `amount_after_tax` IS NOT NULL. A stored 0 IS a
 *                valid total (a genuinely free invoice); a NULL is not.
 *
 *   total_bills ..................... all bills    (a record count, not money)
 *   total_quantity .................. all bills    (a physical count, and not part
 *                                                  of the tax identity below)
 *   total_* money figures ........... valid bills
 *   average_bill_value and every
 *   other money average ............. valid bills  (each divides by the same
 *                                                  population its own sum covers)
 *   average_quantity ................ all bills
 *   min_* / max_* ................... valid bills, `null` when none
 *   job_kind_breakdown .............. all bills    (classification, not money)
 *
 * Money is taken only from valid bills because every money figure is one term in
 * `before tax + GST + round off = after tax`: folding in a bill that contributes
 * to one term but not another produces a number describing no invoice. Quantity is
 * the exception — it is a count of items, and a bill that recorded "6 nos" but not
 * the total still recorded 6.
 *
 * Read `bills_without_total` before trusting any money figure: it says how many of
 * the folder's bills the money excludes.
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
  /** Mean after-tax total per bill THAT HAS ONE. Never per bill in the folder. */
  average_bill_value: number;
  /** Mean quantity per bill in the folder — all bills, unlike the money averages. */
  average_quantity: number;
  average_amount_before_tax: number;
  /** Added in 0009: the per-bill means for each remaining tax component. */
  average_cgst: number;
  average_sgst: number;
  average_igst: number;
  average_gst: number;
  average_round_off: number;
  /**
   * The cheapest and dearest bill, over bills that have the figure.
   *
   * `null` means NO bill in the folder has this figure, which is not the same as a
   * bill costing nothing — so `null` is preserved rather than coalesced to 0, and
   * the UI renders it as "not recorded". A stored 0 still returns 0.
   */
  min_amount_after_tax: number | null;
  max_amount_after_tax: number | null;
  min_amount_before_tax: number | null;
  max_amount_before_tax: number | null;
  /**
   * Bills linked to this folder whose `amount_after_tax` was never imported.
   *
   * Reported rather than silently treated as zero, because a folder where every
   * total is null would otherwise read as "total after tax ₹0.00" — a real
   * financial figure that is not the truth.
   */
  bills_without_total: number;
  /**
   * Bills that DO have an after-tax total — the population every money figure
   * above is computed over. Added in 0010.
   *
   * `total_bills - bills_without_total`, reported by the database rather than
   * derived here, so the two counts cannot disagree. `null` only when the RPC is an
   * older build without the column, which the UI states rather than assumes.
   */
  bills_with_total: number | null;
  /** Added in 0009. Counts always sum to `total_bills`. */
  job_kind_breakdown: BillJobKindCount[];
}

/** One `job_kind` bucket in a folder's breakdown. */
export interface BillJobKindCount {
  /** The RAW stored value, verbatim from `bills.job_kind`. `null` = unclassified. */
  job_kind: string | null;
  count: number;
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
  average_cgst: 0,
  average_sgst: 0,
  average_igst: 0,
  average_gst: 0,
  average_round_off: 0,
  /* `null`, not 0: an empty folder has no cheapest bill. Zero here would claim the
     cheapest bill in the folder costs nothing, which is a financial statement this
     summary has no evidence for. */
  min_amount_after_tax: null,
  max_amount_after_tax: null,
  min_amount_before_tax: null,
  max_amount_before_tax: null,
  bills_without_total: 0,
  bills_with_total: 0,
  job_kind_breakdown: [],
};

/**
 * One row of `get_billing_folder_bill_counts()` (migration 0009): how many bills
 * a Billing folder holds.
 *
 * `bill_count` counts DISTINCT bill ids, so it is 1 per physical invoice and
 * never 3 — the same rule the folder summary follows.
 */
export interface BillingFolderBillCount {
  folder_id: string;
  folder_name: string;
  bill_count: number;
}

/**
 * Progress of a bulk operation the client drives itself.
 *
 * `done` counts FINISHED items, so `done / total` is a real fraction of real work
 * rather than an animation timer. `total` is the full known size, so the ratio
 * never exceeds 1 and never needs a guess.
 */
export interface BulkProgress {
  /** Items fully finished, successful or not. */
  done: number;
  /** Items in the whole operation. */
  total: number;
}
