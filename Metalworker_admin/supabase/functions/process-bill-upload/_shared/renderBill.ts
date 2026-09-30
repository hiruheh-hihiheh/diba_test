// supabase/functions/process-bill-upload/_shared/renderBill.ts
//
// Lays a parsed bill out as a print-ready A4 tax invoice.
//
// WHAT "LOOKS LIKE A REAL INVOICE" MEANS HERE
// The requirement is explicitly NOT an HTML table dumped onto the page. So the
// sheet reproduces the structure a paper tax invoice actually has:
//
//   - the copy marker (ORIGINAL / DUPLICATE / TRIPLICATE) so a printed page can
//     be filed in the right column
//   - the seller's identity block, a rule, and a boxed TAX INVOICE heading
//   - a "Billed To" block beside a bordered key/value grid of invoice, challan,
//     order and e-way references, each with its own date
//   - a bordered line-item table with its own header row, right-aligned numeric
//     columns, and a repeated header when items overflow to a second page
//   - a right-hand totals block with the grand total boxed
//   - the amount in words, then bank details beside terms & conditions
//   - signature blocks for the supplier and the receiver
//
// LAYOUT RULES THAT KEEP IT CLEAN
// * Every block is measured before it is drawn, so wrapped text never overlaps
//   what follows it. That is the whole reason this is not a stream of draw calls
//   with hard-coded gaps.
// * Numeric columns are right-aligned using real glyph metrics, so the decimal
//   points line up down the page.
// * Nothing is positioned from Excel row numbers, so an empty row in the source
//   produces no gap and a long description simply takes the space it needs.
// * A page break is only ever taken between table rows, and the footer is
//   stamped last, so there are no orphaned headings and no blank trailing page.

import type { BillCopy, BillLineItem } from "./parseBill.ts";
import { formatJobKind } from "./formatJobKind.ts";
import { PdfDocument, type PdfPage, wrapText } from "./pdf.ts";
import { measureText } from "./fontMetrics.ts";

/* ──────────────────────────────────────────────
   Geometry
   ────────────────────────────────────────────── */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 30;
const MARGIN_TOP = 26;
const MARGIN_BOTTOM = 34;
const CONTENT_W = PAGE_W - 2 * MARGIN_X; // 535.28
const CONTENT_BOTTOM = PAGE_H - MARGIN_BOTTOM;

// Line-item table columns. The three numeric columns are right-aligned.
const COL_SR = 30;
const COL_DESC = 233;
const COL_HSN = 62;
const COL_UOM = 38;
const COL_QTY = 45;
const COL_RATE = 62;
const COL_AMT = 65.28;
const HEADER_H = 18;
const CELL_PAD = 4;

/* ──────────────────────────────────────────────
   Formatting
   ────────────────────────────────────────────── */

/** Indian digit grouping: 12,345.00 */
function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const negative = value < 0;
  const [whole, frac] = Math.abs(value).toFixed(2).split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest === "" ? last3 : `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
  return `${negative ? "-" : ""}${grouped}.${frac}`;
}

/** Quantities drop trailing zeros: 1, 1.5, 0.25 - never "1.00". */
function qty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return String(Math.round(value * 1000) / 1000);
}

/** ISO date -> "dd/mm/yyyy", the format an Indian bill is written in. */
function prettyDate(value: string | null | undefined): string {
  if (!value) return "-";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}

function orDash(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? "-" : v;
}

/** A tax rate implied by the charge actually levied, for the totals block. */
function impliedRate(tax: number | null, base: number | null): string | null {
  if (tax === null || base === null || base === 0 || tax <= 0) return null;
  const rate = (tax / base) * 100;
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2)}%`;
}

/* ──────────────────────────────────────────────
   Layout cursor
   ────────────────────────────────────────────── */

/**
 * Owns the page-break policy so no individual block has to think about it, and
 * exposes the left/right content edges so blocks stay aligned to each other.
 */
class Sheet {
  readonly doc: PdfDocument;
  page: PdfPage;
  y = MARGIN_TOP;

  constructor(title: string, subject: string) {
    this.doc = new PdfDocument({ title, subject });
    this.page = this.doc.addPage();
  }

  /** Break to a new page if `height` would not fit on the current one. */
  reserve(height: number): void {
    if (this.y + height <= CONTENT_BOTTOM) return;
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage();
    this.y = MARGIN_TOP;
  }

  get left(): number {
    return MARGIN_X;
  }
  get right(): number {
    return MARGIN_X + CONTENT_W;
  }
}

/* ──────────────────────────────────────────────
   Header
   ────────────────────────────────────────────── */

function renderHeader(sheet: Sheet, bill: BillCopy): void {
  const { page } = sheet;
  const L = sheet.left;
  const R = sheet.right;

  // Reserve the right-hand strip for the copy marker so a long seller name can
  // never run underneath it.
  const bodyWidth = CONTENT_W - 110;
  const top = sheet.y;

  // --- copy marker, top right ----------------------------------------------
  page.text(bill.label, R, top + 12, { font: "bold", size: 11, align: "right" });

  // --- seller identity, top left -------------------------------------------
  const sellerLines: { text: string; bold: boolean; size: number }[] = [];
  if (bill.sellerName) sellerLines.push({ text: bill.sellerName, bold: true, size: 11 });
  for (const text of [
    bill.sellerDescriptor,
    bill.sellerTaxLine,
    bill.sellerAddress,
    bill.sellerContact,
  ]) {
    if (!text) continue;
    const size = 7.5;
    for (const line of wrapText(text, bodyWidth, "regular", size)) {
      sellerLines.push({ text: line, bold: false, size });
    }
  }

  let y = top;
  for (const line of sellerLines) {
    page.text(line.text, L, y + line.size, {
      font: line.bold ? "bold" : "regular",
      size: line.size,
    });
    y += line.bold ? 13 : 9.6;
  }

  y += 5;
  page.line(L, y, R, y, 1.1);
  y += 5;

  // --- boxed TAX INVOICE heading -------------------------------------------
  const headingH = 24;
  page.rect(L, y, CONTENT_W, headingH, { lineWidth: 1.2, stroke: true });
  page.text("TAX INVOICE", (L + R) / 2, y + 16.5, {
    font: "bold",
    size: 15,
    align: "center",
  });

  /* --- job classification badge, inside the heading box, left --------------
     This is the one piece of the invoice that decides how it must be accounted
     for, so it belongs where an operator's eye lands first. It is drawn INSIDE
     the existing heading box rather than on a new line, which means the box, its
     border, every gap below it and the whole rest of the page keep their exact
     current geometry - nothing reflows.

     Position is measured, not guessed: the badge hugs the left inset and the
     centred "TAX INVOICE" is only ~103pt wide, so the two cannot collide at any
     heading size. The label is the normalized display form, so a stored
     "WITHMETAL" prints as "WITH METAL". */
  const jobLabel = formatJobKind(bill.jobKind);
  if (jobLabel) {
    const badgeSize = 8.5;
    const padX = 7;
    const badgeTextW = measureText(jobLabel, "bold", badgeSize);
    const badgeW = badgeTextW + padX * 2;
    const badgeH = 13;
    const badgeX = L + 6;
    const badgeY = y + (headingH - badgeH) / 2;

    page.rect(badgeX, badgeY, badgeW, badgeH, {
      lineWidth: 0.7,
      stroke: true,
      color: [0, 0, 0],
    });
    page.text(jobLabel, badgeX + padX, badgeY + 9.3, { font: "bold", size: badgeSize });
  }

  sheet.y = y + headingH + 12;
}

/* ──────────────────────────────────────────────
   Parties + reference grid
   ────────────────────────────────────────────── */

interface LeftLine {
  text: string;
  bold: boolean;
  size: number;
}

function renderParties(sheet: Sheet, bill: BillCopy): void {
  const { page } = sheet;
  const L = sheet.left;
  const R = sheet.right;
  const top = sheet.y;

  const gridW = 250;
  const leftW = CONTENT_W - gridW - 12;
  const gridX = R - gridW;

  /* ---- left column: who is being billed ---------------------------------- */
  const leftLines: LeftLine[] = [];
  if (bill.recipientHeading) leftLines.push({ text: bill.recipientHeading, bold: true, size: 8.5 });
  if (bill.partyName) leftLines.push({ text: bill.partyName, bold: true, size: 9 });
  if (bill.partyGstNo) {
    leftLines.push({ text: `Party's GST No. ${bill.partyGstNo}`, bold: false, size: 8 });
  }
  if (bill.placeOfSupply || bill.state || bill.stateCode) {
    const bits = [
      bill.placeOfSupply ? `Place of Supply: ${bill.placeOfSupply}` : null,
      bill.state ? `State: ${bill.state}` : null,
      bill.stateCode ? `State Code: ${bill.stateCode}` : null,
    ].filter((b): b is string => b !== null);
    leftLines.push({ text: bits.join("    "), bold: false, size: 8 });
  }
  if (bill.vehicleNumber) {
    const parts = [bill.transporterMode ? `Transporter: ${bill.transporterMode}` : null];
    parts.push(`Vehicle No.: ${bill.vehicleNumber}`);
    leftLines.push({ text: parts.filter(Boolean).join("    "), bold: false, size: 8 });
  }

  // Wrap first, then draw, so the box is exactly as tall as its contents.
  const leftWrapped: string[][] = [];
  let leftHeight = 0;
  for (const line of leftLines) {
    const wrapped = wrapText(line.text, leftW - 10, line.bold ? "bold" : "regular", line.size);
    leftWrapped.push(wrapped);
    leftHeight += wrapped.length * (line.size + 2) + 1.5;
  }
  leftHeight = Math.max(leftHeight + 6, 26);

  /* ---- right column: document references --------------------------------- */
  // Empty pairs are omitted rather than drawn blank, so a template with no
  // e-way bill does not leave a row of empty boxes behind.
  const pairs: { label: string; value: string | null }[] = [
    { label: "Invoice No.", value: bill.invoiceNo },
    { label: "Invoice Date", value: bill.invoiceDate ? prettyDate(bill.invoiceDate) : null },
    { label: "Our Challan No.", value: bill.ourChallanNo },
    { label: "Challan Date", value: bill.ourChallanDate ? prettyDate(bill.ourChallanDate) : null },
  ];
  if (bill.yourChallanNo) {
    pairs.push({ label: "Your Challan No.", value: bill.yourChallanNo });
    if (bill.yourChallanDate) {
      pairs.push({ label: "Your Challan Date", value: prettyDate(bill.yourChallanDate) });
    }
  }
  if (bill.orderNo) {
    pairs.push({
      label: (bill.orderNoLabel ?? "Order No.").replace(/[:.\s]+$/, ""),
      value: bill.orderNo,
    });
    if (bill.orderDate) pairs.push({ label: "Order Date", value: prettyDate(bill.orderDate) });
  }
  if (bill.ewayBillNo) pairs.push({ label: "Eway Bill No.", value: bill.ewayBillNo });

  const rowH = 13.5;
  const gridH = pairs.length * rowH;
  const sectionH = Math.max(leftHeight, gridH);

  sheet.reserve(sectionH + 12);

  // Recipient block. Drawn at the full section height so its box lines up with
  // the reference grid beside it rather than stopping short of it.
  page.rect(L, top, leftW, sectionH, { lineWidth: 0.5, stroke: true });
  let ly = top + 5;
  leftWrapped.forEach((lines, i) => {
    const line = leftLines[i];
    for (const text of lines) {
      page.text(text, L + 5, ly + line.size, {
        font: line.bold ? "bold" : "regular",
        size: line.size,
      });
      ly += line.size + 2;
    }
    ly += 1.5;
  });

  // Reference grid
  const gridTop = top + (sectionH - gridH) / 2;
  page.rect(gridX, gridTop, gridW, gridH, { lineWidth: 0.6, stroke: true });
  const labelW = 80;
  pairs.forEach((pair, i) => {
    const rowY = gridTop + i * rowH;
    if (i > 0) page.line(gridX, rowY, gridX + gridW, rowY, 0.4);
    page.text(pair.label, gridX + CELL_PAD, rowY + 9.3, { font: "bold", size: 7.5 });
    page.line(gridX + labelW, rowY, gridX + labelW, rowY + rowH, 0.4);
    if (pair.value) {
      page.text(pair.value, gridX + gridW - CELL_PAD, rowY + 9.3, { size: 8, align: "right" });
    }
  });

  sheet.y = top + sectionH + 14;
}

/* ──────────────────────────────────────────────
   Line-item table
   ────────────────────────────────────────────── */

interface TableGeometry {
  sr: number;
  desc: number;
  hsn: number;
  uom: number;
  qty: number;
  rate: number;
  amt: number;
}

const TABLE_COLS: { key: keyof TableGeometry; w: number; title: string; align: "left" | "right" }[] = [
  { key: "sr", w: COL_SR, title: "SR.NO.", align: "left" },
  { key: "desc", w: COL_DESC, title: "DESCRIPTION", align: "left" },
  { key: "hsn", w: COL_HSN, title: "HSN CODE", align: "left" },
  { key: "uom", w: COL_UOM, title: "UOM", align: "left" },
  { key: "qty", w: COL_QTY, title: "QTY", align: "right" },
  { key: "rate", w: COL_RATE, title: "RATE", align: "right" },
  { key: "amt", w: COL_AMT, title: "AMOUNT", align: "right" },
];

function tableGeometry(x: number): TableGeometry {
  const geo = { sr: x, desc: x, hsn: x, uom: x, qty: x, rate: x, amt: x } as TableGeometry;
  let cursor = x;
  for (const col of TABLE_COLS) {
    geo[col.key] = cursor;
    cursor += col.w;
  }
  return geo;
}

function drawTableHeader(page: PdfPage, geo: TableGeometry, y: number): void {
  // geo.sr is the table's left edge, so the box always spans the full width.
  page.rect(geo.sr, y, CONTENT_W, HEADER_H, { lineWidth: 0.7, stroke: true });
  for (const col of TABLE_COLS) {
    if (col.key === "sr") continue;
    page.line(geo[col.key], y, geo[col.key], y + HEADER_H, 0.4);
    page.text(
      col.title,
      col.align === "right" ? geo[col.key] + col.w - CELL_PAD : geo[col.key] + CELL_PAD,
      y + 12,
      { font: "bold", size: 7.5, align: col.align }
    );
  }
}

/** The table always starts at the left margin; recover it from any column. */
function sheet_left(page: PdfPage, geo: TableGeometry): number {
  void page;
  return geo.sr;
}

function itemHeight(item: BillLineItem): number {
  const lines = wrapText(item.description, COL_DESC - 2 * CELL_PAD, "regular", 7.5);
  // +7 rather than +4 so the last line's descender stays inside the cell border.
  return Math.max(HEADER_H, lines.length * 9.2 + 7);
}

function drawTableRow(page: PdfPage, geo: TableGeometry, item: BillLineItem, y: number, h: number): void {
  page.rect(geo.sr, y, CONTENT_W, h, { lineWidth: 0.4, stroke: true });
  for (const col of TABLE_COLS) {
    if (col.key === "sr") continue;
    page.line(geo[col.key], y, geo[col.key], y + h, 0.4);
  }

  const baseY = y + 11.5;
  const rightEdge = (key: keyof TableGeometry, w: number): number => geo[key] + w - CELL_PAD;

  page.text(item.srNo === null ? "" : String(item.srNo), geo.sr + CELL_PAD, baseY, { size: 7.5 });
  wrapText(item.description, COL_DESC - 2 * CELL_PAD, "regular", 7.5).forEach((line, i) => {
    page.text(line, geo.desc + CELL_PAD, baseY + i * 9.2, { size: 7.5 });
  });
  page.text(orDash(item.hsnCode), geo.hsn + CELL_PAD, baseY, { size: 7.5 });
  page.text(orDash(item.uom), geo.uom + CELL_PAD, baseY, { size: 7.5 });
  page.text(qty(item.quantity), rightEdge("qty", COL_QTY), baseY, { size: 7.5, align: "right" });
  page.text(money(item.rate), rightEdge("rate", COL_RATE), baseY, { size: 7.5, align: "right" });
  page.text(money(item.amount), rightEdge("amt", COL_AMT), baseY, { font: "bold", size: 7.5, align: "right" });
}

function renderTable(sheet: Sheet, bill: BillCopy): void {
  const { page } = sheet;
  const geo = tableGeometry(sheet.left);

  // A bill with no line items is still a bill: draw the empty table so the
  // document keeps its shape instead of silently losing the section.
  const items: BillLineItem[] =
    bill.lineItems.length > 0
      ? bill.lineItems
      : [{ srNo: null, description: "", hsnCode: null, uom: null, quantity: null, rate: null, amount: null }];

  drawTableHeader(page, geo, sheet.y);
  sheet.y += HEADER_H;

  for (const item of items) {
    const h = itemHeight(item);
    // Keep each row whole; on overflow start a page and repeat the header so
    // the columns stay identifiable.
    if (sheet.y + h > CONTENT_BOTTOM - 40) {
      sheet.newPage();
      drawTableHeader(page, geo, sheet.y);
      sheet.y += HEADER_H;
    }
    drawTableRow(page, geo, item, sheet.y, h);
    sheet.y += h;
  }

  // --- total quantity, on the table's own baseline -------------------------
  sheet.y += 3;
  page.line(sheet.left, sheet.y, sheet.right, sheet.y, 0.6);
  sheet.y += 3;
  page.text("Total Quantity", geo.desc + CELL_PAD, sheet.y + 11, { font: "bold", size: 8 });
  page.text(qty(bill.totalQuantity), geo.qty + COL_QTY - CELL_PAD, sheet.y + 11, {
    font: "bold",
    size: 8,
    align: "right",
  });
  page.line(geo.qty, sheet.y, geo.qty, sheet.y + 15, 0.4);
  sheet.y += 15 + 10;
}

/* ──────────────────────────────────────────────
   Totals
   ────────────────────────────────────────────── */

interface TotalRow {
  label: string;
  value: string;
  bold?: boolean;
  boxed?: boolean;
  rate?: string | null;
}

function totalRows(bill: BillCopy): TotalRow[] {
  const rows: TotalRow[] = [
    { label: "Total Amount Before Tax", value: money(bill.amountBeforeTax) },
    { label: "ADD:  CGST", value: money(bill.cgst), rate: impliedRate(bill.cgst, bill.amountBeforeTax) },
    { label: "ADD:  SGST", value: money(bill.sgst), rate: impliedRate(bill.sgst, bill.amountBeforeTax) },
    { label: "ADD:  IGST", value: money(bill.igst), rate: impliedRate(bill.igst, bill.amountBeforeTax) },
    { label: "Total GST", value: money(bill.totalGst) },
    { label: "Total Amount After Tax", value: money(bill.amountAfterTax), bold: true, boxed: true },
  ];
  if (bill.reverseChargeGst !== null) {
    rows.push({ label: "GST Payable on Reverse Charge", value: money(bill.reverseChargeGst) });
  }
  rows.push({ label: "Round Off", value: money(bill.roundOff) });
  return rows;
}

function renderTotals(sheet: Sheet, bill: BillCopy): void {
  const { page } = sheet;
  const rows = totalRows(bill);
  const labelW = 170;
  const valueW = 92;
  const x = sheet.right - labelW - valueW;
  const rowH = 14.5;

  sheet.reserve(rows.length * rowH + 14);
  const top = sheet.y;

  rows.forEach((row, i) => {
    const y = top + i * rowH;
    if (row.boxed) {
      page.rect(x, y, labelW + valueW, rowH, { lineWidth: 0.9, stroke: true });
    } else {
      page.line(x, y + rowH, x + labelW + valueW, y + rowH, 0.35);
    }
    page.text(row.label, x + CELL_PAD, y + 9.8, { font: row.bold ? "bold" : "regular", size: 8 });
    if (row.rate) {
      page.text(row.rate, x + labelW - CELL_PAD, y + 9.8, {
        size: 7,
        align: "right",
        color: [0.35, 0.35, 0.35],
      });
    }
    page.line(x + labelW, y, x + labelW, y + rowH, 0.35);
    page.text(row.value, x + labelW + valueW - CELL_PAD, y + 9.8, {
      font: "bold",
      size: 8.5,
      align: "right",
    });
  });

  sheet.y = top + rows.length * rowH + 14;
}

/* ──────────────────────────────────────────────
   Amount in words
   ────────────────────────────────────────────── */

function renderWords(sheet: Sheet, bill: BillCopy): void {
  if (!bill.amountInWords) return;
  const { page } = sheet;
  const size = 8;
  const lines = wrapText(`Total Invoice Amount in Words: - ${bill.amountInWords}`, CONTENT_W - 10, "bold", size);
  const gap = size + 2;
  const h = lines.length * gap + 9;

  sheet.reserve(h + 12);
  const top = sheet.y;
  page.rect(sheet.left, top, CONTENT_W, h, { lineWidth: 0.5, stroke: true });
  lines.forEach((line, i) => {
    page.text(line, sheet.left + CELL_PAD, top + 6 + size + i * gap, { font: "bold", size });
  });
  sheet.y = top + h + 12;
}

/* ──────────────────────────────────────────────
   Bank details / terms
   ────────────────────────────────────────────── */

function renderColumns(sheet: Sheet, bill: BillCopy): void {
  const { page } = sheet;
  const blocks = [
    { x: sheet.left, heading: "Bank Details", lines: bill.bankLines },
    { x: sheet.left + (CONTENT_W + 14) / 2, heading: "Terms & Conditions", lines: bill.termsLines },
  ];
  if (blocks.every((b) => b.lines.length === 0)) return;

  const colW = (CONTENT_W - 14) / 2;
  const size = 7.5;
  const gap = 9.4;
  const headingH = 13;

  // Measure both columns, then draw both at the taller height so the two
  // headings sit on one line.
  const measured = blocks.map((b) => {
    const body = b.lines.map((line) => wrapText(line, colW, "regular", size));
    return { block: b, body, h: headingH + body.reduce((sum, l) => sum + l.length * gap, 0) };
  });
  const height = Math.max(...measured.map((m) => m.h)) + 6;

  sheet.reserve(height + 12);
  const top = sheet.y;

  for (const { block, body } of measured) {
    page.text(block.heading, block.x, top + 9, { font: "bold", size: 8.5 });
    page.line(block.x, top + 12, block.x + colW, top + 12, 0.5);
    let y = top + headingH;
    for (const lines of body) {
      for (const line of lines) {
        page.text(line, block.x, y + size, { size });
        y += gap;
      }
    }
  }

  sheet.y = top + height + 12;
}

/* ──────────────────────────────────────────────
   Notes and signatures
   ────────────────────────────────────────────── */

const SUPPLIER_SIG_RE = /^\s*for\s+\S|proprietor|proprietorship|director|partner|signatory|for\s+and\s+on\s+behalf/i;

/**
 * Split the trailing annotations into prose and the supplier's signature block.
 *
 * The workbook carries "For SAASTHA ENGINEERING WORKS" and "(Proprietor)" as
 * free annotations rather than as signature lines, so without this they would be
 * printed twice: once in the notes and again under the supplier's rule.
 */
function splitFooter(bill: BillCopy): { notes: string[]; supplierLines: string[] } {
  const notes: string[] = [];
  const supplierLines: string[] = [];

  for (const note of bill.notes) {
    if (SUPPLIER_SIG_RE.test(note)) supplierLines.push(note);
    else notes.push(note);
  }
  // Always name the supplier on the signature block, even if the template only
  // carried the "(Proprietor)" designation.
  if (bill.sellerName) {
    const named = new RegExp(`^\\s*for\\s+${bill.sellerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!supplierLines.some((l) => named.test(l))) supplierLines.unshift(`For ${bill.sellerName}`);
  }
  return { notes, supplierLines };
}

function renderNotes(sheet: Sheet, bill: BillCopy): void {
  const { notes } = splitFooter(bill);
  if (notes.length === 0) return;
  const { page } = sheet;
  const size = 7;
  const gap = 9;
  const lines = notes.flatMap((n) => wrapText(n, CONTENT_W, "regular", size));
  const h = lines.length * gap;

  sheet.reserve(h + 12);
  let y = sheet.y;
  for (const line of lines) {
    page.text(line, sheet.left, y + size, { size, color: [0.2, 0.2, 0.2] });
    y += gap;
  }
  sheet.y = y + 4;
}

function renderSignatures(sheet: Sheet, bill: BillCopy): void {
  const { page } = sheet;
  const size = 7.5;
  const { supplierLines } = splitFooter(bill);
  const receiverLines = bill.signatureLines.length > 0 ? bill.signatureLines : ["(Receivers Signature)"];

  // Measure both blocks so the two rules sit on one line.
  const colW = CONTENT_W / 2;
  const ruleOffset = 14;
  const measure = (lines: string[]): number =>
    lines.reduce((sum, l) => sum + wrapText(l, colW - 2 * ruleOffset, "regular", size).length * 9, 0);
  const bodyH = Math.max(measure(supplierLines), measure(receiverLines), 9);
  const boxH = ruleOffset + bodyH + 4;

  // The block follows the content flow rather than being pinned to the foot of
  // the sheet: a short invoice would otherwise leave a large blank band above
  // the signatures.
  sheet.reserve(boxH + 8);
  const top = sheet.y + 6;
  const lineY = top + ruleOffset;

  const drawColumn = (x: number, lines: string[], align: "left" | "right"): void => {
    page.line(x + ruleOffset, lineY, x + colW - ruleOffset, lineY, 0.6);
    let y = lineY + 3;
    for (const line of lines) {
      for (const wrapped of wrapText(line, colW - 2 * ruleOffset, "regular", size)) {
        page.text(wrapped, align === "right" ? x + colW - ruleOffset : x + ruleOffset, y + size, {
          size,
          align,
        });
        y += 9;
      }
    }
  };

  drawColumn(sheet.left, supplierLines, "left");
  drawColumn(sheet.left + colW, receiverLines, "right");

  sheet.y = top + boxH;
}

/* ──────────────────────────────────────────────
   Public API
   ────────────────────────────────────────────── */

/**
 * Render every bill in a workbook as ONE print-ready PDF for a single copy.
 *
 * ONE DOCUMENT, NOT A CONCATENATION
 * A PDF's cross-reference table records absolute byte offsets, so gluing two
 * valid PDFs together yields a file whose second half points at the wrong
 * places and will not open. A workbook therefore becomes a single multi-page
 * document per copy: one page per bill, in worksheet order, with the table
 * header repeated if a single bill's line items run onto a second page.
 */
export function renderBillDocument(bills: BillCopy[], copyLabel: string): Uint8Array {
  if (bills.length === 0) throw new Error("A bill document needs at least one bill");

  const firstBill = bills[0];
  const sheet = new Sheet(
    bills.length === 1
      ? `${copyLabel} - ${firstBill.invoiceNo ?? "Bill"}`
      : `${copyLabel} - ${bills.length} bills`,
    `${firstBill.sellerName ?? "Tax Invoice"} - ${copyLabel}`
  );

  // Track which bill owns each page, because one bill may spill onto more than
  // one page and every page still needs its own invoice number in the footer.
  const pageOwner: string[] = [];
  for (const [i, bill] of bills.entries()) {
    if (i > 0) sheet.newPage();
    const firstPage = sheet.doc.pageCount - 1;
    renderHeader(sheet, bill);
    renderParties(sheet, bill);
    renderTable(sheet, bill);
    renderTotals(sheet, bill);
    renderWords(sheet, bill);
    renderColumns(sheet, bill);
    renderNotes(sheet, bill);
    renderSignatures(sheet, bill);
    for (let p = firstPage; p < sheet.doc.pageCount; p++) {
      pageOwner[p] = bill.invoiceNo ?? "Bill";
    }
  }

  // Stamped last, once the page count is final, so a long bill still reads
  // "Page 2 of 3" instead of a placeholder.
  const total = sheet.doc.pageCount;
  sheet.doc.getPages().forEach((page, i) => {
    page.text("E & O.E", MARGIN_X, PAGE_H - 18, { size: 7, color: [0.3, 0.3, 0.3] });
    page.text(
      `${copyLabel}   |   ${pageOwner[i] ?? ""}   |   Page ${i + 1} of ${total}`,
      MARGIN_X + CONTENT_W,
      PAGE_H - 18,
      { size: 7, align: "right", color: [0.3, 0.3, 0.3] }
    );
  });

  return sheet.doc.build();
}
