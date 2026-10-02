// supabase/functions/process-bill-upload/_shared/renderBill.ts
//
// Lays a parsed bill out as a print-ready A4 tax invoice.
//
// WHAT "LOOKS LIKE A REAL INVOICE" MEANS HERE
// The requirement is explicitly NOT an HTML table dumped onto the sheet.page. So the
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
//   points line up down the sheet.page.
// * Nothing is positioned from Excel row numbers, so an empty row in the source
//   produces no gap and a long description simply takes the space it needs.
// * A page break is only ever taken between table rows, and the footer is
//   stamped last, so there are no orphaned headings and no blank trailing sheet.page.

import type { BillCopy, BillLineItem, CopyKind } from "./parseBill.ts";
import { COPY_LABEL } from "./parseBill.ts";
import { formatJobKind } from "./formatJobKind.ts";
import { PdfDocument, measurePdfText, type PdfPage, wrapText } from "./pdf.ts";
import { measureText } from "./fontMetrics.ts";
import type { PdfImage } from "./pdfImage.ts";

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

/**
 * Type scale, in one place.
 *
 * The previous sizes (7-7.5pt for almost everything) were legible on screen but
 * too small once printed on A4. These are deliberately named rather than
 * scattered as literals, because the point of the change is that the hierarchy is
 * a decision, not an accident: one base size for body text, a step up for
 * anything an operator reads first, and a separate smaller step for the footer
 * that is never part of the invoice's content.
 *
 * Nothing here is a response to overflow. If a bill no longer fits, the block
 * flows to the next page — see `Sheet.reserve`.
 */
const T = {
  /** Seller's trading name. */
  sellerName: 12.5,
  /** Descriptor / GST / address / contact block. */
  sellerBody: 8.6,
  /** The boxed document title. */
  heading: 16.5,
  /** Job classification badge beside the title. */
  badge: 9.5,
  /** Copy marker, top right. */
  copy: 11,
  /** Recipient block and metadata label column. */
  metaLabel: 8.6,
  metaValue: 9,
  /** Line-item table. */
  tableHead: 8.4,
  tableCell: 8.4,
  /** Totals block. */
  totalLabel: 9,
  totalValue: 9.4,
  totalGrand: 10,
  totalRate: 8,
  /** Amount in words. */
  words: 9,
  /** Bank details / terms. */
  columnBody: 8.4,
  columnHead: 9,
  /** Certification note. */
  note: 7.8,
  /** Signature blocks. */
  signature: 8.4,
  /** Footer — smallest on the sheet, and not content. */
  footer: 7.5,
} as const;

/* Line-item table columns. The three numeric columns are right-aligned.
 *
 * Widths are derived from the usable A4 width rather than chosen to look nice, so
 * the table always ends exactly on the right margin and no column can be pushed
 * off the page by a wider font. The two free-text columns absorb the slack:
 * DESCRIPTION is by far the longest string on the sheet and HSN CODE is a fixed
 * eight-digit code that must never wrap or clip. */
const COL_SR = 30;
const COL_DESC = 218;
const COL_HSN = 66;
const COL_UOM = 38;
const COL_QTY = 46;
const COL_RATE = 66;
const COL_AMT = CONTENT_W - (COL_SR + COL_DESC + COL_HSN + COL_UOM + COL_QTY + COL_RATE);
const HEADER_H = 19;
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

/**
 * Quantities and amounts as a LINE-ITEM CELL, where "absent" means blank.
 *
 * `money`/`qty` above deliberately print "-" for a missing value, because the
 * template writes a literal "-" on rows such as IGST and the PDF has to mirror
 * what the source actually said. That is right for the totals block and wrong for
 * the item table: a line item with no HSN code or no rate is an EMPTY CELL, and
 * substituting a dash would put a character on the invoice that the workbook
 * never contained. So the table uses these instead, and "" is drawn as nothing.
 */
function cellQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(Math.round(value * 1000) / 1000);
}

function cellMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const negative = value < 0;
  const [whole, frac] = Math.abs(value).toFixed(2).split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest === "" ? last3 : `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
  return `${negative ? "-" : ""}${grouped}.${frac}`;
}

/**
 * The rate to print beside a tax row.
 *
 * A STORED rate wins over a derived one, and the reason is specific rather than
 * general: IGST is 0.00 on every intra-state invoice, so a rate derived from the
 * amount (`igst / base`) is absent exactly on the invoices where the 18% IGST rate
 * is most worth showing. The workbook prints that rate in its own cell and the
 * editor can change it, so it is printed from the stored value.
 *
 * The derived form is still the fallback, for a row written before migration 0008
 * or by a client that sends no rate at all.
 */
function taxRateLabel(stored: number | null | undefined, tax: number | null, base: number | null): string | null {
  if (stored !== null && stored !== undefined && Number.isFinite(stored)) {
    // The stored value is already a percentage (9 means 9%). This only trims
    // float noise; it does not rescale, because a rescale here is how 9% becomes
    // 900% on a printed invoice.
    const r = Math.round(stored * 100) / 100;
    return `${Number.isInteger(r) ? r : r.toFixed(2)}%`;
  }
  return impliedRate(tax, base);
}

/** A tax rate implied by the charge actually levied, for the totals block. */
function impliedRate(tax: number | null, base: number | null): string | null {
  if (tax === null || base === null || base === 0 || tax <= 0) return null;
  const rate = (tax / base) * 100;
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2)}%`;
}

/* ──────────────────────────────────────────────
   Emphasised spans
   ────────────────────────────────────────────── */

/**
 * The phrases in the Terms block that are drawn in the emphasised style.
 *
 * This is a PATTERN, not the literal text "40 DAYS", because the number is a
 * business decision that changes: 15 DAYS on one client, 40 on another, 30 on the
 * next. Matching the shape rather than the value means a newly typed term is
 * emphasised the moment it is saved, with no change to the renderer and no styling
 * markup travelling through the editor.
 *
 * Deliberately narrow: a payment window is the one term a reader must not
 * misread, and emphasising every number would leave nothing emphasised.
 */
const EMPHASIS_RE = /\b\d+(?:\.\d+)?\s*(?:DAYS?|WEEKS?|MONTHS?)\b/gi;

const EMPH_SIZE_DELTA = 1;

/** One run of a line, in one style. */
interface Run {
  text: string;
  emph: boolean;
}

/** Split a line into normal and emphasised runs, keeping every character. */
function splitEmphasis(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  EMPHASIS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMPHASIS_RE.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), emph: false });
    runs.push({ text: m[0], emph: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), emph: false });
  return runs.length > 0 ? runs : [{ text, emph: false }];
}

/**
 * Greedy word wrap over a mixed-style line.
 *
 * Returns visual lines, each a list of runs. An EMPHASISED run is ATOMIC: it is
 * placed whole or moved whole to the next line, never broken. "40" at the end of
 * one line and "DAYS" at the start of the next reads as two unrelated tokens and
 * is exactly the misreading the emphasis exists to prevent — so the only case where
 * one is split is when it is wider than the entire column, where splitting is
 * better than overflowing the page.
 *
 * An emphasised run shares the BASELINE with the rest of the line (see
 * `renderColumns`), so a line's height is its normal size: the larger glyphs sit on
 * the same line rather than inflating the row. That is what keeps the terms block
 * the same height as before despite the styling.
 */
function layoutRuns(runs: Run[], maxWidth: number, size: number): Run[][] {
  const widthOf = (t: string, emph: boolean): number =>
    measurePdfText(t, { font: emph ? "bold" : "regular", size: emph ? size + EMPH_SIZE_DELTA : size });

  const out: Run[][] = [];
  let line: Run[] = [];
  let used = 0;

  const pushLine = (): void => {
    out.push(line);
    line = [];
    used = 0;
  };

  /** Place `text` as one unit, breaking first if it does not fit. */
  const placeWhole = (text: string, emph: boolean): void => {
    if (text === "") return;
    const w = widthOf(text, emph);
    if (used + w > maxWidth && line.length > 0) pushLine();
    line.push({ text, emph });
    used += w;
  };

  /** A single unit wider than the column: split it by characters or overflow. */
  const placeSplit = (text: string, emph: boolean): void => {
    let piece = "";
    for (const ch of text) {
      if (used + widthOf(piece + ch, emph) > maxWidth && piece !== "") {
        line.push({ text: piece, emph });
        pushLine();
        piece = ch;
      } else {
        piece += ch;
      }
    }
    placeWhole(piece, emph);
  };

  for (const run of runs) {
    if (run.emph) {
      /* Atomic. `EMPHASIS_RE` never captures surrounding spaces, so the phrase
         arrives with its gaps already owned by the neighbouring normal run; the
         defensive split below only matters if the pattern is ever widened to
         include whitespace, and it emits the gaps in normal style rather than
         bold, because a bold space is not what anyone means by emphasising a
         phrase. */
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!;
      if (match[1]) placeWhole(match[1], false);
      if (widthOf(match[2], true) > maxWidth) placeSplit(match[2], true);
      else placeWhole(match[2], true);
      if (match[3]) placeWhole(match[3], false);
      continue;
    }
    /* `\S+\s*` keeps each word's trailing space attached to it. Emitting spaces as
       their own units put a lone " " at the end of a line, hanging past the last
       glyph and, on the next line, an indent before the first word. */
    for (const word of run.text.match(/\S+\s*/g) ?? []) {
      if (widthOf(word, false) > maxWidth) placeSplit(word, false);
      else placeWhole(word, false);
    }
  }
  if (line.length > 0) out.push(line);
  return out;
}

/* ──────────────────────────────────────────────
   Invoice logo
   ────────────────────────────────────────────── */

/**
 * The logo slot: the strip of the header the copy marker has always reserved.
 *
 * The header already reserves the rightmost 110pt for ORIGINAL / DUPLICATE /
 * TRIPLICATE (`bodyWidth = CONTENT_W - HEAD_STRIP` below), and the seller block
 * is wrapped to that width, so no seller line can ever reach past x = 455.28.
 * That makes this strip the one place in the header where a logo can go without
 * displacing, shortening or overlapping anything.
 *
 * WHY THESE NUMBERS
 *   WIDTH      exactly the existing reservation, so introducing a logo cannot
 *              change how the seller block wraps.
 *   TOP_GAP    clears the copy marker's baseline, which sits at `top + 12` with an
 *              11pt face and so reaches roughly `top + 20`.
 *   BOTTOM_GAP clearance above the header rule.
 *   GOOD_H     the height at or above which a logo is big enough that the header
 *              is left exactly as it is. Below it the header is lengthened, up to
 *              MAX_GROW. This is the threshold that decides whether anything on
 *              the page moves, and it is deliberately well under the slot a full
 *              seller block provides, so a normal invoice never reaches it.
 *   MAX_GROW   the most the header may be lengthened. Growth moves every block
 *              below it down by the same amount, so it is bounded: a seller
 *              block with almost no detail must not be able to reflow a one-page
 *              invoice onto two. Past this bound the logo takes the smaller slot
 *              that is left rather than the page getting longer.
 *   MIN_H      below this the logo is not drawn at all. A mark squeezed under an
 *              eighth of an inch tall reads as a printing fault, and an invoice
 *              with a legible header and no logo is a far better outcome than
 *              one with a smear where the letterhead should be.
 */
const LOGO_STRIP_W = 110;
const LOGO_TOP_GAP = 22;
const LOGO_BOTTOM_GAP = 6;
const LOGO_GOOD_H = 34;
const LOGO_MAX_GROW = 30;
const LOGO_MIN_H = 12;
const LOGO_PAD = 4;

/** Where a logo ended up, in the header's own coordinate space. */
interface LogoPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Fit a logo into the header strip, preserving its aspect ratio.
 *
 * `availableH` is the vertical room between the copy marker and the header rule.
 * The result is always a "contain" fit: the logo is scaled by whichever axis runs
 * out first and then centred in the space that is left over, so it can never be
 * stretched, cropped, or pushed against a margin. A logo with a very wide aspect
 * ratio ends up narrower than the strip and a very tall one ends up shorter than
 * the room; neither is distorted.
 *
 * Returns null for a logo with no usable pixels rather than emitting a
 * zero-sized draw call.
 */
function fitLogo(image: PdfImage, slotX: number, slotTop: number, availableH: number): LogoPlacement | null {
  if (image.width <= 0 || image.height <= 0) return null;

  const boxW = LOGO_STRIP_W - LOGO_PAD * 2;
  const boxH = availableH - LOGO_PAD * 2;
  if (boxW <= 0 || boxH <= 0) return null;
  if (availableH < LOGO_MIN_H) return null;

  const scale = Math.min(boxW / image.width, boxH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;

  return {
    x: slotX + (LOGO_STRIP_W - w) / 2,
    y: slotTop + (availableH - h) / 2,
    w,
    h,
  };
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

/**
 * The logo registered on this document, if any.
 *
 * Held on the Sheet rather than passed through eight call sites: it is needed by
 * the header alone, and the header is called once per bill while the document is
 * built once per call. Every page of the document shares one `/XObject`
 * dictionary, so one registration covers all three print copies' worth of pages.
 */
interface HeaderLogo {
  /** Resource name to draw, e.g. `Im0`. */
  resource: string;
  image: PdfImage;
}

function renderHeader(sheet: Sheet, bill: BillCopy, logo: HeaderLogo | null): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const L = sheet.left;
  const R = sheet.right;

  // Reserve the right-hand strip for the copy marker so a long seller name can
  // never run underneath it. This is also the strip the logo occupies, which is
  // why it is named rather than inlined: the seller block below wraps to it, and
  // changing its value would re-wrap every seller on every invoice.
  const HEAD_STRIP = LOGO_STRIP_W;
  const bodyWidth = CONTENT_W - HEAD_STRIP;
  const top = sheet.y;

  // --- copy marker, top right ----------------------------------------------
  sheet.page.text(bill.label, R, top + 12, { font: "bold", size: T.copy, align: "right" });

  // --- seller identity, top left -------------------------------------------
  const sellerLines: { text: string; bold: boolean; size: number }[] = [];
  if (bill.sellerName) sellerLines.push({ text: bill.sellerName, bold: true, size: T.sellerName });
  for (const text of [
    bill.sellerDescriptor,
    bill.sellerTaxLine,
    bill.sellerAddress,
    bill.sellerContact,
  ]) {
    if (!text) continue;
    const size = T.sellerBody;
    for (const line of wrapText(text, bodyWidth, "regular", size)) {
      sellerLines.push({ text: line, bold: false, size });
    }
  }

  // Height of the seller block, measured before anything is drawn: the header
  // rule sits a fixed 5pt below its last line, and a logo needs to know how much
  // room is left above that rule before it can decide whether it fits.
  let blockHeight = 0;
  for (const line of sellerLines) blockHeight += line.bold ? 15 : 11;

  let ruleY = top + blockHeight + 5;

  /* --- invoice logo, in the reserved strip ---------------------------------
     Placed BEFORE the seller lines are drawn so the rule position it needed is
     already known, and so the two decisions cannot disagree.

     The header only ever grows, and only when the seller block is too short to
     leave a usable slot, and then by at most LOGO_MAX_GROW. On any invoice with
     a normal seller block — which is to say every real one — the room above the
     rule is already larger than LOGO_GOOD_H, `ruleY` keeps exactly the value it
     has always had, and the logo appears without a single thing below it moving
     by a point. */
  const slotX = R - LOGO_STRIP_W;
  const slotTop = top + LOGO_TOP_GAP;
  if (logo) {
    const usable = ruleY - LOGO_BOTTOM_GAP - slotTop;
    if (usable < LOGO_GOOD_H) ruleY += Math.min(LOGO_GOOD_H - usable, LOGO_MAX_GROW);
  }

  const placement = logo ? fitLogo(logo.image, slotX, slotTop, ruleY - LOGO_BOTTOM_GAP - slotTop) : null;
  if (placement) {
    sheet.page.image(logo!.resource, placement.x, placement.y, placement.w, placement.h);
  }

  let y = top;
  for (const line of sellerLines) {
    sheet.page.text(line.text, L, y + line.size, {
      font: line.bold ? "bold" : "regular",
      size: line.size,
    });
    y += line.bold ? 15 : 11;
  }

  // y and ruleY are computed from the same measurement, so this lands exactly
  // where the reservation above decided it would.
  y = ruleY;
  sheet.page.line(L, y, R, y, 1.1);
  y += 5;

  // --- boxed TAX INVOICE heading -------------------------------------------
  const headingH = 26;
  sheet.page.rect(L, y, CONTENT_W, headingH, { lineWidth: 1.2, stroke: true });
  sheet.page.text("TAX INVOICE", (L + R) / 2, y + 18, {
    font: "bold",
    size: T.heading,
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
    const badgeSize = T.badge;
    const padX = 8;
    const badgeTextW = measureText(jobLabel, "bold", badgeSize);
    const badgeW = badgeTextW + padX * 2;
    const badgeH = 15;
    const badgeX = L + 7;
    const badgeY = y + (headingH - badgeH) / 2;

    sheet.page.rect(badgeX, badgeY, badgeW, badgeH, {
      lineWidth: 0.8,
      stroke: true,
      color: [0, 0, 0],
    });
    sheet.page.text(jobLabel, badgeX + padX, badgeY + 10.6, { font: "bold", size: badgeSize });
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

/**
 * The invoice's reference block, flattened to the label/value rows the PDF draws.
 *
 * Normally this is just the parser's `referenceRows` in source order, with each
 * row's `Date:` cell expanded into its own line beneath it. A source row that had
 * a `Date:` sub-cell but no date still produces the date line, because the
 * template's shape includes it.
 *
 * The fallback exists for a sheet whose reference block could not be read at all:
 * the invoice number and the fields the parser holds directly are then printed so
 * the grid is never empty. It is a floor, not a filter — nothing is ever removed
 * from `referenceRows` because its value is blank.
 */
function referenceGrid(bill: BillCopy): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];

  for (const ref of bill.referenceRows) {
    out.push({ label: ref.label, value: ref.value ?? "" });
    if (ref.hasDateCell) {
      out.push({ label: `${ref.label.replace(/\s*No\.?$/i, "")} Date`, value: ref.date ? prettyDate(ref.date) : "" });
    }
  }

  if (out.length > 0) return out;

  // No reference block was read. Print what the parser does hold rather than
  // dropping the section.
  out.push({ label: "Invoice No.", value: bill.invoiceNo ?? "" });
  if (bill.invoiceDate) out.push({ label: "Invoice Date", value: prettyDate(bill.invoiceDate) });
  out.push({ label: "Our Challan No.", value: bill.ourChallanNo ?? "" });
  if (bill.ourChallanDate) out.push({ label: "Challan Date", value: prettyDate(bill.ourChallanDate) });
  return out;
}

function renderParties(sheet: Sheet, bill: BillCopy): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const L = sheet.left;
  const R = sheet.right;
  const top = sheet.y;

  const gridW = 250;
  const leftW = CONTENT_W - gridW - 12;
  const gridX = R - gridW;

  /* ---- left column: who is being billed ----------------------------------
   *
   * The company name and each ADDRESS LINE are separate entries, so the invoice
   * shows the address with the line breaks the workbook gave it:
   *
   *     M/s. Example Cookers Ltd.,
   *     C-21,22 "U" Road,
   *     Example Industrial Estate,
   *     Example City - 000 001.
   *
   * Joining them into one string and letting it wrap would be a different
   * document — it would break in the middle of "Example Industrial Estate," and
   * would silently re-flow if the box were ever resized. A long line still wraps,
   * which is what the wrap pass below is for; it just prefers the source's breaks.
   */
  const leftLines: LeftLine[] = [];
  if (bill.recipientHeading) leftLines.push({ text: bill.recipientHeading, bold: true, size: T.metaLabel + 0.4 });
  if (bill.partyName) leftLines.push({ text: bill.partyName, bold: true, size: 9.6 });
  for (const line of bill.partyAddress) {
    if (line.trim() !== "") leftLines.push({ text: line, bold: false, size: T.metaValue });
  }
  if (bill.partyGstNo) {
    leftLines.push({ text: `Party's GST No. ${bill.partyGstNo}`, bold: false, size: T.metaValue });
  }
  if (bill.placeOfSupply || bill.state || bill.stateCode) {
    const bits = [
      bill.placeOfSupply ? `Place of Supply: ${bill.placeOfSupply}` : null,
      bill.state ? `State: ${bill.state}` : null,
      bill.stateCode ? `State Code: ${bill.stateCode}` : null,
    ].filter((b): b is string => b !== null);
    leftLines.push({ text: bits.join("    "), bold: false, size: T.metaValue });
  }

  // Wrap first, then draw, so the box is exactly as tall as its contents.
  const leftWrapped: string[][] = [];
  let leftHeight = 0;
  for (const line of leftLines) {
    const wrapped = wrapText(line.text, leftW - 10, line.bold ? "bold" : "regular", line.size);
    leftWrapped.push(wrapped);
    leftHeight += wrapped.length * (line.size + 2.4) + 1.8;
  }
  leftHeight = Math.max(leftHeight + 6, 28);

  /* ---- right column: document references ---------------------------------
   *
   * The grid is built from the source's own reference rows, NOT from a filtered
   * list of the values that happen to be filled in. That distinction is the whole
   * point: a blank `Your Challan No.` or `Eway Bill No.` is still a row of this
   * invoice, with a label, a border and an empty value cell, and the rows below it
   * must not move up to fill the gap. The previous renderer dropped such rows,
   * which made the PDF shorter than the workbook and lost the invoice's shape.
   *
   * Each source row prints as a label / value pair, and where the source carried
   * a `Date:` cell that date gets its own row too — again always, blank or not.
   */
  const pairs: { label: string; value: string }[] = [];
  for (const ref of referenceGrid(bill)) {
    pairs.push({ label: ref.label, value: ref.value });
  }

  const rowH = 14.5;
  const gridH = pairs.length * rowH;

  /* Transport sits BELOW the reference grid, inside the right-hand column, because
   * that is where the invoice's metadata lives and that is where the template
   * prints it (column D, under "Eway Bill No."). It used to be drawn in the
   * recipient block on the left, which put "Transporter: VEHICLE" inside the
   * Details of Recipient box — a different document from the one the workbook is.

     The block is emitted whenever EITHER field is present, so a workbook with a
     transporter but no vehicle, or the reverse, still shows the row. An empty value
     draws nothing and keeps its label, which is the same rule the reference grid
     follows and for the same reason. */
  const transportLines: { label: string; value: string | null }[] = [];
  if (bill.transporterMode !== null || bill.vehicleNumber !== null) {
    transportLines.push({ label: "Transporter:", value: bill.transporterMode });
    transportLines.push({ label: "Vehicle No.:", value: bill.vehicleNumber });
  }
  const transportGap = transportLines.length > 0 ? 6 : 0;
  const transportH = transportLines.length * rowH;
  const rightH = gridH + transportGap + transportH;

  const sectionH = Math.max(leftHeight, rightH);

  sheet.reserve(sectionH + 12);

  // Recipient block. Drawn at the full section height so its box lines up with
  // the reference grid beside it rather than stopping short of it.
  sheet.page.rect(L, top, leftW, sectionH, { lineWidth: 0.5, stroke: true });
  let ly = top + 5;
  leftWrapped.forEach((lines, i) => {
    const line = leftLines[i];
    for (const text of lines) {
      sheet.page.text(text, L + 5, ly + line.size, {
        font: line.bold ? "bold" : "regular",
        size: line.size,
      });
      ly += line.size + 2.4;
    }
    ly += 1.8;
  });

  // Reference grid. Top-aligned with the recipient box rather than vertically
  // centred against it, because the transport block now hangs below it and a
  // centred grid would leave the two blocks' internal rules unaligned.
  const gridTop = top;
  sheet.page.rect(gridX, gridTop, gridW, gridH, { lineWidth: 0.6, stroke: true });
  /* The label column is measured from the longest label rather than fixed, so a
     long one ("Purchase Order No.") cannot run into the value column — which is
     the "label/value overlap" failure. It is still bounded so a pathological
     label cannot squeeze the values out of the grid entirely. */
  const labelW = Math.min(
    gridW * 0.5,
    Math.max(80, ...pairs.map((p) => measureText(p.label, "bold", T.metaLabel) + 2 * CELL_PAD + 6))
  );
  pairs.forEach((pair, i) => {
    const rowY = gridTop + i * rowH;
    if (i > 0) sheet.page.line(gridX, rowY, gridX + gridW, rowY, 0.4);
    sheet.page.text(pair.label, gridX + CELL_PAD, rowY + 10, { font: "bold", size: T.metaLabel });
    sheet.page.line(gridX + labelW, rowY, gridX + labelW, rowY + rowH, 0.4);
    /* A blank value draws nothing at all: `sheet.page.text` ignores an empty string, so
       the cell keeps its border and its space and reads as an empty field rather
       than as a dash, a zero or a missing row. */
    if (pair.value !== "") {
      sheet.page.text(pair.value, gridX + gridW - CELL_PAD, rowY + 10, {
        size: T.metaValue,
        align: "right",
      });
    }
  });

  /* Transport, directly under the grid, in the same column and the same row
     rhythm. Boxed as one small block rather than ruled row by row, so it reads as
     a caption pair attached to the metadata above it instead of as two more
     numbered rows of the reference grid. */
  if (transportLines.length > 0) {
    const tTop = gridTop + gridH + transportGap;
    sheet.page.rect(gridX, tTop, gridW, transportH, { lineWidth: 0.5, stroke: true });
    transportLines.forEach((line, i) => {
      const rowY = tTop + i * rowH;
      sheet.page.text(line.label, gridX + CELL_PAD, rowY + 10, { font: "bold", size: T.metaLabel });
      if (line.value !== null && line.value !== "") {
        sheet.page.text(line.value, gridX + CELL_PAD + 78, rowY + 10, { size: T.metaValue });
      }
    });
  }

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
  }
  /* Each heading is drawn at a size that fits its own column rather than at one
     fixed size. "DESCRIPTION" and "QUANTITY" are far wider than the narrow UOM and
     SR.NO. columns, so a single size would either clip inside the narrow ones or
     wrap in the wide one. Fitting to the column is what guarantees no column's
     heading is ever cut off. */
  for (const col of TABLE_COLS) {
    const avail = col.w - 2 * CELL_PAD;
    const natural = measureText(col.title, "bold", T.tableHead);
    const size = natural <= avail ? T.tableHead : Math.max(6, (T.tableHead * avail) / natural);
    page.text(
      col.title,
      col.align === "right" ? geo[col.key] + col.w - CELL_PAD : geo[col.key] + CELL_PAD,
      y + HEADER_H - 6,
      { font: "bold", size, align: col.align }
    );
  }
}

/** The table always starts at the left margin; recover it from any column. */
function sheet_left(page: PdfPage, geo: TableGeometry): number {
  void page;
  return geo.sr;
}

const TABLE_LEADING = T.tableCell + 2.4;

function itemHeight(item: BillLineItem): number {
  const lines = wrapText(item.description, COL_DESC - 2 * CELL_PAD, "regular", T.tableCell);
  // Padding above the first baseline and more below the last, so the descender of
  // the last line stays inside the cell border however tall the row grows.
  return Math.max(HEADER_H, lines.length * TABLE_LEADING + 8);
}

function drawTableRow(page: PdfPage, geo: TableGeometry, item: BillLineItem, y: number, h: number): void {
  page.rect(geo.sr, y, CONTENT_W, h, { lineWidth: 0.4, stroke: true });
  for (const col of TABLE_COLS) {
    if (col.key === "sr") continue;
    page.line(geo[col.key], y, geo[col.key], y + h, 0.4);
  }

  const baseY = y + 12.5;
  const rightEdge = (key: keyof TableGeometry, w: number): number => geo[key] + w - CELL_PAD;

  /* Every cell is drawn, always. An absent value is an EMPTY cell inside its own
     column with its borders intact - not a dash, not a zero, and never a missing
     column with its borders intact - not a dash, not a zero, and never a missing
     cell blank", which is what the workbook said. */
  const cell = (
    key: keyof TableGeometry,
    w: number,
    text: string,
    opts: { bold?: boolean; right?: boolean } = {}
  ): void => {
    if (text === "") return;
    page.text(text, opts.right ? rightEdge(key, w) : geo[key] + CELL_PAD, baseY, {
      font: opts.bold ? "bold" : "regular",
      size: T.tableCell,
      align: opts.right ? "right" : "left",
    });
  };

  cell("sr", COL_SR, item.srNo === null ? "" : String(item.srNo));
  // The description wraps to its own column, so a long one grows the row rather
  // than running into HSN CODE or off the right margin.
  wrapText(item.description, COL_DESC - 2 * CELL_PAD, "regular", T.tableCell).forEach((line, i) => {
    page.text(line, geo.desc + CELL_PAD, baseY + i * TABLE_LEADING, { size: T.tableCell });
  });
  cell("hsn", COL_HSN, item.hsnCode ?? "");
  cell("uom", COL_UOM, item.uom ?? "");
  cell("qty", COL_QTY, cellQty(item.quantity), { right: true });
  cell("rate", COL_RATE, cellMoney(item.rate), { right: true });
  cell("amt", COL_AMT, cellMoney(item.amount), { bold: true, right: true });
}

/* ──────────────────────────────────────────────
   Measuring the blocks that close an invoice
   ──────────────────────────────────────────────
   Every block below the line-item table is measured BEFORE the table is drawn, so
   the table's page-break decision can take them into account.

   The reason is pagination quality, not correctness. The table used to break
   against a fixed guess at the space needed below it. A bill that overflowed by
   one or two rows therefore pushed those rows onto a fresh page and left the
   totals, the amount in words, the bank block, the terms, the certification note
   and the signatures behind on a page of their own — a nearly empty sheet. The
   requirement is that a long invoice may flow onto a second page, which is fine;
   what is not fine is a second page holding two orphan rows and nothing else.

   With the true trailing height known up front, the table breaks early enough that
   the closing blocks stay with it and both pages carry real content.

   Each measure function is the single source of truth for its block: the renderer
   uses the same number to place the block that the reservation used to reserve it,
   so the two can never disagree. */

const COL_GAP = 14;
const COLUMN_LEADING = T.columnBody + 2;
const NOTE_LEADING = 10;
const SIG_LEADING = 10.2;
const SIG_RULE_OFFSET = 16;
const TOTAL_ROW_H = 15.5;
const TOTAL_BLOCK_TAIL = 14;
const TOTAL_LABEL_W = 178;
const TOTAL_VALUE_W = 96;
/** The "Total Quantity" rule-and-figure strip that closes the table. */
const TOTAL_QTY_H = 32;
const REF_ROW_H = 14.5;

function wordsHeight(bill: BillCopy): number {
  if (!bill.amountInWords) return 0;
  const lines = wrapText(
    `Total Invoice Amount in Words: - ${bill.amountInWords}`,
    CONTENT_W - 10,
    "bold",
    T.words
  );
  return lines.length * (T.words + 2.6) + 10 + 12;
}

function columnsHeight(bill: BillCopy): number {
  const blocks = [
    { lines: bill.bankLines, emphasise: false },
    { lines: bill.termsLines, emphasise: true },
  ];
  if (blocks.every((b) => b.lines.length === 0)) return 0;
  const colW = (CONTENT_W - COL_GAP) / 2;
  /* The terms column is measured through `layoutRuns`, the same function the
     renderer draws it with, so the emphasized "40 DAYS" — which is measured in a
     LARGER font than the rest of the line — is accounted for in the height. A
     plain `wrapText` here would under-measure that line and the block below it
     would be drawn on top of the terms. */
  const body = blocks.map((block) =>
    block.lines.reduce((sum, line) => {
      const visual = block.emphasise
        ? layoutRuns(splitEmphasis(line), colW, T.columnBody).length
        : wrapText(line, colW, "regular", T.columnBody).length;
      return sum + visual * COLUMN_LEADING;
    }, 0)
  );
  return Math.max(...body) + 6 + 12;
}

function notesHeight(bill: BillCopy): number {
  const { notes } = splitFooter(bill);
  if (notes.length === 0) return 0;
  const lines = notes.flatMap((n) => wrapText(n, CONTENT_W, "regular", T.note));
  return lines.length * NOTE_LEADING + 12 + 4;
}

function signaturesHeight(bill: BillCopy): number {
  const { supplierLines } = splitFooter(bill);
  const receiverLines = bill.signatureLines.length > 0 ? bill.signatureLines : ["(Receivers Signature)"];
  const colW = CONTENT_W / 2;
  const measure = (lines: string[]): number =>
    lines.reduce(
      (sum, l) => sum + wrapText(l, colW - 2 * SIG_RULE_OFFSET, "regular", T.signature).length * SIG_LEADING,
      0
    );
  const bodyH = Math.max(measure(supplierLines), measure(receiverLines), 10);
  return SIG_RULE_OFFSET + bodyH + 4 + 8;
}

/** Everything the invoice prints below its line-item table, plus the gaps. */
function trailingHeight(bill: BillCopy): number {
  const totals = totalRows(bill).length * TOTAL_ROW_H + TOTAL_BLOCK_TAIL;
  return (
    TOTAL_QTY_H + totals + wordsHeight(bill) + columnsHeight(bill) + notesHeight(bill) + signaturesHeight(bill)
  );
}

function renderTable(sheet: Sheet, bill: BillCopy): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const geo = tableGeometry(sheet.left);

  // A bill with no line items is still a bill: draw the empty table so the
  // document keeps its shape instead of silently losing the section.
  const items: BillLineItem[] =
    bill.lineItems.length > 0
      ? bill.lineItems
      : [{ srNo: null, description: "", hsnCode: null, uom: null, quantity: null, rate: null, amount: null }];

  /* Only the LAST page has to hold the closing blocks, so the trailing height is
     reserved while the table is being laid out. Breaking one row earlier than
     strictly necessary is invisible; orphaning half an invoice onto an otherwise
     blank sheet is not. */
  const trailing = trailingHeight(bill);

  drawTableHeader(sheet.page, geo, sheet.y);
  sheet.y += HEADER_H;

  for (const item of items) {
    const h = itemHeight(item);
    // Keep each row whole; on overflow start a page and repeat the header so
    // the columns stay identifiable. The first page keeps room for the totals and
    // everything below them.
    if (sheet.y + h > CONTENT_BOTTOM - trailing) {
      sheet.newPage();
      drawTableHeader(sheet.page, geo, sheet.y);
      sheet.y += HEADER_H;
    }
    drawTableRow(sheet.page, geo, item, sheet.y, h);
    sheet.y += h;
  }

  // --- total quantity, on the table's own baseline -------------------------
  sheet.y += 3;
  sheet.page.line(sheet.left, sheet.y, sheet.right, sheet.y, 0.6);
  sheet.y += 3;
  sheet.page.text("Total Quantity", geo.desc + CELL_PAD, sheet.y + 12, { font: "bold", size: T.totalLabel });
  sheet.page.text(cellQty(bill.totalQuantity), geo.qty + COL_QTY - CELL_PAD, sheet.y + 12, {
    font: "bold",
    size: T.totalLabel,
    align: "right",
  });
  sheet.page.line(geo.qty, sheet.y, geo.qty, sheet.y + 16, 0.4);
  sheet.y += 16 + 10;
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

/**
 * The totals block, in the order the workbook writes it.
 *
 * Every row here is part of the template, so none of them is dropped for want of
 * a value. The reverse-charge line in particular is printed whether or not a
 * figure was entered: when nothing was entered the value cell is left blank, which
 * is what the workbook says. The row is not the optional part — the amount inside
 * it is.
 */
function totalRows(bill: BillCopy): TotalRow[] {
  return [
    { label: "Total Amount Before Tax", value: money(bill.amountBeforeTax) },
    {
      label: "ADD:  CGST",
      value: money(bill.cgst),
      rate: taxRateLabel(bill.cgstRate, bill.cgst, bill.amountBeforeTax),
    },
    {
      label: "ADD:  SGST",
      value: money(bill.sgst),
      rate: taxRateLabel(bill.sgstRate, bill.sgst, bill.amountBeforeTax),
    },
    {
      label: "ADD:  IGST",
      value: money(bill.igst),
      rate: taxRateLabel(bill.igstRate, bill.igst, bill.amountBeforeTax),
    },
    { label: "Total Amount :GST", value: money(bill.totalGst) },
    { label: "Total Amount After Tax", value: money(bill.amountAfterTax), bold: true, boxed: true },
    {
      label: "GST Payable on Reverse Charge",
      value: bill.reverseChargeGst === null ? "" : money(bill.reverseChargeGst),
    },
    { label: "Round Off", value: money(bill.roundOff) },
  ];
}

function renderTotals(sheet: Sheet, bill: BillCopy): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const rows = totalRows(bill);
  const labelW = TOTAL_LABEL_W;
  const valueW = TOTAL_VALUE_W;
  const x = sheet.right - labelW - valueW;
  const rowH = TOTAL_ROW_H;

  sheet.reserve(rows.length * rowH + TOTAL_BLOCK_TAIL);
  const top = sheet.y;

  rows.forEach((row, i) => {
    const y = top + i * rowH;
    if (row.boxed) {
      sheet.page.rect(x, y, labelW + valueW, rowH, { lineWidth: 0.9, stroke: true });
    } else {
      sheet.page.line(x, y + rowH, x + labelW + valueW, y + rowH, 0.35);
    }
    sheet.page.text(row.label, x + CELL_PAD, y + 10.8, { font: row.bold ? "bold" : "regular", size: T.totalLabel });
    if (row.rate) {
      sheet.page.text(row.rate, x + labelW - CELL_PAD, y + 10.6, {
        size: T.totalRate,
        align: "right",
        color: [0.35, 0.35, 0.35],
      });
    }
    sheet.page.line(x + labelW, y, x + labelW, y + rowH, 0.35);
    /* An empty value leaves its cell blank rather than printing a dash, so a
       template row with nothing in it still reads as an empty field. */
    if (row.value !== "") {
      sheet.page.text(row.value, x + labelW + valueW - CELL_PAD, y + 10.8, {
        font: "bold",
        size: row.bold ? T.totalGrand : T.totalValue,
        align: "right",
      });
    }
  });

  sheet.y = top + rows.length * rowH + TOTAL_BLOCK_TAIL;
}

/* ──────────────────────────────────────────────
   Amount in words
   ────────────────────────────────────────────── */

function renderWords(sheet: Sheet, bill: BillCopy): void {
  if (!bill.amountInWords) return;
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const size = T.words;
  const lines = wrapText(`Total Invoice Amount in Words: - ${bill.amountInWords}`, CONTENT_W - 10, "bold", size);
  const gap = size + 2.6;
  // Same measurement the reservation used, so the box cannot end up a different
  // height from the space that was held for it.
  const h = wordsHeight(bill) - 12;

  sheet.reserve(h + 12);
  const top = sheet.y;
  sheet.page.rect(sheet.left, top, CONTENT_W, h, { lineWidth: 0.5, stroke: true });
  lines.forEach((line, i) => {
    sheet.page.text(line, sheet.left + CELL_PAD, top + 7 + size + i * gap, { font: "bold", size });
  });
  sheet.y = top + h + 12;
}

/* ──────────────────────────────────────────────
   Bank details / terms
   ────────────────────────────────────────────── */

function renderColumns(sheet: Sheet, bill: BillCopy): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const blocks = [
    { x: sheet.left, heading: "Bank Details", lines: bill.bankLines, emphasise: false },
    {
      x: sheet.left + (CONTENT_W + COL_GAP) / 2,
      heading: "Terms & Conditions",
      lines: bill.termsLines,
      emphasise: true,
    },
  ];
  if (blocks.every((b) => b.lines.length === 0)) return;

  const colW = (CONTENT_W - COL_GAP) / 2;
  const size = T.columnBody;
  const gap = COLUMN_LEADING;
  const headingH = 14;

  sheet.reserve(columnsHeight(bill));
  const top = sheet.y;
  // `columnsHeight` measured the same thing, so the reserved space and the drawn
  // height are the same number by construction.
  const height = columnsHeight(bill) - 12;

  for (const block of blocks) {
    if (block.lines.length === 0) continue;
    sheet.page.text(block.heading, block.x, top + 9.5, { font: "bold", size: T.columnHead });
    sheet.page.line(block.x, top + 13, block.x + colW, top + 13, 0.5);
    let y = top + headingH;
    for (const line of block.lines) {
      if (!block.emphasise) {
        for (const wrapped of wrapText(line, colW, "regular", size)) {
          sheet.page.text(wrapped, block.x, y + size, { size });
          y += gap;
        }
        continue;
      }
      /* Mixed-style line. Every run of a visual line shares ONE baseline, so the
         larger bold "40 DAYS" sits in the sentence rather than above or below it,
         and the row keeps the height of the surrounding text. */
      for (const visual of layoutRuns(splitEmphasis(line), colW, size)) {
        let x = block.x;
        for (const run of visual) {
          if (run.text !== "") {
            sheet.page.text(run.text, x, y + size, {
              font: run.emph ? "bold" : "regular",
              size: run.emph ? size + EMPH_SIZE_DELTA : size,
            });
            x += measurePdfText(run.text, {
              font: run.emph ? "bold" : "regular",
              size: run.emph ? size + EMPH_SIZE_DELTA : size,
            });
          }
        }
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
 * The workbook carries "For EXAMPLE ENGINEERING WORKS" and "(Proprietor)" as
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
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const size = T.note;
  const gap = NOTE_LEADING;
  const lines = notes.flatMap((n) => wrapText(n, CONTENT_W, "regular", size));

  // Measured by `notesHeight`, so the reserved space and the drawn height agree.
  const h = notesHeight(bill) - 16;

  sheet.reserve(h + 12);
  let y = sheet.y;
  for (const line of lines) {
    sheet.page.text(line, sheet.left, y + size, { size, color: [0.2, 0.2, 0.2] });
    y += gap;
  }
  sheet.y = y + 4;
}

function renderSignatures(sheet: Sheet, bill: BillCopy): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const size = T.signature;
  const { supplierLines } = splitFooter(bill);
  const receiverLines = bill.signatureLines.length > 0 ? bill.signatureLines : ["(Receivers Signature)"];

  // Measure both blocks so the two rules sit on one line.
  const colW = CONTENT_W / 2;
  const ruleOffset = SIG_RULE_OFFSET;
  // Same measurement the reservation used.
  const bodyH = signaturesHeight(bill) - ruleOffset - 4 - 8;
  const boxH = ruleOffset + bodyH + 4;

  // The block follows the content flow rather than being pinned to the foot of
  // the sheet: a short invoice would otherwise leave a large blank band above
  // the signatures.
  sheet.reserve(boxH + 8);
  const top = sheet.y + 6;
  const lineY = top + ruleOffset;

  const drawColumn = (x: number, lines: string[], align: "left" | "right"): void => {
    sheet.page.line(x + ruleOffset, lineY, x + colW - ruleOffset, lineY, 0.6);
    let y = lineY + 3;
    for (const line of lines) {
      for (const wrapped of wrapText(line, colW - 2 * ruleOffset, "regular", size)) {
        sheet.page.text(wrapped, align === "right" ? x + colW - ruleOffset : x + ruleOffset, y + size, {
          size,
          align,
        });
        y += SIG_LEADING;
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

/** `COPY_LABEL` keyed by kind, for recovering a designation back to its kind. */
const COPY_KIND_BY_LABEL = COPY_LABEL;

/**
 * Render every bill in a workbook as ONE print-ready PDF for a single copy.
 *
 * ONE DOCUMENT, NOT A CONCATENATION
 * A PDF's cross-reference table records absolute byte offsets, so gluing two
 * valid PDFs together yields a file whose second half points at the wrong
 * places and will not open. A workbook therefore becomes a single multi-page
 * document per copy: one page per bill, in worksheet order, with the table
 * header repeated if a single bill's line items run onto a second sheet.page.
 *
 * THE LOGO
 * `logo` is the decoded image to print in the header, or null/omitted for none.
 * It is a parameter rather than part of `BillCopy` because it is not part of the
 * invoice's DATA: the same bill rendered for the logo library's preview and for
 * its three print copies carries the identical image, and a parser can never
 * produce one.
 *
 * Omitting it must leave the document byte-for-byte what it was before this
 * feature existed. That is guaranteed at the writer (`pdf.ts` emits no
 * /XObject dictionary for a document with no images) and verified by
 * `test-logo.ts`, which re-renders the fixture workbooks and compares against a
 * stored digest.
 */
export function renderBillDocument(
  bills: BillCopy[],
  copyLabel: string,
  logo?: PdfImage | null
): Uint8Array {
  if (bills.length === 0) throw new Error("A bill document needs at least one bill");

  /* `copyLabel` is the designation of the document being produced, so it is
     authoritative for the corner marker and the footer, and it OVERRIDES whatever
     the bill carries.

     That override matters because all three print copies of a bill are rendered from
     the same parsed block, so `bill.label` is that block's own label. Without the
     override the DUPLICATE document printed "ORIGINAL" in the corner while its
     footer said DUPLICATE - the same invoice, self-contradicting on one page.

     The `kind` is recovered from the label so the two can never disagree either. */
  const labelled: BillCopy[] = bills.map((bill) => ({
    ...bill,
    label: copyLabel,
    kind:
      (Object.keys(COPY_KIND_BY_LABEL) as CopyKind[]).find(
        (k) => COPY_KIND_BY_LABEL[k].toUpperCase() === copyLabel.trim().toUpperCase()
      ) ?? bill.kind,
  }));

  const firstBill = labelled[0];
  const sheet = new Sheet(
    labelled.length === 1
      ? `${copyLabel} - ${firstBill.invoiceNo ?? "Bill"}`
      : `${copyLabel} - ${labelled.length} bills`,
    `${firstBill.sellerName ?? "Tax Invoice"} - ${copyLabel}`
  );

  // Track which bill owns each page, because one bill may spill onto more than
  // one page and every page still needs its own invoice number in the footer.
  const pageOwner: string[] = [];

  /* Registered once, on the document, so the pixels exist a single time in the
     file however many pages and bills reference them. */
  const headerLogo: HeaderLogo | null = logo
    ? { resource: sheet.doc.registerImage(logo), image: logo }
    : null;

  for (const [i, bill] of labelled.entries()) {
    if (i > 0) sheet.newPage();
    const firstPage = sheet.doc.pageCount - 1;
    renderHeader(sheet, bill, headerLogo);
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
    // `page` here is the loop's own page, deliberately not `sheet.page`: this
    // pass has to stamp EVERY page, not the one the last bill happened to end on.
    page.text("E & O.E", MARGIN_X, PAGE_H - 18, { size: T.footer, color: [0.3, 0.3, 0.3] });
    page.text(
      `${copyLabel}   |   ${pageOwner[i] ?? ""}   |   Page ${i + 1} of ${total}`,
      MARGIN_X + CONTENT_W,
      PAGE_H - 18,
      { size: T.footer, align: "right", color: [0.3, 0.3, 0.3] }
    );
  });

  return sheet.doc.build();
}