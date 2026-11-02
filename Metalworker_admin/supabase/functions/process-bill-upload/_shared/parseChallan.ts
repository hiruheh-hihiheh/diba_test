// supabase/functions/process-bill-upload/_shared/parseChallan.ts
//
// The Delivery Challan worksheet parser.
//
// A Delivery Challan is laid out like a Tax Invoice above the item table — the
// seller's block under the title, the customer's name and address down the left,
// labelled references down the middle — but it is a different document:
//
//   reference rows   CHALLAN NO / Your Challan No. / Purchase or Service Order No.
//                    / Transporter Mode   (no Our Challan, E-way Bill or Place of
//                    Supply rows)
//   item table       SR.NO. | DESCRIPTION | HSN CODE | UOM | Quantity | REMARKS
//                    (no Rate or Amount — a challan moves material, it bills nothing)
//   footer           LABOUR JOB / WITHMETAL beside Total Quantity, the receipt line
//                    "Received above material in good & condition", "For <company>",
//                    (Receivers Signature) and (Proprietor)
//
// So it is parsed by its own rules rather than forced through the invoice parser,
// which requires an invoice number, an AMOUNT column and financial totals. It
// produces the same `ParsedBill` shape, so storage, rendering, editing and
// regeneration handle both types through one model — with every monetary field
// left null rather than filled with an invented zero.
//
// The item-table position is found from its headings, never assumed: the
// supplied challans put it at row 15 where invoices put it at row 17.

import { type Sheet } from "./xlsx.ts";
import {
  BillFormatError,
  COPY_ORDER,
  CopyReader,
  findCopyBlocks,
  norm,
  parseDate,
  serialToDate,
  squash,
  synthesizeCopy,
  type Block,
  type BillCopy,
  type BillLineItem,
  type CopyKind,
  type ParsedBill,
  type ReferenceRow,
} from "./parseBill.ts";

const HEADING_KEYS: Record<string, "sr" | "desc" | "hsn" | "uom" | "qty" | "remarks" | "amt"> = {
  SRNO: "sr",
  DESCRIPTION: "desc",
  HSNCODE: "hsn",
  HSN: "hsn",
  UOM: "uom",
  QUANTITY: "qty",
  QTY: "qty",
  REMARKS: "remarks",
  REMARK: "remarks",
  AMOUNT: "amt",
  AMT: "amt",
};

interface ChallanTable {
  row: number;
  sr: number;
  desc: number;
  hsn: number | null;
  uom: number | null;
  qty: number;
  remarks: number | null;
}

/** Every label in the challan's reference band, so a value is never read as a neighbour's label. */
const FIELD_LABEL_RES: RegExp[] = [
  /^\s*CHALLAN\s*NO\b/i,
  /\bYOUR\s*CHALLAN\s*NO\b/i,
  /\b(?:SERVICE|PURCHASE|SALES)\s*ORDER\s*NO\b/i,
  /\bTRANSPORTER\s*MODE\b/i,
  /^date\s*:?$/i,
  /\bSTATE\s*CODE\b/i,
  /^\s*STATE\s*:/i,
];

function isFieldLabel(text: string): boolean {
  return FIELD_LABEL_RES.some((re) => re.test(text));
}

function findTable(r: CopyReader): ChallanTable | null {
  for (let row = r.firstRow; row <= r.lastRow; row++) {
    const found = new Map<string, number>();
    for (const cell of r.row(row)) {
      const key = HEADING_KEYS[squash(cell.text)];
      if (key && !found.has(key)) found.set(key, cell.col);
    }
    if (found.has("sr") && found.has("desc") && found.has("qty")) {
      if (found.has("amt")) return null; // an invoice table; the classifier reports it
      return {
        row,
        sr: found.get("sr")!,
        desc: found.get("desc")!,
        hsn: found.get("hsn") ?? null,
        uom: found.get("uom") ?? null,
        qty: found.get("qty")!,
        remarks: found.get("remarks") ?? null,
      };
    }
  }
  return null;
}

/**
 * Item rows from just below the heading to just above Total Quantity.
 *
 * A serial number starts a line; a row with no serial number but some text
 * continues the previous line's description (and remarks), exactly as the
 * invoice parser treats a wrapped description, so no continuation row is lost.
 */
function readItems(r: CopyReader, table: ChallanTable, lastRow: number): BillLineItem[] {
  const items: BillLineItem[] = [];
  for (let row = table.row + 1; row <= Math.min(lastRow, r.lastRow); row++) {
    const srNo = r.num(row, table.sr);
    const description = r.text(row, table.desc);
    const remarks = table.remarks !== null ? r.text(row, table.remarks) : "";
    if (srNo !== null) {
      items.push({
        srNo,
        description,
        hsnCode: table.hsn !== null ? r.text(row, table.hsn) || null : null,
        uom: table.uom !== null ? r.text(row, table.uom) || null : null,
        quantity: r.num(row, table.qty),
        rate: null,
        amount: null,
        remarks: remarks || null,
      });
    } else if (items.length > 0 && (description !== "" || remarks !== "")) {
      const prev = items[items.length - 1];
      if (description !== "") prev.description = norm(`${prev.description} ${description}`);
      if (remarks !== "") prev.remarks = prev.remarks ? norm(`${prev.remarks} ${remarks}`) : remarks;
    }
  }
  return items;
}

function parseChallanCopy(sheet: Sheet, block: Block): BillCopy {
  const r = new CopyReader(sheet, block.start, block.end);
  const first = r.firstRow;
  const last = r.lastRow;
  const name = sheet.name;

  const titleHit = r.findExact("DELIVERYCHALLAN");
  const leftCol = titleHit ? titleHit.col : 0;
  const headerTop = titleHit ? titleHit.row : first;

  const table = findTable(r);
  if (!table) {
    throw new BillFormatError(
      `Could not recognize the Delivery Challan on sheet '${name}'. Expected an item table with SR.NO., DESCRIPTION and QUANTITY columns and no AMOUNT column.`,
      name
    );
  }

  const labelled = (re: RegExp): { row: number; col: number; label: string; value: string | null } | null => {
    const hit = r.findMatch(re, first, 1);
    if (!hit || hit.row >= table.row) return null;
    const value = r.rightOf(hit.row, hit.col).find((c) => !isFieldLabel(c.text))?.text ?? null;
    return { row: hit.row, col: hit.col, label: hit.text, value };
  };
  const dateOnRow = (row: number): string | null => {
    const marker = r.row(row).find((c) => /^date\s*:?$/i.test(c.text));
    if (!marker) return null;
    const cells = r.rightOf(row, marker.col);
    if (cells.length === 0) return null;
    // Normalise whatever the cell holds (Excel serial or hand-typed text) into an
    // ISO date, or null when it cannot be read as one. Returning raw text here
    // would put a value such as "15/08/2026" into a `date` column and fail the
    // whole upload.
    return parseDate(r.num(row, cells[0].col) ?? cells[0].text);
  };
  const hasDateCell = (row: number): boolean => r.row(row).some((c) => /^date\s*:?$/i.test(c.text));

  const challan = labelled(/^\s*CHALLAN\s*NO\b/i);
  const yourChallan = labelled(/\bYOUR\s*CHALLAN\s*NO\b/i);
  const order = labelled(/\b(?:SERVICE|PURCHASE|SALES)\s*ORDER\s*NO\b/i);
  const transporter = labelled(/\bTRANSPORTER\s*MODE\b/i);

  /* ---- seller: the left column between the title and the first reference row */
  const firstRefRow = challan?.row ?? yourChallan?.row ?? order?.row ?? table.row;
  const seller = r.colCells(leftCol, headerTop, firstRefRow - 1);
  const sellerLine = (i: number): string | null => seller[i]?.text ?? null;

  /* ---- customer: consecutive left-column lines from the first reference row */
  const customer: string[] = [];
  for (let row = firstRefRow; row < table.row; row++) {
    const [cell] = r.colCells(leftCol, row, row);
    if (!cell) break;
    if (/^\s*(state\s*:|party'?s?\s*gst\b)/i.test(cell.text)) break;
    customer.push(cell.text.trim());
  }

  let state: string | null = null;
  let stateCode: string | null = null;
  const combined = r.findMatch(/state\s*:\s*\D+state\s*code\s*:?\s*\d/i, first, 0);
  if (combined && combined.row < table.row) {
    const m = /state\s*:\s*(.*?)\s+state\s*code\s*:?\s*(\d+)/i.exec(combined.text);
    if (m) {
      state = m[1].trim() || null;
      stateCode = m[2];
    }
  }

  let partyGstNo: string | null = null;
  const gstHit = r.findMatch(/party'?s?\s*gst\s*no/i, first, 0);
  if (gstHit && gstHit.row < table.row) {
    const inline = /gst\s*no\.?\s*:?\s*([0-9A-Za-z]{15})/i.exec(gstHit.text);
    if (inline) partyGstNo = inline[1].toUpperCase();
    else {
      const cells = r.rightOf(gstHit.row, gstHit.col);
      const cleaned = cells[0]?.text.replace(/[^0-9A-Za-z]/g, "").toUpperCase() ?? "";
      if (cleaned.length >= 15) partyGstNo = cleaned.slice(0, 15);
    }
  }

  let transporterMode: string | null = null;
  let vehicleNumber: string | null = null;
  if (transporter) {
    const cells = r.rightOf(transporter.row, transporter.col).filter((c) => !isFieldLabel(c.text));
    transporterMode = cells[0]?.text.replace(/[:\s]+$/, "") || null;
    vehicleNumber = cells[1]?.text ?? null;
  }

  /* ---- items, total quantity, job kind ------------------------------------ */
  const totalHit = r.findExact("TOTALQUANTITY", table.row);
  const lineItems = readItems(r, table, (totalHit ? totalHit.row : last + 1) - 1);
  let totalQuantity: number | null = null;
  let jobKind: string | null = null;
  if (totalHit) {
    const valueCell = r.rightOf(totalHit.row, totalHit.col)[0];
    totalQuantity = valueCell ? r.num(totalHit.row, valueCell.col) : null;
    for (let c = 0; c < totalHit.col; c++) {
      const t = r.text(totalHit.row, c);
      if (/^(?:LABOUR\s*JOB|WITH\s*?MATERIAL|WITH\s*METAL|WITHMETAL)$/i.test(t)) {
        jobKind = t.toUpperCase();
        break;
      }
    }
  }

  /* ---- footer -------------------------------------------------------------- */
  const footerFrom = totalHit ? totalHit.row + 1 : table.row + 1;
  const receipt = r.findMatch(/received\s+(?:the\s+)?above\s+material/i, footerFrom, 0);
  const behalf = r.findMatch(/^\s*for\s+\S/i, footerFrom, 0);
  const receiver = r.findMatch(/receiver'?s?\s*signature/i, footerFrom, 0);
  const designation = r.findMatch(/^\s*\(?\s*(proprietor|director|partner|authori[sz]ed\s+signatory|manager)\s*\)?\s*$/i, footerFrom, 0);

  const referenceRows: ReferenceRow[] = [
    challan && { label: "Challan No.", value: challan.value, date: dateOnRow(challan.row), hasDateCell: hasDateCell(challan.row), row: challan.row },
    yourChallan && {
      label: "Your Challan No.",
      value: yourChallan.value,
      date: dateOnRow(yourChallan.row),
      hasDateCell: hasDateCell(yourChallan.row),
      row: yourChallan.row,
    },
    order && {
      label: order.label.replace(/[:.\s]+$/, ""),
      value: order.value,
      date: dateOnRow(order.row),
      hasDateCell: hasDateCell(order.row),
      row: order.row,
    },
  ]
    .filter((x): x is ReferenceRow & { row: number } => !!x)
    .sort((a, b) => a.row - b.row)
    .map(({ label, value, date, hasDateCell: hd }) => ({ label, value, date, hasDateCell: hd }));

  return {
    kind: block.kind,
    label: block.label,
    documentType: "delivery_challan",
    firstRow: first + 1,
    lastRow: last + 1,

    sellerName: sellerLine(1),
    sellerDescriptor: sellerLine(2),
    sellerTaxLine: sellerLine(3),
    sellerAddress: sellerLine(4),
    sellerContact: sellerLine(5),

    recipientHeading: null,
    recipientNote: null,
    partyName: customer[0] ?? null,
    partyAddress: customer.slice(1),
    partyGstNo,

    // The challan number is the document's number, so it is stored in the same
    // field an invoice's number is: search, file names, folders and the bill list
    // all key off it without knowing which document type they are showing.
    invoiceNo: challan?.value ?? null,
    invoiceDate: challan ? dateOnRow(challan.row) : null,
    ourChallanNo: null,
    ourChallanDate: null,
    yourChallanNo: yourChallan?.value ?? null,
    yourChallanDate: yourChallan ? dateOnRow(yourChallan.row) : null,
    orderNo: order?.value ?? null,
    orderNoLabel: order ? order.label.replace(/[:.\s]+$/, "") : null,
    orderDate: order ? dateOnRow(order.row) : null,
    ewayBillNo: null,
    ewayBillDate: null,
    placeOfSupply: null,
    state,
    stateCode,
    transporterMode,
    vehicleNumber,
    referenceRows,

    lineItems,
    totalQuantity,
    // A challan carries no money. These stay null — never zero — so nothing can
    // total, print or export a figure the document never had.
    amountBeforeTax: null,
    cgst: null,
    sgst: null,
    igst: null,
    totalGst: null,
    amountAfterTax: null,
    reverseChargeGst: null,
    roundOff: null,
    amountInWords: null,
    jobKind,
    cgstRate: null,
    sgstRate: null,
    igstRate: null,

    bankLines: [],
    termsLines: [],
    signatureLines: [receiver?.text ?? "(Receivers Signature)"],
    notes: [receipt?.text, behalf?.text, designation?.text].filter((l): l is string => !!l),
    // On a challan the "certification" slot holds the receipt acknowledgement.
    certification: receipt?.text ?? null,
    onBehalfOf: behalf?.text ?? null,
    signatureDesignation: designation?.text ?? null,
    receiverSignature: receiver?.text ?? null,
    notesExtra: [],
  };
}

/** One worksheet → one challan, always carrying all three print copies. */
export function parseChallanSheet(sheet: Sheet): ParsedBill {
  const found = new Map<CopyKind, Block>();
  for (const b of findCopyBlocks(sheet)) if (!found.has(b.kind)) found.set(b.kind, b);
  const canonicalKind = COPY_ORDER.find((k) => found.has(k));
  if (!canonicalKind) {
    throw new BillFormatError(
      `Could not recognize the Delivery Challan on sheet '${sheet.name}'. No ORIGINAL, DUPLICATE or TRIPLICATE copy label was found.`,
      sheet.name
    );
  }
  const parsed: Partial<Record<CopyKind, BillCopy>> = {};
  for (const kind of COPY_ORDER) {
    const block = found.get(kind);
    if (block) parsed[kind] = parseChallanCopy(sheet, block);
  }
  const canonical = parsed[canonicalKind]!;
  if (!canonical.invoiceNo) {
    throw new BillFormatError(`Could not recognize the Delivery Challan on sheet '${sheet.name}'. The challan number could not be identified.`, sheet.name);
  }
  if (canonical.lineItems.length === 0) {
    throw new BillFormatError(`The Delivery Challan on sheet '${sheet.name}' has no item lines.`, sheet.name);
  }
  const copies: Record<CopyKind, BillCopy> = { ...(parsed as Record<CopyKind, BillCopy>) };
  for (const kind of COPY_ORDER) {
    if (!copies[kind]) copies[kind] = synthesizeCopy(canonical, kind);
  }
  return {
    sheetName: sheet.name,
    original: copies.original,
    duplicate: copies.duplicate,
    triplicate: copies.triplicate,
    canonicalKind,
    sourceCopies: COPY_ORDER.filter((k) => found.has(k)),
  };
}
