// supabase/functions/process-bill-upload/_shared/parseBill.ts
//
// Deterministic parser for THIS client's tax-invoice workbook format.
//
// THE ONE INVARIANT THAT MATTERS
// A sheet holds ONE invoice, printed three times as ORIGINAL / DUPLICATE /
// TRIPLICATE stacked vertically. Those three blocks are three physical print
// copies of ONE financial bill. This module therefore produces ONE Bill per
// WORKSHEET and keeps the three copies as rendering variants of that single
// bill. Nothing downstream ever sees three financial rows for one invoice.
//
// NOTHING IS POSITIONAL
// The row span of each copy is discovered from the copy labels themselves, and
// every field is found by its LABEL text, not by a hard-coded row or column.
// The two sample sheets really do differ: their copies start 48 rows apart in
// "274 L" but 50 rows apart in "292", the order label is "Service Order No.:"
// in one and "Purchase Order No.:" in the other, and "Round Off" sits on a
// different row. Column positions for the line-item table are read from the
// table's own header row, so a shifted table still parses.
//
// Label matching uses a "squashed" form - upper-cased with every
// non-alphanumeric character removed - so "D E S C R I P T I O N",
// "Total Amount :GST" and "TOTAL AMOUNT AFTER TAX" all resolve to the same
// logical field.

import { type Sheet, numberAt, textAt } from "./xlsx.ts";

/* ──────────────────────────────────────────────
   Text normalisation
   ────────────────────────────────────────────── */

/** Upper-case, strip everything that is not a letter or digit. */
export function squash(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Trim and collapse internal runs of whitespace. */
export function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Excel date serial -> "YYYY-MM-DD". Excel's day 0 is 1899-12-30. */
function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/* ──────────────────────────────────────────────
   Model
   ────────────────────────────────────────────── */

export interface BillLineItem {
  srNo: number | null;
  description: string;
  hsnCode: string | null;
  uom: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
}

export type CopyKind = "original" | "duplicate" | "triplicate";

export const COPY_ORDER: readonly CopyKind[] = ["original", "duplicate", "triplicate"];

/**
 * One row of the invoice's reference block, as the SOURCE wrote it.
 *
 * The reference block is a fixed part of the template — INVOICE NO., Our Challan
 * No., Your Challan No., the order number, Eway Bill No., each with a Date. In
 * the production workbook those five rows are always present, and on most sheets
 * "Your Challan No." and "Eway Bill No." are present but BLANK.
 *
 * Recording the row separately from its value is the whole point. If the renderer
 * only ever saw a non-empty value it would have to guess whether a missing value
 * means "the template has no such field" (drop the row) or "this invoice left it
 * blank" (keep the row). Only the second is true, and conflating them silently
 * changes the invoice's structure. So the row is recorded, and the value may be
 * null.
 */
export interface ReferenceRow {
  /** The field's name as printed on the invoice, e.g. "Your Challan No.". */
  label: string;
  /** The identifier, or null when the source left this cell blank. */
  value: string | null;
  /** The row's own `Date:` cell, or null when blank or absent. */
  date: string | null;
  /** True when the source itself had no `Date:` cell on this row. */
  hasDateCell: boolean;
}

/** One printed copy of the invoice. Rendered on its own PDF page. */
export interface BillCopy {
  kind: CopyKind;
  label: string;
  /** 1-based row span, kept for diagnostics only. */
  firstRow: number;
  lastRow: number;

  sellerName: string | null;
  sellerDescriptor: string | null;
  sellerTaxLine: string | null;
  sellerAddress: string | null;
  sellerContact: string | null;

  recipientHeading: string | null;
  recipientNote: string | null;
  partyName: string | null;
  /**
   * The billed-to address BELOW the company name, as the source wrote it, one
   * source line per entry.
   *
   * Kept as lines rather than a single joined string because the line breaks are
   * part of the address: "C-21,22 \"U\" Road," / "Wagle Industrial Estate," /
   * "Thane - 400 604." is three facts, and re-joining them would let a renderer
   * reflow the invoice in a way the workbook never did. Empty on a sheet whose
   * billed-to block carries no name or address, which is a real case — the
   * acceptance workbook SAMPLE.xlsx has none on either sheet.
   */
  partyAddress: string[];
  partyGstNo: string | null;

  invoiceNo: string | null;
  invoiceDate: string | null;
  ourChallanNo: string | null;
  ourChallanDate: string | null;
  yourChallanNo: string | null;
  yourChallanDate: string | null;
  orderNo: string | null;
  orderNoLabel: string | null;
  orderDate: string | null;
  ewayBillNo: string | null;
  /**
   * The "Date:" sub-cell of the e-way row.
   *
   * Display-only: the production workbook writes `Eway Bill No.:` with a `Date:`
   * beside it, and the invoice has to show both halves of that row even when
   * they are blank. There is deliberately no column for it in `bills` — the PDF
   * is rendered from this parse in the same request, so nothing needs storing.
   */
  ewayBillDate: string | null;
  placeOfSupply: string | null;
  state: string | null;
  stateCode: string | null;
  transporterMode: string | null;
  vehicleNumber: string | null;

  /**
   * The reference block exactly as the source laid it out, in source row order.
   *
   * Empty entries are KEPT: a blank `Your Challan No.` is still a row of the
   * invoice. See `ReferenceRow`.
   */
  referenceRows: ReferenceRow[];

  lineItems: BillLineItem[];
  totalQuantity: number | null;
  amountBeforeTax: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  totalGst: number | null;
  amountAfterTax: number | null;
  reverseChargeGst: number | null;
  roundOff: number | null;
  amountInWords: string | null;
  jobKind: string | null;

  /**
   * The tax RATES, as PERCENTAGE numbers: 9 means 9%.
   *
   * The workbook writes the rate as a fraction in the cell beside "ADD:  CGST"
   * (0.09 for 9%), so the fraction is converted once, here, and every reader
   * downstream works in percent. A stored rate is also the only way the rate can
   * be printed when the tax AMOUNT is zero: IGST is 0.00 on every intra-state
   * invoice, so a rate derived from the amount would be absent exactly when the
   * 18% IGST rate is most worth showing.
   *
   * Null when the source printed no rate cell, which falls back to deriving it
   * from the amount at render time.
   */
  cgstRate: number | null;
  sgstRate: number | null;
  igstRate: number | null;

  bankLines: string[];
  termsLines: string[];
  signatureLines: string[];
  notes: string[];

  /**
   * The footer's template wording, named so it can be edited and so a re-print
   * from the database can restore it instead of inventing it.
   */
  certification: string | null;
  /** "For SAASTHA ENGINEERING WORKS" */
  onBehalfOf: string | null;
  /** "(Proprietor)" */
  signatureDesignation: string | null;
  /** "(Receivers Signature)" */
  receiverSignature: string | null;
  /** Any footer annotation that is none of the four above, kept so none is lost. */
  notesExtra: string[];
}

export interface ParsedBill {
  sheetName: string;
  original: BillCopy;
  duplicate: BillCopy;
  triplicate: BillCopy;
}

/** Rejection reason, phrased for the admin who uploaded the file. */
export class BillFormatError extends Error {
  readonly sheetName: string | null;
  constructor(message: string, sheetName: string | null = null) {
    super(message);
    this.name = "BillFormatError";
    this.sheetName = sheetName;
  }
}

/* ──────────────────────────────────────────────
   Copy-block discovery
   ────────────────────────────────────────────── */

const COPY_KEYWORDS: Record<string, CopyKind> = {
  ORIGINAL: "original",
  DUPLICATE: "duplicate",
  TRIPLICATE: "triplicate",
};

interface RowCell {
  col: number;
  text: string;
}

export interface Block {
  kind: CopyKind;
  label: string;
  start: number; // 0-based, inclusive
  end: number; // 0-based, inclusive
}

/**
 * Find the ORIGINAL / DUPLICATE / TRIPLICATE spans by reading the copy labels.
 *
 * A label must EQUAL one of the three keywords after normalisation. Matching is
 * deliberately exact rather than a substring test: this template's header row
 * carries the note "Original Copy of Invoice for Receipt ... Duplicate &
 * Triplicate Supplier or Transporter", and a substring search would mistake that
 * one sentence for two extra copies.
 */
export function findCopyBlocks(sheet: Sheet): Block[] {
  const hits: { kind: CopyKind; label: string; row: number }[] = [];

  for (let r = 0; r <= sheet.maxRow; r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      const raw = textAt(sheet, r, c);
      if (!raw) continue;
      const kind = COPY_KEYWORDS[squash(raw)];
      if (!kind) continue;
      hits.push({ kind, label: norm(raw).toUpperCase(), row: r });
      break; // one copy label per row is enough
    }
  }

  hits.sort((a, b) => a.row - b.row);

  // Each labelled row starts a block running until the next labelled row.
  return hits.map((hit, i) => ({
    kind: hit.kind,
    label: hit.label,
    start: hit.row,
    end: i + 1 < hits.length ? hits[i + 1].row - 1 : sheet.maxRow,
  }));
}

/* ──────────────────────────────────────────────
   In-block navigation
   ────────────────────────────────────────────── */

interface Hit {
  row: number;
  col: number;
  text: string;
}

class CopyReader {
  readonly sheet: Sheet;
  readonly start: number;
  readonly end: number;

  constructor(sheet: Sheet, start: number, end: number) {
    this.sheet = sheet;
    this.start = start;
    this.end = end;
  }

  get firstRow(): number {
    return this.start;
  }
  get lastRow(): number {
    return this.end;
  }

  /** Non-empty cells of a row, ascending by column. */
  row(row: number): RowCell[] {
    const out: RowCell[] = [];
    for (let c = 0; c <= this.sheet.maxCol; c++) {
      const t = textAt(this.sheet, row, c);
      if (t !== "") out.push({ col: c, text: norm(t) });
    }
    return out;
  }

  /** Non-empty cells of one column, within a row range, ascending by row. */
  colCells(col: number, from: number, to: number): { row: number; text: string }[] {
    const out: { row: number; text: string }[] = [];
    for (let r = Math.max(from, this.start); r <= Math.min(to, this.end); r++) {
      const t = textAt(this.sheet, r, col);
      if (t !== "") out.push({ row: r, text: norm(t) });
    }
    return out;
  }

  /** First cell whose squashed text EQUALS `target`, scanning row-major. */
  findExact(target: string, fromRow = this.start, fromCol = 0): Hit | null {
    for (let r = fromRow; r <= this.end; r++) {
      for (let c = fromCol; c <= this.sheet.maxCol; c++) {
        const t = textAt(this.sheet, r, c);
        if (t && squash(t) === target) return { row: r, col: c, text: norm(t) };
      }
    }
    return null;
  }

  /** First cell matching `re`, scanning row-major. */
  findMatch(re: RegExp, fromRow = this.start, fromCol = 0): Hit | null {
    for (let r = fromRow; r <= this.end; r++) {
      for (let c = fromCol; c <= this.sheet.maxCol; c++) {
        const t = textAt(this.sheet, r, c);
        if (t && re.test(t)) return { row: r, col: c, text: norm(t) };
      }
    }
    return null;
  }

  /** Non-empty cells strictly to the right of `col` on `row`, in order. */
  rightOf(row: number, col: number): RowCell[] {
    const out: RowCell[] = [];
    for (let c = col + 1; c <= this.sheet.maxCol; c++) {
      const t = textAt(this.sheet, row, c);
      if (t !== "") out.push({ col: c, text: norm(t) });
    }
    return out;
  }

  num(row: number, col: number): number | null {
    return numberAt(this.sheet, row, col);
  }

  text(row: number, col: number): string {
    return norm(textAt(this.sheet, row, col));
  }
}

/* ──────────────────────────────────────────────
   Amount coercion
   ────────────────────────────────────────────── */

// Placeholders this template writes instead of a number. An intra-state invoice
// puts a literal "-" on the IGST row, which means zero, not "unknown".
const PLACEHOLDER_AMOUNTS = new Set([
  "-", "--", "---", "", "N/A", "NA", "N.A.", "NIL", "NONE", "0", "0.00",
]);

function toAmount(value: number | null, rawText: string): number | null {
  if (value !== null) return value;
  const t = norm(rawText).toUpperCase();
  if (PLACEHOLDER_AMOUNTS.has(t)) return 0;
  const cleaned = t.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** The amount sitting to the right of a label, tolerating "-" placeholders. */
function amountRightOf(r: CopyReader, row: number, col: number): number | null {
  const cells = r.rightOf(row, col);
  if (cells.length === 0) return null;
  return toAmount(r.num(row, cells[0].col), cells[0].text);
}

/**
 * A tax row carries an extra rate cell before the amount
 * ("ADD: CGST | 9% | 1192.50"), so rate = first right-hand cell and
 * amount = second. A row with only one right-hand cell is a plain total.
 */
function readTaxRow(r: CopyReader, row: number, col: number): { rate: number | null; amount: number | null } {
  const cells = r.rightOf(row, col);
  if (cells.length === 0) return { rate: null, amount: null };
  const first = r.num(row, cells[0].col) ?? toAmount(null, cells[0].text);
  if (cells.length === 1) return { rate: null, amount: first };
  const second = toAmount(r.num(row, cells[1].col), cells[1].text);
  return { rate: first, amount: second };
}

/**
 * The workbook's tax-rate cell to a PERCENTAGE.
 *
 * Every sheet in the production workbook writes the rate as a FRACTION — 0.09
 * beside "ADD:  CGST" for a 9% CGST, 0.18 for IGST — while the amount beside it is
 * the currency figure. The fraction is converted once, here, so that every
 * consumer downstream works in percent and none of them has to remember a factor
 * of 100.
 *
 * The `>= 1` branch is not a guess at the workbook's style. It makes the function
 * total: a template that already wrote `9` is read as 9%, and a rate below 1 is
 * read as a fraction. Both are the only two ways a rate can be written, and the
 * alternative — assuming one style — would silently print 0.09% for a workbook
 * that wrote 9.
 */
function taxRatePercent(rate: number | null): number | null {
  if (rate === null || !Number.isFinite(rate) || rate < 0) return null;
  if (rate === 0) return 0;
  return rate < 1 ? Math.round(rate * 10000) / 100 : rate;
}

/* ──────────────────────────────────────────────
   Line-item table
   ────────────────────────────────────────────── */

interface TableHeader {
  row: number;
  sr: number;
  desc: number;
  hsn: number | null;
  uom: number | null;
  qty: number;
  rate: number | null;
  amt: number;
}

const HEADER_KEYS: Record<string, "sr" | "desc" | "hsn" | "uom" | "qty" | "rate" | "amt"> = {
  SRNO: "sr",
  DESCRIPTION: "desc",
  HSNCODE: "hsn",
  HSN: "hsn",
  UOM: "uom",
  QUANTITY: "qty",
  QTY: "qty",
  RATE: "rate",
  AMOUNT: "amt",
  AMT: "amt",
};

/** Locate the line-item table and read its column positions from its header. */
function findTableHeader(r: CopyReader): TableHeader | null {
  for (let row = r.firstRow; row <= r.lastRow; row++) {
    const found = new Map<string, number>();
    for (const cell of r.row(row)) {
      const key = HEADER_KEYS[squash(cell.text)];
      // First column wins, so a stray repeat further right cannot hijack it.
      if (key && !found.has(key)) found.set(key, cell.col);
    }
    // Require the four columns that make a table unambiguous.
    if (found.has("sr") && found.has("desc") && found.has("qty") && found.has("amt")) {
      return {
        row,
        sr: found.get("sr")!,
        desc: found.get("desc")!,
        hsn: found.get("hsn") ?? null,
        uom: found.get("uom") ?? null,
        qty: found.get("qty")!,
        rate: found.get("rate") ?? null,
        amt: found.get("amt")!,
      };
    }
  }
  return null;
}

function readLineItems(
  sheet: Sheet,
  r: CopyReader,
  header: TableHeader,
  lastRow: number
): BillLineItem[] {
  const items: BillLineItem[] = [];
  const stop = Math.min(lastRow, r.lastRow);

  for (let row = header.row + 1; row <= stop; row++) {
    const srNo = r.num(row, header.sr);
    const description = r.text(row, header.desc);

    if (srNo !== null) {
      // A serial number in the first column always starts a new line item.
      items.push({
        srNo,
        description,
        hsnCode: header.hsn !== null ? r.text(row, header.hsn) || null : null,
        uom: header.uom !== null ? r.text(row, header.uom) || null : null,
        quantity: r.num(row, header.qty),
        rate: header.rate !== null ? r.num(row, header.rate) : null,
        amount: r.num(row, header.amt),
      });
    } else if (description !== "" && items.length > 0) {
      // A wrapped description continues on the next row with no serial number.
      const prev = items[items.length - 1];
      prev.description = norm(`${prev.description} ${description}`);
    }
  }

  void sheet;
  return items;
}

/* ──────────────────────────────────────────────
   Footer
   ────────────────────────────────────────────── */

const TOTAL_LABELS = new Set([
  "TOTALQUANTITY",
  "TOTALAMOUNTBEFORETAX",
  "ADDCGST",
  "ADDSGST",
  "ADDIGST",
  "TOTALAMOUNTGST",
  "TOTALAMOUNTAFTERTAX",
  "GSTPAYABLEONREVERSE",
  "ROUNDOFF",
]);

const SIGNATURE_RE = /signature|proprietor|receiver|authori[sz]ed\s*(sign|for)/i;

/**
 * A footer line that is ONLY a designation — "(Proprietor)", "Director" — as
 * opposed to "For SAASTHA ENGINEERING WORKS", which names a party.
 *
 * The two are separated because they print on different lines of the same
 * signature block and a re-print has to know which is which.
 */
const DESIGNATION_ONLY_RE =
  /^\s*\(?\s*(proprietor|proprietorship|director|partner|signatory|manager)\s*\)?\s*$/i;

/**
 * Every label this template uses in the invoice header band. Used only to tell
 * a field's VALUE apart from a neighbouring field's LABEL.
 */
const FIELD_LABEL_RES: RegExp[] = [
  /\bINVOICE\s*NO\b/i,
  /\bOUR\s*CHALLAN\s*NO\b/i,
  /\bYOUR\s*CHALLAN\s*NO\b/i,
  /\b(?:SERVICE|PURCHASE|SALES)\s*ORDER\s*NO\b/i,
  /\bEWAY\s*BILL\s*NO\b/i,
  /\bPLACE\s*OF\s*SUPPLY\b/i,
  /\bTRANSPORTER\s*MODE\b/i,
  /^date\s*:?$/i,
  /\bSTATE\s*CODE\b/i,
  /^\s*STATE\s*:/i,
];

function isFieldLabel(text: string): boolean {
  return FIELD_LABEL_RES.some((re) => re.test(text));
}

/* ──────────────────────────────────────────────
   Copy parsing
   ────────────────────────────────────────────── */

function parseCopy(sheet: Sheet, block: Block, sheetName: string): BillCopy {
  const r = new CopyReader(sheet, block.start, block.end);
  const first = r.firstRow;
  const last = r.lastRow;

  /* ---- header / seller block -------------------------------------------- */

  const titleHit = r.findExact("TAXINVOICE");
  // Column holding the invoice's left-hand text (B in the sample), derived from
  // the title cell so a shifted layout still resolves.
  const leftCol = titleHit ? titleHit.col : 0;
  const headerTop = titleHit ? titleHit.row : first;

  const invoiceHit = r.findMatch(/\bINVOICE\s*NO\b/i, first, 1);
  const headerBottom = invoiceHit ? invoiceHit.row - 1 : Math.min(last, headerTop + 8);

  /* The line-item table is located up front because it is the hard floor for
     every header-side block that follows: the recipient's address run, the state
     line and the bank block all have to stop before it, and finding it here means
     they do not each have to rediscover it. `findTableHeader` is a pure scan, so
     calling it before it is used changes nothing about the result. */
  const tableHeader = findTableHeader(r);
  if (!tableHeader) {
    throw new BillFormatError(
      `Could not recognize the bill format on sheet '${sheetName}'. ` +
        `Expected a line-item table with SR.NO., DESCRIPTION, QUANTITY and AMOUNT columns.`,
      sheetName
    );
  }

  // leftHeader[0] is the title itself; the rest are the seller's lines in order.
  const leftHeader = r.colCells(leftCol, headerTop, headerBottom);
  const sellerName = leftHeader[1]?.text ?? null;
  const sellerDescriptor = leftHeader[2]?.text ?? null;
  const sellerTaxLine = leftHeader[3]?.text ?? null;
  const sellerAddress = leftHeader[4]?.text ?? null;
  const sellerContact = leftHeader[5]?.text ?? null;

  /* ---- labelled header fields ------------------------------------------- */

  // A value is "the first non-empty cell to the right of its label", which is
  // immune to the label moving between columns. Searching from column 1 keeps
  // the "TAX INVOICE" title (column B) from being read as an "INVOICE NO".
  //
  // Cells that are themselves labels are skipped: an empty "Your Challan No.:"
  // row is immediately followed by its own "Date:" sub-label, and without this
  // the field would capture the text "Date:" as its value.
  const labelled = (re: RegExp): { hit: Hit; value: string | null } | null => {
    const hit = r.findMatch(re, first, 1);
    if (!hit) return null;
    const value = r.rightOf(hit.row, hit.col).find((c) => !isFieldLabel(c.text))?.text ?? null;
    return { hit, value };
  };

  const invoiceNo = labelled(/\bINVOICE\s*NO\b/i);
  const ourChallan = labelled(/\bOUR\s*CHALLAN\s*NO\b/i);
  const yourChallan = labelled(/\bYOUR\s*CHALLAN\s*NO\b/i);
  const order = labelled(/\b(?:SERVICE|PURCHASE|SALES)\s*ORDER\s*NO\b/i);
  const eway = labelled(/\bEWAY\s*BILL\s*NO\b/i);
  const supply = labelled(/\bPLACE\s*OF\s*SUPPLY\b/i);
  const transporter = labelled(/\bTRANSPORTER\s*MODE\b/i);

  /** The "Date:" sub-label of a labelled row, if that row has one. */
  const dateOnRow = (row: number): string | null => {
    const marker = r.row(row).find((c) => /^date\s*:?$/i.test(c.text));
    if (!marker) return null;
    const cells = r.rightOf(row, marker.col);
    if (cells.length === 0) return null;
    const serial = r.num(row, cells[0].col);
    return serial !== null ? serialToDate(serial) : null;
  };

  /* ---- the reference block, in the order the source wrote it --------------
   *
   * Sorted by row so the PDF's grid follows the workbook rather than a hardcoded
   * ordering, and a label found in the source is emitted even when its value is
   * null. `invoiceNo` is included only when the source really had that label; the
   * fallback below guarantees at least the invoice row so the grid is never empty.
   */
  const referenceRows: ReferenceRow[] = [
    { hit: invoiceNo?.hit ?? null, label: "Invoice No.", value: invoiceNo?.value ?? null },
    { hit: ourChallan?.hit ?? null, label: "Our Challan No.", value: ourChallan?.value ?? null },
    { hit: yourChallan?.hit ?? null, label: "Your Challan No.", value: yourChallan?.value ?? null },
    {
      hit: order?.hit ?? null,
      label: (order?.hit.text ?? "Order No.").replace(/[:.\s]+$/, ""),
      value: order?.value ?? null,
    },
    { hit: eway?.hit ?? null, label: "Eway Bill No.", value: eway?.value ?? null },
  ]
    .filter((entry) => entry.hit !== null || entry.label === "Invoice No.")
    .sort((a, b) => (a.hit?.row ?? Number.MAX_SAFE_INTEGER) - (b.hit?.row ?? Number.MAX_SAFE_INTEGER))
    .map((entry) => ({
      label: entry.label,
      value: entry.value,
      date: entry.hit ? dateOnRow(entry.hit.row) : null,
      hasDateCell: entry.hit ? r.row(entry.hit.row).some((c) => /^date\s*:?$/i.test(c.text)) : false,
    }));

  /* ---- state / party ---------------------------------------------------- */

  // The template merges "State: Maharashtra       State Code:27" into one cell
  // and also repeats the code in a standalone "STATE CODE:27" cell. Read the
  // combined cell first, then fall back to the standalone one.
  let state: string | null = null;
  let stateCode: string | null = null;
  const combined = r.findMatch(/state\s*:\s*\D+state\s*code\s*:?\s*\d/i, first, 0);
  if (combined) {
    const m = /state\s*:\s*(.*?)\s+state\s*code\s*:?\s*(\d+)/i.exec(combined.text);
    if (m) {
      state = m[1].trim() || null;
      stateCode = m[2];
    }
  }
  if (!stateCode) {
    const sc = r.findMatch(/state\s*code\s*:?\s*(\d+)/i, first, 1);
    const m = sc ? /state\s*code\s*:?\s*(\d+)/i.exec(sc.text) : null;
    stateCode = m ? m[1] : null;
  }

  let partyGstNo: string | null = null;
  const gstHit = r.findMatch(/party'?s?\s*gst\s*no/i, first, 0);
  if (gstHit) {
    const inline = /gst\s*no\.?\s*:?\s*([0-9A-Za-z]{15})/i.exec(gstHit.text);
    if (inline) {
      partyGstNo = inline[1].toUpperCase();
    } else {
      const cells = r.rightOf(gstHit.row, gstHit.col);
      if (cells.length > 0) {
        const cleaned = cells[0].text.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
        if (cleaned.length >= 15) partyGstNo = cleaned.slice(0, 15);
      }
    }
  }

  /* ---- recipient block -------------------------------------------------- */

  // This template spells it "Details of Receipient (Billed To)"; match either
  // spelling. The template's own header note mentions neither, so it cannot be
  // mistaken for the recipient block.
  const recipientHit = r.findMatch(/billed\s*to|recipient|receipient/i, headerTop, 0);
  const recipientHeading = recipientHit?.text ?? null;
  const recipientNote = recipientHit
    ? (r
        .row(recipientHit.row)
        .find((c) => c.col > recipientHit.col && !/billed\s*to|recipient|receipient/i.test(c.text))
        ?.text ?? null)
    : null;

  /* ---- recipient name and address ---------------------------------------- */

  /* The billed-to block is a run of consecutive left-column cells under its
     heading: the company name first, then one or more address lines. It is found
     by WALKING the column, not by assuming where the block ends.

     The previous implementation read `recipientHit.row + 1 .. invoiceHit.row - 1`,
     which is correct only if the recipient and the invoice number sit on
     different rows. In this template they sit on the SAME row — "M/s. Hawkins
     Cookers Ltd.," is in column B of the row whose column D reads "INVOICE
     NO.:" — so the range was always empty and the billed-to name and address were
     silently dropped from every invoice. Reading the column fixes that without
     hardcoding a row number.

     The run stops at the first of:
       * a blank row, because an address does not contain blank lines;
       * a cell that is really a labelled field ("State: ...", "Party's GST No...")
         rather than address prose;
       * the line-item table, which is the block's hard floor.

     A sheet with no billed-to name or address therefore yields an empty list,
     which is correct and not a failure. */
  const addressLinesRaw: string[] = [];
  if (recipientHit) {
    const headingRow = recipientHit.row;
    const stateHit = r.findMatch(/^\s*state\s*:/i, headerTop, leftCol);
    const gstFieldHit = r.findMatch(/party'?s?\s*gst\s*no/i, headerTop, leftCol);
    const candidates = [stateHit?.row, gstFieldHit?.row, tableHeader.row].filter(
      (v): v is number => typeof v === "number" && v > headingRow
    );
    const blockEnd = candidates.length > 0 ? Math.min(...candidates) : tableHeader.row;

    for (let row = headingRow + 1; row < blockEnd; row++) {
      const [cell] = r.colCells(leftCol, row, row);
      // A blank ends the run: an address is consecutive lines, and a gap means
      // the next cell belongs to a different part of the invoice.
      if (!cell) break;
      if (/^\s*(state\s*:|party'?s?\s*gst\b|place\s*of\s*supply\b)/i.test(cell.text)) break;
      if (/^\s*(sr\.?\s*no|description|hsn|uom|quantity|rate|amount)\b/i.test(cell.text)) break;
      addressLinesRaw.push(cell.text.trim());
    }
  }

  /* The first line is the company name and the rest is the address — but only
     when there is more than one line. With a single line there is nothing to
     split and it is read as the name, which is what a one-line "billed to" means
     on a template that allows it. */
  const partyName = addressLinesRaw.length > 0 ? addressLinesRaw[0] : null;
  const partyAddress = addressLinesRaw.slice(1);

  /* ---- transporter mode / vehicle --------------------------------------- */

  let transporterMode: string | null = null;
  let vehicleNumber: string | null = null;
  if (transporter) {
    const cells = r.rightOf(transporter.hit.row, transporter.hit.col);
    if (cells.length > 0) {
      const mode = cells[0].text.replace(/[:\s]+$/, "");
      // "VEHICLE NO." is this template's mode label; the registration follows.
      transporterMode = /^VEHICLE\s*NO\.?$/i.test(mode) ? "VEHICLE" : mode;
      if (cells.length > 1) vehicleNumber = cells[1].text;
    }
  }

  /* ---- line items and totals ------------------------------------------- */

  // `tableHeader` was resolved with the rest of the header block, above.
  const header = tableHeader;

  const totalQtyHit = r.findExact("TOTALQUANTITY", header.row);
  const totalRow = totalQtyHit ? totalQtyHit.row : last;
  const lineItems = readLineItems(sheet, r, header, totalRow - 1);

  const beforeTaxHit = r.findExact("TOTALAMOUNTBEFORETAX", totalRow);
  const cgstHit = r.findExact("ADDCGST", totalRow);
  const sgstHit = r.findExact("ADDSGST", totalRow);
  const igstHit = r.findExact("ADDIGST", totalRow);
  const totalGstHit = r.findExact("TOTALAMOUNTGST", totalRow);
  const afterTaxHit = r.findExact("TOTALAMOUNTAFTERTAX", totalRow);
  const reverseHit = r.findExact("GSTPAYABLEONREVERSE", totalRow);
  const roundOffHit = r.findExact("ROUNDOFF", totalRow);

  /* ---- job kind (LABOUR JOB / WITHMETAL) ------------------------------- */

  // It sits left of the totals label, on the totals row itself.
  let jobKind: string | null = null;
  if (totalQtyHit) {
    for (let c = 0; c < totalQtyHit.col; c++) {
      const t = r.text(totalQtyHit.row, c);
      if (/^(?:LABOUR\s*JOB|WITH\s*?MATERIAL|WITH\s*METAL|WITHMETAL)$/i.test(t)) {
        jobKind = t.toUpperCase();
        break;
      }
    }
  }

  /* ---- footer: words, bank, terms, signatures, notes ------------------- */

  const wordsHit = r.findMatch(/amount\s*in\s*words/i, totalRow, 0);
  let amountInWords: string | null = null;
  if (wordsHit) {
    // "Total Invoice Amount in Words:- FIFTEEN THOUSAND ..." -> the words.
    const m = /in\s*words\s*[:\-–—]*\s*(.+)$/i.exec(wordsHit.text);
    if (m) amountInWords = norm(m[1]);
  }

  const bankHit = r.findMatch(/bank\s*details/i, totalRow, 0);
  const termsHit = r.findMatch(/terms\s*(?:and|&)?\s*conditions/i, totalRow, 0);

  // Bank lines run from their own label up to whichever comes first: the
  // amount-in-words line or the terms block.
  const bankEnd = Math.min(wordsHit?.row ?? last + 1, termsHit?.row ?? last + 1) - 1;
  const bankLines =
    bankHit !== null
      ? r.colCells(leftCol, bankHit.row, bankEnd).slice(1).map((c) => c.text)
      : [];

  // After the terms label every left-column line is either terms text or a
  // signature line; there is no reliable blank row to stop on, so classify.
  const termsLines: string[] = [];
  const signatureLines: string[] = [];
  if (termsHit) {
    for (const c of r.colCells(leftCol, termsHit.row, last)) {
      if (c.row === termsHit.row) continue;
      if (SIGNATURE_RE.test(c.text)) signatureLines.push(c.text);
      else termsLines.push(c.text);
    }
  }

  // Right-hand annotations in the footer (e.g. "Certified that the particulars
  // given above are true and correct"). Every cell belonging to the totals block
  // is excluded, so the totals are never echoed as prose and placeholders like
  // the intra-state "-" on the IGST row are not mistaken for a note.
  const totalsCells = new Set<string>();
  const markTotals = (hit: Hit | null): void => {
    if (!hit) return;
    totalsCells.add(`${hit.row}:${hit.col}`);
    for (const c of r.rightOf(hit.row, hit.col)) totalsCells.add(`${hit.row}:${c.col}`);
  };
  for (const hit of [
    totalQtyHit, beforeTaxHit, cgstHit, sgstHit, igstHit,
    totalGstHit, afterTaxHit, reverseHit, roundOffHit,
  ]) {
    markTotals(hit);
  }

  const notes: string[] = [];
  for (let row = totalRow; row <= last; row++) {
    if (wordsHit && row === wordsHit.row) continue;
    for (const cell of r.row(row)) {
      if (cell.col <= leftCol) continue;
      if (totalsCells.has(`${row}:${cell.col}`)) continue;
      const key = squash(cell.text);
      if (TOTAL_LABELS.has(key) || key === "DATE") continue;
      if (isFieldLabel(cell.text)) continue;
      if (/^\d+(?:\.\d+)?$/.test(key)) continue;
      if (notes.includes(cell.text)) continue;
      notes.push(cell.text);
    }
  }

  /* ---- footer wording, named so it stays editable ----------------------- */
  /* The four phrases the template prints in its footer are separated out by what
     they ARE, not by position, so a re-print from the database can restore them
     and an editor can offer them as fields. Anything left over is kept rather
     than dropped, because an unrecognised annotation on a real invoice is still
     part of that invoice. */
  let certification: string | null = null;
  let onBehalfOf: string | null = null;
  let signatureDesignation: string | null = null;
  const notesExtra: string[] = [];

  for (const note of notes) {
    if (/certif/i.test(note) && certification === null) certification = note;
    else if (DESIGNATION_ONLY_RE.test(note) && signatureDesignation === null) signatureDesignation = note;
    else if (/^\s*for\s+\S/i.test(note) && onBehalfOf === null) onBehalfOf = note;
    else notesExtra.push(note);
  }

  /* The receiver's caption is the left-hand half of the signature block, so it
     arrives in `signatureLines` rather than in `notes`. The first line is the
     caption; the rest stay as they are. */
  const receiverSignature = signatureLines[0] ?? null;

  return {
    kind: block.kind,
    label: block.label,
    firstRow: first + 1,
    lastRow: last + 1,

    sellerName,
    sellerDescriptor,
    sellerTaxLine,
    sellerAddress,
    sellerContact,

    recipientHeading,
    recipientNote,
    partyName,
    partyAddress,
    partyGstNo,

    invoiceNo: invoiceNo?.value ?? null,
    invoiceDate: invoiceHit ? dateOnRow(invoiceHit.row) : null,
    ourChallanNo: ourChallan?.value ?? null,
    ourChallanDate: ourChallan ? dateOnRow(ourChallan.hit.row) : null,
    yourChallanNo: yourChallan?.value ?? null,
    yourChallanDate: yourChallan ? dateOnRow(yourChallan.hit.row) : null,
    orderNo: order?.value ?? null,
    orderNoLabel: order?.hit.text ?? null,
    orderDate: order ? dateOnRow(order.hit.row) : null,
    ewayBillNo: eway?.value ?? null,
    ewayBillDate: eway ? dateOnRow(eway.hit.row) : null,
    referenceRows,
    placeOfSupply: supply?.value ?? null,
    state,
    stateCode,
    transporterMode,
    vehicleNumber,

    lineItems,
    totalQuantity: totalQtyHit ? amountRightOf(r, totalQtyHit.row, totalQtyHit.col) : null,
    amountBeforeTax: beforeTaxHit ? amountRightOf(r, beforeTaxHit.row, beforeTaxHit.col) : null,
    cgst: cgstHit ? readTaxRow(r, cgstHit.row, cgstHit.col).amount : null,
    sgst: sgstHit ? readTaxRow(r, sgstHit.row, sgstHit.col).amount : null,
    igst: igstHit ? readTaxRow(r, igstHit.row, igstHit.col).amount : null,
    // The rate cell was always read but always thrown away, which is why the
    // shipped PDF never showed the 18% IGST rate the workbook prints beside an
    // IGST amount of 0.00.
    cgstRate: cgstHit ? taxRatePercent(readTaxRow(r, cgstHit.row, cgstHit.col).rate) : null,
    sgstRate: sgstHit ? taxRatePercent(readTaxRow(r, sgstHit.row, sgstHit.col).rate) : null,
    igstRate: igstHit ? taxRatePercent(readTaxRow(r, igstHit.row, igstHit.col).rate) : null,
    totalGst: totalGstHit ? amountRightOf(r, totalGstHit.row, totalGstHit.col) : null,
    amountAfterTax: afterTaxHit ? amountRightOf(r, afterTaxHit.row, afterTaxHit.col) : null,
    reverseChargeGst: reverseHit ? amountRightOf(r, reverseHit.row, reverseHit.col) : null,
    // A present "Round Off" label with no value means no rounding was applied.
    roundOff: roundOffHit ? (amountRightOf(r, roundOffHit.row, roundOffHit.col) ?? 0) : null,
    amountInWords,
    jobKind,

    bankLines,
    termsLines,
    signatureLines,
    notes,

    certification,
    onBehalfOf,
    signatureDesignation,
    receiverSignature,
    notesExtra,
  };
}

/**
 * Fields whose three print copies disagree.
 *
 * The three blocks on a worksheet are three PHYSICAL COPIES of one invoice, so
 * every field they carry should be identical. They are not always: the production
 * workbook's sheet `320` writes `Your Challan No.: abc` in its ORIGINAL block and
 * leaves the row blank in its DUPLICATE and TRIPLICATE, so rendering each copy from
 * its own block produces an original that names a challan the other two do not.
 *
 * This exists so that is REPORTED rather than silently resolved. It is not fatal —
 * refusing a whole 20-invoice upload because one cell on one sheet is inconsistent
 * would be worse than importing it — and it is not silently corrected either,
 * because choosing which of two values is right is a business decision. The upload
 * records it in the audit log and prints all three copies from ORIGINAL, so the
 * three documents agree with each other and with the stored record.
 *
 * `firstRow`/`lastRow` and the row spans are excluded: they are diagnostics and
 * differ by construction.
 */
const CROSS_CHECKED_FIELDS: (keyof BillCopy)[] = [
  "invoiceNo", "invoiceDate",
  "ourChallanNo", "ourChallanDate",
  "yourChallanNo", "yourChallanDate",
  "orderNo", "orderNoLabel", "orderDate",
  "ewayBillNo", "ewayBillDate",
  "placeOfSupply", "state", "stateCode",
  "transporterMode", "vehicleNumber",
  "partyName", "partyGstNo", "jobKind",
  "totalQuantity", "amountBeforeTax", "cgst", "sgst", "igst", "totalGst",
  "amountAfterTax", "reverseChargeGst", "roundOff", "amountInWords",
  "cgstRate", "sgstRate", "igstRate",
];

/** One field whose three copies print different values. */
export interface CopyDisagreement {
  field: string;
  original: string | null;
  duplicate: string | null;
  triplicate: string | null;
}

export function copyDisagreements(parsed: ParsedBill): CopyDisagreement[] {
  const show = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
  const out: CopyDisagreement[] = [];
  for (const field of CROSS_CHECKED_FIELDS) {
    const values = [
      show(parsed.original[field]),
      show(parsed.duplicate[field]),
      show(parsed.triplicate[field]),
    ];
    if (values[0] === values[1] && values[1] === values[2]) continue;
    out.push({ field: String(field), original: values[0], duplicate: values[1], triplicate: values[2] });
  }
  return out;
}

/* ──────────────────────────────────────────────
   Sheet -> one Bill
   ────────────────────────────────────────────── */

export function parseSheet(sheet: Sheet): ParsedBill {
  const blocks = findCopyBlocks(sheet);
  const found = new Map<CopyKind, Block>();
  for (const b of blocks) if (!found.has(b.kind)) found.set(b.kind, b);

  const missing = COPY_ORDER.filter((k) => !found.has(k));
  if (missing.length > 0) {
    const pretty = missing.map((k) => COPY_LABEL[k]).join(", ");
    throw new BillFormatError(
      `Could not recognize the bill format on sheet '${sheet.name}'. ` +
        `Expected ORIGINAL, DUPLICATE and TRIPLICATE sections; missing ${pretty}.`,
      sheet.name
    );
  }

  const original = parseCopy(sheet, found.get("original")!, sheet.name);
  const duplicate = parseCopy(sheet, found.get("duplicate")!, sheet.name);
  const triplicate = parseCopy(sheet, found.get("triplicate")!, sheet.name);

  if (!original.invoiceNo) {
    throw new BillFormatError(
      `Could not recognize the bill format on sheet '${sheet.name}'. ` +
        `The invoice number could not be identified.`,
      sheet.name
    );
  }
  if (original.amountBeforeTax === null && original.amountAfterTax === null) {
    throw new BillFormatError(
      `Could not recognize the bill format on sheet '${sheet.name}'. ` +
        `The financial totals could not be determined.`,
      sheet.name
    );
  }

  return { sheetName: sheet.name, original, duplicate, triplicate };
}

export const COPY_LABEL: Record<CopyKind, string> = {
  original: "ORIGINAL",
  duplicate: "DUPLICATE",
  triplicate: "TRIPLICATE",
};

/* ──────────────────────────────────────────────
   Workbook
   ────────────────────────────────────────────── */

export interface WorkbookParseResult {
  /** One entry per worksheet, in workbook order. */
  bills: ParsedBill[];
  /** Sheets that did not look like a bill, with the reason. */
  skipped: { sheetName: string; reason: string }[];
}

export function parseBills(sheets: Sheet[]): WorkbookParseResult {
  const bills: ParsedBill[] = [];
  const skipped: { sheetName: string; reason: string }[] = [];

  for (const sheet of sheets) {
    try {
      bills.push(parseSheet(sheet));
    } catch (err) {
      skipped.push({
        sheetName: sheet.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (bills.length === 0) {
    const detail = skipped.length > 0 ? ` ${skipped[0].reason}` : "";
    throw new BillFormatError(`No recognizable bill sheet was found in this workbook.${detail}`);
  }

  return { bills, skipped };
}

/* ──────────────────────────────────────────────
   Filenames
   ────────────────────────────────────────────── */

/** Characters that are unsafe in a storage object name or a download filename. */
export function sanitizeBaseName(filename: string): string {
  const withoutExt = filename.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, "");
  const cleaned = withoutExt
    .replace(/[<>:"/\\|?* -]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "bill";
}

/**
 * A short, safe, human-readable token for ONE bill, used to name that bill's own
 * PDF objects.
 *
 * The invoice number is a bill's real identity, so it is preferred:
 * `SEW/301/2026-27` becomes `SEW_301_2026-27`, and the stored object is
 * `<upload-id>/<bill-id>_SEW_301_2026-27_original.pdf`. The bill's id is always
 * part of the path, so two invoices can never collide even if this token did.
 *
 * Falls back to the sheet name, then to a generic token, so a workbook whose
 * invoice cell was left blank still produces a named, readable file rather than
 * `undefined_original.pdf`.
 */
export function safeBillToken(invoiceNo: string | null, sheetName: string | null): string {
  const raw = (invoiceNo ?? "").trim() || (sheetName ?? "").trim() || "bill";
  const cleaned = raw
    // Slashes get their own pass so they cannot become a nested object path, and
    // they become "_" so `SEW/301/2026-27` reads as `SEW_301_2026-27`: the path
    // separators are replaced, the ones that are part of the number are kept.
    .replace(/[\\/]+/g, "_")
    // Hyphen is deliberately NOT in this set. It is safe in a storage object name
    // and in a download filename, and `SEW_301_2026-27` reads far better as a
    // document name than `SEW_301_2026_27`.
    .replace(/[<>:"/\\|?*\s]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 60) : "bill";
}
