// billDocumentTypes.ts — Tax Bills and Challan Bills, as the screens name them.
//
// Kept byte-identical in Metalworker_admin/src/services and
// Metalworker_desktop/src/services (the self-test `test-document-types.ts` fails if
// they drift). No imports, so both apps and the Node self-tests can load it.
//
// The server decides a workbook's document type from each sheet's printed title;
// this file only says how each type is presented and which features apply to it.

export type BillDocumentType = "tax_invoice" | "delivery_challan";

export const BILL_DOCUMENT_TYPES: readonly BillDocumentType[] = ["tax_invoice", "delivery_challan"];

export interface DocumentTypeInfo {
  type: BillDocumentType;
  /** The section's name: "Tax Bills" / "Challan Bills". */
  section: string;
  /** One document: "Tax Invoice" / "Delivery Challan". */
  noun: string;
  nounPlural: string;
  /** Short lower-case word for running text: "invoice" / "challan". */
  word: string;
  /** Label of the document's own number: "Invoice No." / "Challan No.". */
  numberLabel: string;
  /** Label of its date: "Invoice date" / "Challan date". */
  dateLabel: string;
  /** `admin_folders.folder_type` of this section's billing folders. */
  billingFolderType: "billing" | "challan_billing";
  /** Whether rate, amount, GST, bank and terms exist on this document. */
  hasMoney: boolean;
  /** Whether items carry a REMARKS column. */
  hasRemarks: boolean;
  /** Bill Creator makes Tax Invoices only. */
  supportsBillCreator: boolean;
  /** Standalone (Bill Creator) bills can be included in this section's regeneration. */
  hasStandaloneBills: boolean;
  /** The app route of the section. */
  route: string;
}

export const DOCUMENT_TYPE_INFO: Record<BillDocumentType, DocumentTypeInfo> = {
  tax_invoice: {
    type: "tax_invoice",
    section: "Tax Bills",
    noun: "Tax Invoice",
    nounPlural: "Tax Invoices",
    word: "invoice",
    numberLabel: "Invoice No.",
    dateLabel: "Invoice date",
    billingFolderType: "billing",
    hasMoney: true,
    hasRemarks: false,
    supportsBillCreator: true,
    hasStandaloneBills: true,
    route: "/bills",
  },
  delivery_challan: {
    type: "delivery_challan",
    section: "Challan Bills",
    noun: "Delivery Challan",
    nounPlural: "Delivery Challans",
    word: "challan",
    numberLabel: "Challan No.",
    dateLabel: "Challan date",
    billingFolderType: "challan_billing",
    hasMoney: false,
    hasRemarks: true,
    supportsBillCreator: false,
    hasStandaloneBills: false,
    route: "/challan-bills",
  },
};

/** A stored row's type. Rows from before document types existed are Tax Invoices. */
export function documentTypeOf(row: { document_type?: string | null } | null | undefined): BillDocumentType {
  return row?.document_type === "delivery_challan" ? "delivery_challan" : "tax_invoice";
}

export function otherDocumentType(type: BillDocumentType): BillDocumentType {
  return type === "tax_invoice" ? "delivery_challan" : "tax_invoice";
}

/** What the server reports when a workbook holds both document types. */
export interface MixedWorkbookPreview {
  groups: { document_type: BillDocumentType; section: string; count: number; sheets: string[] }[];
}

/** One logical upload created from a workbook (two for a mixed workbook). */
export interface WorkbookUploadGroup {
  upload_id: string;
  document_type: BillDocumentType;
  section: string;
  base_name: string;
  invoice_count: number;
  sheets: string[];
}

/** A short sentence naming what a mixed workbook will become. */
export function describeMixedPreview(preview: MixedWorkbookPreview): string {
  return preview.groups
    .map((g) => `${g.count} ${g.count === 1 ? DOCUMENT_TYPE_INFO[g.document_type].noun : DOCUMENT_TYPE_INFO[g.document_type].nounPlural} → ${g.section}`)
    .join(", ");
}
