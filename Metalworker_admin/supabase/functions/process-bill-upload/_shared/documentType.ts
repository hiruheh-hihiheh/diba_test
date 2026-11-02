// supabase/functions/process-bill-upload/_shared/documentType.ts
//
// Which document each worksheet is, and what an upload is allowed to do with it.
//
// THE KEY IS THE DOCUMENT'S OWN TITLE
// Both templates print their kind as a title inside every copy block: "TAX
// INVOICE" or "DELIVERY CHALLAN". That printed title is the classification. The
// file name, the sheet name ("341 L", "350") and the job kind (LABOUR JOB / WITH
// METAL) are never consulted: a sheet named "341 L" is a labour challan in one
// workbook and a labour invoice in another, and both document types carry both
// job kinds.
//
// THE TABLE IS THE CONSISTENCY CHECK
// A title alone could be a typo or a pasted block, so the item table must agree:
// a Tax Invoice's table has an AMOUNT column, a Delivery Challan's does not (it
// has REMARKS instead). A sheet whose title and table disagree is not guessed at;
// it is reported, by name, with the reason.
//
// Everything here is pure and runs before a single row or file is written, so a
// rejected upload can never leave a partial import behind.

import { type Sheet, textAt } from "./xlsx.ts";
import { squash, type DocumentType } from "./parseBill.ts";

export type { DocumentType };

export const DOCUMENT_TITLES: Record<DocumentType, string> = {
  tax_invoice: "TAX INVOICE",
  delivery_challan: "DELIVERY CHALLAN",
};

/** How the two sections are named to the admin. */
export const SECTION_NAMES: Record<DocumentType, string> = {
  tax_invoice: "Tax Bills",
  delivery_challan: "Challan Bills",
};

const DOCUMENT_NOUNS: Record<DocumentType, { one: string; many: string }> = {
  tax_invoice: { one: "Tax Invoice", many: "Tax Invoices" },
  delivery_challan: { one: "Delivery Challan", many: "Delivery Challans" },
};

const TITLE_KEYS: Record<string, DocumentType> = {
  TAXINVOICE: "tax_invoice",
  DELIVERYCHALLAN: "delivery_challan",
};

export function isDocumentType(value: unknown): value is DocumentType {
  return value === "tax_invoice" || value === "delivery_challan";
}

export function otherDocumentType(type: DocumentType): DocumentType {
  return type === "tax_invoice" ? "delivery_challan" : "tax_invoice";
}

export interface SheetClassification {
  /** 0-based position in the workbook. */
  index: number;
  sheetName: string;
  kind: DocumentType | "blank" | "unknown";
  /** Why an `unknown` sheet could not be classified, phrased for the admin. */
  reason?: string;
}

/** Item-table heading keys, after `squash`. */
const HEADING_KEYS: Record<string, "sr" | "desc" | "qty" | "amt" | "remarks"> = {
  SRNO: "sr",
  DESCRIPTION: "desc",
  QUANTITY: "qty",
  QTY: "qty",
  AMOUNT: "amt",
  AMT: "amt",
  REMARKS: "remarks",
  REMARK: "remarks",
};

function isBlank(sheet: Sheet): boolean {
  for (let r = 0; r <= sheet.maxRow; r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      if (textAt(sheet, r, c).trim() !== "") return false;
    }
  }
  return true;
}

/** The first row that reads as an item-table heading, and which columns it has. */
function tableHeadings(sheet: Sheet): Set<string> | null {
  for (let r = 0; r <= sheet.maxRow; r++) {
    const found = new Set<string>();
    for (let c = 0; c <= sheet.maxCol; c++) {
      const key = HEADING_KEYS[squash(textAt(sheet, r, c))];
      if (key) found.add(key);
    }
    if (found.has("sr") && found.has("desc") && found.has("qty")) return found;
  }
  return null;
}

/** Classify one worksheet from its printed title, checked against its item table. */
export function classifySheet(sheet: Sheet, index: number): SheetClassification {
  const base = { index, sheetName: sheet.name };
  if (isBlank(sheet)) return { ...base, kind: "blank" };

  const titles = new Set<DocumentType>();
  for (let r = 0; r <= sheet.maxRow; r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      const type = TITLE_KEYS[squash(textAt(sheet, r, c))];
      if (type) titles.add(type);
    }
  }
  if (titles.size === 0) {
    return { ...base, kind: "unknown", reason: "No \"TAX INVOICE\" or \"DELIVERY CHALLAN\" title was found on this sheet." };
  }
  if (titles.size > 1) {
    return { ...base, kind: "unknown", reason: "This sheet carries both a \"TAX INVOICE\" and a \"DELIVERY CHALLAN\" title." };
  }
  const [type] = [...titles];

  const headings = tableHeadings(sheet);
  if (!headings) {
    return {
      ...base,
      kind: "unknown",
      reason: `It is titled "${DOCUMENT_TITLES[type]}" but has no item table with SR.NO., DESCRIPTION and QUANTITY headings.`,
    };
  }
  if (type === "tax_invoice" && !headings.has("amt")) {
    return {
      ...base,
      kind: "unknown",
      reason: "It is titled \"TAX INVOICE\" but its item table has no AMOUNT column, which every Tax Invoice has.",
    };
  }
  if (type === "delivery_challan" && headings.has("amt")) {
    return {
      ...base,
      kind: "unknown",
      reason: "It is titled \"DELIVERY CHALLAN\" but its item table has an AMOUNT column, which is the Tax Invoice layout.",
    };
  }
  return { ...base, kind: type };
}

export interface WorkbookClassification {
  sheets: SheetClassification[];
  /** Sheet indexes per document type, in workbook order. */
  groups: Record<DocumentType, number[]>;
  unknown: SheetClassification[];
}

export function classifyWorkbook(sheets: Sheet[]): WorkbookClassification {
  const classified = sheets.map((s, i) => classifySheet(s, i));
  return {
    sheets: classified,
    groups: {
      tax_invoice: classified.filter((c) => c.kind === "tax_invoice").map((c) => c.index),
      delivery_challan: classified.filter((c) => c.kind === "delivery_challan").map((c) => c.index),
    },
    unknown: classified.filter((c) => c.kind === "unknown"),
  };
}

/* ──────────────────────────────────────────────
   What an upload may do
   ────────────────────────────────────────────── */

export interface MixedPreview {
  groups: { document_type: DocumentType; section: string; count: number; sheets: string[] }[];
}

export type ImportPlan =
  | {
      action: "reject";
      status: number;
      reason: "no_documents" | "unrecognized_sheets" | "wrong_document_type";
      message: string;
      detail?: Record<string, unknown>;
    }
  | { action: "confirm_mixed"; message: string; preview: MixedPreview }
  | { action: "import"; mixed: boolean; groups: { documentType: DocumentType; sheetIndexes: number[] }[] };

function plural(n: number, noun: { one: string; many: string }): string {
  return `${n} ${n === 1 ? noun.one : noun.many}`;
}

/**
 * Decide, from the classification alone, what an upload into `section` does.
 *
 *   - any non-blank sheet that is not a recognised document → reject, naming it;
 *   - only the other section's documents → reject, naming the right section;
 *   - only this section's documents → import them as one group;
 *   - both kinds → ask for confirmation (with counts), then import each kind as
 *     its own group, whichever section the file was uploaded from.
 */
export function planImport(classification: WorkbookClassification, section: DocumentType, confirmMixed: boolean): ImportPlan {
  if (classification.unknown.length > 0) {
    const list = classification.unknown.map((u) => `'${u.sheetName}': ${u.reason}`).join(" ");
    return {
      action: "reject",
      status: 422,
      reason: "unrecognized_sheets",
      message:
        `${classification.unknown.length === 1 ? "1 sheet" : `${classification.unknown.length} sheets`} could not be identified as a Tax Invoice or a Delivery Challan, so nothing was imported. ${list}`,
      detail: { sheets: classification.unknown.map((u) => ({ sheet: u.sheetName, reason: u.reason })) },
    };
  }

  const tax = classification.groups.tax_invoice;
  const challan = classification.groups.delivery_challan;
  if (tax.length === 0 && challan.length === 0) {
    return { action: "reject", status: 422, reason: "no_documents", message: "This workbook has no Tax Invoice or Delivery Challan sheets." };
  }

  const own = section === "tax_invoice" ? tax : challan;
  const other = otherDocumentType(section);
  const others = section === "tax_invoice" ? challan : tax;

  if (own.length === 0) {
    return {
      action: "reject",
      status: 422,
      reason: "wrong_document_type",
      message: `This workbook contains ${DOCUMENT_NOUNS[other].one} documents, not ${DOCUMENT_NOUNS[section].many}. Please upload it through the ${SECTION_NAMES[other]} section.`,
      detail: { detected_type: other, expected_type: section },
    };
  }

  if (others.length === 0) {
    return { action: "import", mixed: false, groups: [{ documentType: section, sheetIndexes: own }] };
  }

  const groups = (["tax_invoice", "delivery_challan"] as const).map((type) => {
    const idx = classification.groups[type];
    return {
      document_type: type,
      section: SECTION_NAMES[type],
      count: idx.length,
      sheets: idx.map((i) => classification.sheets[i].sheetName),
    };
  });
  if (!confirmMixed) {
    return {
      action: "confirm_mixed",
      message: `This workbook contains both document types: ${plural(tax.length, DOCUMENT_NOUNS.tax_invoice)} and ${plural(challan.length, DOCUMENT_NOUNS.delivery_challan)}. Each will be imported into its own section.`,
      preview: { groups },
    };
  }
  return {
    action: "import",
    mixed: true,
    groups: [
      { documentType: "tax_invoice", sheetIndexes: tax },
      { documentType: "delivery_challan", sheetIndexes: challan },
    ],
  };
}
