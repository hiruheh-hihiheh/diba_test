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
import { applyBusinessProfile, type BusinessProfile } from "./businessProfile.ts";

/* ──────────────────────────────────────────────
   Geometry
   ────────────────────────────────────────────── */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
/*
 * The content inset comes from the reference invoice (SEW/316/2026-27), which is
 * 595.5×842.25 and starts its content at x = 29.37. Reproducing that layout means
 * taking the same inset on this 595.28-wide page. CONTENT_W is the reference's
 * printable span, kept as a literal because the two pages are not exactly the
 * same size: 2×29.37 ≠ 595.28−535.28, so the right edge lands at 29.37+535.28 =
 * 564.65, 0.63pt further in than the old 30pt margin put it.
 */
const MARGIN_X = 29.37;
const MARGIN_TOP = 26;
const MARGIN_BOTTOM = 34;
const CONTENT_W = 535.28;
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

/* ──────────────────────────────────────────────
   Reference layout
   ──────────────────────────────────────────────
   Everything below the header is matched to `final_original_dibesh.pdf`
   (SEW/316/2026-27). Its page is 595.5×842.25 against our 595.28×841.89, so its
   x coordinates are used as-is and its y coordinates as distances from the page
   top. The one measured fact the whole layout rests on is the BASELINE MODEL:
   for a text span the PDF reports as a bounding box, the baseline the glyphs were
   set on is `bboxTop + ratio × size`, with a ratio of 0.931 for roman and 0.968
   for bold. Verified five ways against the reference raster (grid label, totals
   label, total-quantity digit, footer, seller name). */
const ROMAN_BASELINE_RATIO = 0.931;
const BOLD_BASELINE_RATIO = 0.968;
function refBaseline(bboxTop: number, size: number, bold: boolean): number {
  return bboxTop + (bold ? BOLD_BASELINE_RATIO : ROMAN_BASELINE_RATIO) * size;
}

/* Line-item table columns, from the reference's own template. The table is NOT
 * flush to MARGIN_X: the reference starts it at x 34.56 and ends it at x 570.24
 * (535.68 wide, 0.4 wider than CONTENT_W). The three numeric columns are
 * right-aligned. */
const TABLE_X = 34.56;
const TABLE_W = 535.68;
const COL_SR = 29.76; //  34.56 ->  64.32
const COL_DESC = 217.92; //  64.32 -> 282.24
const COL_HSN = 66.24; // 282.24 -> 348.48
const COL_UOM = 37.92; // 348.48 -> 386.40
const COL_QTY = 46.08; // 386.40 -> 432.48
const COL_RATE = 65.76; // 432.48 -> 498.24
const COL_AMT = 72.0; // 498.24 -> 570.24
const HEADER_H = 19.2;
const CELL_PAD = 4;
/** The table header's title baseline, measured from the header box top. */
const TABLE_HEAD_BASE = 11.5;
/** The table body's first-line baseline, measured from the row top. */
const TABLE_BASE = 10.25;
/** Line pitch inside a wrapped description. */
const TABLE_LEADING = 10.5;
/** Row top pad (10.25) + bottom pad (9.07); a one-line row is this tall. */
const TABLE_ROW_PAD = 19.32;
/** Last row bottom -> the closing rule above the total-quantity box. */
const TABLE_CLOSE_GAP = 3.36;
/** Row bottom -> total-quantity box bottom (rule gap + box height). */
const TABLE_TQ_STRIP = 22.62;
const TQ_X = 34.37;
const TQ_W = 535.67; // -> 570.04
const TQ_H = 16.38;
const TQ_LABEL_X = 68.73;
const TQ_VALUE_R = 428.87;
const TQ_DIV1 = 386.4;
const TQ_DIV2 = 433.44;
const TQ_BASE = 9.33; // box top -> baseline

/* Parties section. All distances are from `sheet.y`, the parties top
 * (150.24 + headerGrowth in the no-logo case). */
/** Where the reference's parties section starts, measured from the page top. */
const PARTIES_TOP = 150.24;
const PARTIES_GRID_X = 245.75;
const PARTIES_GRID_W = 321.54; // -> 567.29
const PARTIES_GRID_SLOTS = 7;
const PARTIES_ROW_H = 14.47;
const PARTIES_GRID_BASE = 10.315; // top -> slot-0 baseline
const PARTIES_LABEL_X = 248.82;
const PARTIES_VALUE_R = 457.53;
const PARTIES_DATE_X = 466.56;
const PARTIES_DATE_R = 558.73;
const PARTIES_DIV_LABEL = 337.86;
const PARTIES_DIV_DATE = 462.88;
const PARTIES_LABEL_SIZE = 8.6;
const PARTIES_VALUE_SIZE = 9;
const PARTIES_DATE_SIZE = 10;
const PARTIES_TO_TRANSPORT = 103.54;
const TRANSPORT_H = 16.44;
const TRANSPORT_DIV1 = 402.21;
const TRANSPORT_DIV2 = 462.88;
const TRANSPORT_BASE = 10.67; // transport top -> baseline
const TRANSPORT_VEHICLE_X = 407.84;
const TRANSPORT_VEHICLE_VALUE_X = 467.79;
const PARTIES_TO_RCPT_RULE = 119.52;
const RCPT_X = 31.68;
const RCPT_R = 239.52;
const RCPT_TEXT_X = 35.01;
const RCPT_BASE = 17.12; // parties top -> first baseline
const RCPT_PITCH = 13.0;
const PARTIES_TO_TABLE = 131.04; // parties top -> table header top

/* Closing band. Page-anchored, and drawn only on the page the table finished
 * on. `BAND_TOP` is the totals band's top in the no-logo case; a logo adds
 * `headerGrowth`. */
const BAND_TOP = 525;
const TOTALS_X = 284.16;
const TOTALS_W = 274.56; // -> 558.72
const TOTALS_LABEL_X = 288.08;
const TOTALS_VALUE_R = 554.95;
const TOTALS_RATE_R = 458.46;
const TOTALS_DIV_X = 462.24;
const TOTALS_DIV_TOP = 4.92;
const TOTALS_DIV_BOTTOM = 129.24;
const TOTALS_RULE0 = 20.28; // band top -> first row rule
const TOTALS_RULE_PITCH = 15.5;
const TOTALS_TEXT0 = 8.92; // band top -> row-0 label bbox top
const TOTALS_TEXT_PITCH = 15.0;
const TOTALS_VALUE0 = 8.88; // band top -> row-0 value bbox top
const TOTALS_RATE0 = 25.54; // band top -> row-1 rate bbox top
/** Divider between the grand-total row's rules, and the box they bound. */
const TOTALS_GRAND_FROM = 4;
const TOTALS_GRAND_TO = 5;
const BANK_RULE_Y = 535.65;
const BANK_X = 29.37;
const BANK_R = 243.37;
const BANK_HEAD_X = 31.12;
const BANK_HEAD_TOP = 540.09;
const BANK_ROW_X = 30.71;
const BANK_ROW0 = 552.09;
const BANK_ROW_PITCH = 9.75;
const BANK_NOTE_GAP = 9.0;
const WORDS_TOP = 653.93;
const WORDS_H = 22.11; // -> 676.04
const WORDS_X = 24.41;
const WORDS_R = 560.36;
const WORDS_TEXT_X = 28.66;
const WORDS_TEXT_TOP = 659.33;
const TERMS_HEAD_TOP = 676.86;
const TERMS_HEAD_SIZE = 11.4;
const TERMS_BODY_SIZE = 12.4;
const TERMS_RULE_X = 21.07;
const TERMS_RULE_R = 558.75;
const TERMS_RULE_TOP = 738.61; // -> 739.87 (1.26 thick)
const TERMS_RULE_THICKNESS = 1.26;
/** Signature rules, from the reference's own drawing coordinates. */
const SIG_LEFT_X = 38.1;
const SIG_RIGHT_X = 305.84;
const SIG_RULE_W = 235.73;
/** Rule -> first signature line baseline. */
const SIG_TEXT_OFFSET = 9.4;
/** The page footer's baseline. */
const FOOTER_BASELINE = 822.09;

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
 * This is a PATTERN, not one window written out literally, because the number is a
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
   Invoice logo — the compact free letterhead
   ────────────────────────────────────────────── */

/**
 * The copy marker's reservation, used only when there is NO logo.
 *
 * The header reserves the rightmost 110pt for ORIGINAL / DUPLICATE / TRIPLICATE
 * (`bodyWidth = CONTENT_W - COPY_MARKER_RESERVE_W`), and the seller block wraps
 * to that width, so no seller line can ever reach past x = 455.28.
 *
 * With a logo the mark keeps the SAME right-aligned position and the SAME
 * baseline; only the seller block moves right, beside the logo. Its wider column
 * (`right - LOGO_TEXT_X`) is what keeps the logo from lengthening the header:
 * the block can only wrap to fewer lines than the plain one, never more.
 */
const COPY_MARKER_RESERVE_W = 110;

/** Where the copy mark's baseline sits, with or without a logo. */
const COPY_MARKER_BASELINE = 12;

/**
 * The logo letterhead, copied from the reference invoice (SEW/316/2026-27).
 *
 * The reference does NOT box its letterhead. The mark sits free at the left of
 * the page, a thin vertical rule separates it from the seller block, and the
 * seller's name and address start to the right of that rule. There is no outer
 * border and no inner compartment. The measurements below are the reference's
 * own drawing coordinates, used as they stand:
 *
 *   logo box     (14.60, 5.24)  111.14 tall   — the mark's own square placement
 *   separator    x = 119.23,    y 27.92 .. 104.34, hairline
 *   seller text  x = 123.99,    first baseline at the page's top margin
 *
 * The logo is fitted inside its box preserving aspect ratio ("contain"), so a
 * mark of any shape is neither stretched nor cropped. The box's right edge is
 * pulled in to the separator (14.60 + 104.63 = 119.23) so a mark can never
 * collide with the rule or with the seller block, and the rule is drawn AFTER
 * the image so a mark that happens to reach it cannot hide it.
 */
const LOGO_BOX_X = 14.6;
const LOGO_BOX_TOP = 5.24;
const LOGO_BOX_W = 104.63; // right edge lands exactly on the separator rule
const LOGO_BOX_H = 111.14;

/** Clear space kept inside the box, so the mark never touches its edges. */
const LOGO_PAD = 2;
/** Below this the mark reads as a printing fault, so it is not drawn at all. */
const LOGO_MIN_H = 12;

/** The hairline rule between the logo and the seller block. */
const LOGO_RULE_X = 119.23;
const LOGO_RULE_TOP = 27.92;
const LOGO_RULE_BOTTOM = 104.34;
const LOGO_RULE_W = 0.75;

/** Where the seller block starts when a logo is present. */
const LOGO_TEXT_X = 123.99;

/** A rectangle in the page's own top-down coordinate space. */
interface LogoRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a logo ended up inside its box. Same space as `LogoRect`. */
interface LogoPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Fit a logo into the letterhead box, preserving its aspect ratio.
 *
 * Always a "contain" fit: the mark is scaled by whichever axis runs out first
 * and then centred in the space left over, so it can never be stretched,
 * cropped, or pushed against the box's edge. A wide logo ends up shorter than
 * the box and a tall one narrower; neither is distorted, and neither is sized
 * by anything except its own pixels.
 *
 * Returns null for a logo with no usable pixels, or one too small to read,
 * rather than emitting a zero-sized or smeared draw call.
 */
function fitLogoInBox(image: PdfImage): LogoPlacement | null {
  if (image.width <= 0 || image.height <= 0) return null;

  const innerW = LOGO_BOX_W - LOGO_PAD * 2;
  const innerH = LOGO_BOX_H - LOGO_PAD * 2;
  if (innerW <= 0 || innerH < LOGO_MIN_H) return null;

  const scale = Math.min(innerW / image.width, innerH / image.height);
  const w = image.width * scale;
  const h = image.height * scale;

  return {
    x: LOGO_BOX_X + (LOGO_BOX_W - w) / 2,
    y: LOGO_BOX_TOP + (LOGO_BOX_H - h) / 2,
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

  /**
   * How far the header rule moved below its no-logo position. Set by
   * `renderHeader`, then read back by every block that anchors to the sheet
   * rather than flowing after the table — the totals band, the bank block, the
   * amount-in-words box and the terms. Those blocks must move WITH the header
   * when a logo lengthens it, because the logo lengthens everything above them;
   * only the signatures and the footer stay truly anchored to the page.
   *
   * The compact letterhead's column is wider than the plain header's, so the
   * seller block cannot wrap to more lines and this stays 0; the mechanism is
   * kept because a future header change may legitimately add height.
   */
  headerGrowth = 0;

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
  const top = sheet.y;

  /* Two layouts, and the choice between them is made ONCE, here, before anything
     is drawn:

       no logo  the header this renderer has always produced. The copy marker
                reserves the right-hand strip, the seller block wraps to it, and
                every coordinate below is the value it has always had. Nothing in
                this branch is new, and nothing in it may change: an invoice with
                no logo must still be the same document, byte for byte.

       logo     the compact free letterhead. The copy marker keeps its place and
                baseline; the seller block starts beside the logo instead of at
                the margin, and a thin rule separates the two.

     The one thing both branches share is the drawing loop that follows, so the
     seller block is typeset by identical code in both and cannot drift. */
  /* Only the wrap width differs between the two layouts, and the logo's is
     WIDER: with a logo the seller block starts at LOGO_TEXT_X (123.99) rather
     than at the margin, so it reaches the same right edge over fewer required
     wraps. The copy mark keeps the same baseline in both. */
  const bodyWidth = logo ? R - LOGO_TEXT_X : CONTENT_W - COPY_MARKER_RESERVE_W;
  const labelX = R;
  const labelY = top + COPY_MARKER_BASELINE;

  // --- seller identity, top left -------------------------------------------
  // Wrapped before anything is drawn, because the logo layout's height depends on
  // how tall this block turns out to be.
  const wrapSeller = (width: number): { text: string; bold: boolean; size: number }[] => {
    const lines: { text: string; bold: boolean; size: number }[] = [];
    if (bill.sellerName) lines.push({ text: bill.sellerName, bold: true, size: T.sellerName });
    for (const text of [
      bill.sellerDescriptor,
      bill.sellerTaxLine,
      bill.sellerAddress,
      bill.sellerContact,
    ]) {
      if (!text) continue;
      const size = T.sellerBody;
      for (const line of wrapText(text, width, "regular", size)) {
        lines.push({ text: line, bold: false, size });
      }
    }
    return lines;
  };
  const lineHeight = (line: { bold: boolean }) => (line.bold ? 15 : 10.84);
  const sellerLines = wrapSeller(bodyWidth);

  // Height of the seller block, measured before anything is drawn: the header
  // rule sits a fixed 2.5pt below its last line (the reference leaves ~2.5pt of
  // clearance, not the 5pt an earlier layout used), and the letterhead box has
  // to know how much room is left above that rule before it can decide its
  // height.
  let blockHeight = 0;
  for (const line of sellerLines) blockHeight += lineHeight(line);

  // The same block at the NO-LOGO wrap width. Because the logo's column is
  // wider, `blockHeight` can only be equal to or less than this — never more —
  // so the header rule below can never be pushed lower by a logo. If a future
  // change ever made the logo column narrower, this second measurement is the
  // floor that keeps the rule where the plain header puts it.
  let plainBlockHeight = 0;
  for (const line of wrapSeller(CONTENT_W - COPY_MARKER_RESERVE_W)) plainBlockHeight += lineHeight(line);

  /* --- where the header rule lands ----------------------------------------
     Taken as the lower of the logo-width block's rule and the plain header's,
     so a logo can never raise the rule (which would move everything above the
     parties up) and a run of short seller lines can never drop it either. In
     practice the two are equal, which is what keeps `headerGrowth` at zero and
     the parties, table and closing band on the reference's own grid. */
  const plainRuleY = top + plainBlockHeight + 2.5;
  const ruleY = logo ? Math.max(top + blockHeight + 2.5, plainRuleY) : top + blockHeight + 2.5;
  const textX = logo ? LOGO_TEXT_X : L;
  const textTop = top;

  if (logo) {
    /* The mark first, then the separator rule ON TOP of it, so a mark that
       happens to reach the rule cannot hide it. Nothing is boxed: the rule
       beside a free-standing logo IS the letterhead. */
    const placement = fitLogoInBox(logo.image);
    if (placement) {
      sheet.page.image(logo.resource, placement.x, placement.y, placement.w, placement.h);
    }
    sheet.page.line(LOGO_RULE_X, LOGO_RULE_TOP, LOGO_RULE_X, LOGO_RULE_BOTTOM, LOGO_RULE_W);
  }

  // --- copy marker, top right ----------------------------------------------
  sheet.page.text(bill.label, labelX, labelY, { font: "bold", size: T.copy, align: "right" });

  // --- the seller block ------------------------------------------------------
  let y = textTop;
  for (const line of sellerLines) {
    sheet.page.text(line.text, textX, y + line.size, {
      font: line.bold ? "bold" : "regular",
      size: line.size,
    });
    y += line.bold ? 15 : 10.84;
  }

  // ruleY was computed from the same measurement the block above was drawn to, so
  // this lands exactly where the layout decided it would.
  y = ruleY;
  sheet.page.line(L, y, R, y, 1.1);
  y += 5;

  // --- boxed TAX INVOICE heading -------------------------------------------
  // 26.9pt tall rather than 26 so that box bottom + the parties gap lands on the
  // reference's 150.24pt row grid top.
  const headingH = 26.9;
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
    const padX = 8.5;
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

  /* Header done. The box-to-parties gap alone would put the parties where the
     seller block happens to end; the reference puts them at 150.24 regardless.
     Holding them there — never higher than the box allows — keeps the whole
     body below (table, totals, terms, signatures) on the reference's grid. A
     logo lengthens the header, and every anchored block below adds the same
     `growth`, so the relationship survives the logo layout unchanged. */
  sheet.headerGrowth = ruleY - plainRuleY;
  sheet.y = Math.max(y + headingH + 9.8, PARTIES_TOP + sheet.headerGrowth);
}

/* ──────────────────────────────────────────────
   Parties + reference grid
   ────────────────────────────────────────────── */

interface LeftLine {
  text: string;
  bold: boolean;
  size: number;
}

interface RefGridRow {
  label: string;
  value: string;
  date: string | null;
  hasDate: boolean;
}

/**
 * The invoice's reference block, one entry per row the PDF draws.
 *
 * Normally this is the parser's `referenceRows` in source order, each carrying
 * its value AND its `Date:` cell — the reference prints the date on the same line
 * as the row, in a cell of its own, so the two are not split into separate rows.
 * A row with a `Date:` cell but no date still records `hasDate`, because the
 * template's shape includes the label even when the date is blank.
 *
 * The fallback exists for a sheet whose reference block could not be read at all:
 * the invoice number and the fields the parser holds directly are then printed so
 * the grid is never empty. It is a floor, not a filter — nothing is ever removed
 * from `referenceRows` because its value is blank.
 */
function referenceGrid(bill: BillCopy): RefGridRow[] {
  const out: RefGridRow[] = [];

  for (const ref of bill.referenceRows) {
    out.push({
      label: ref.label,
      value: ref.value ?? "",
      date: ref.date ? prettyDate(ref.date) : null,
      hasDate: ref.hasDateCell,
    });
  }

  if (out.length > 0) return out;

  // No reference block was read. Print what the parser does hold rather than
  // dropping the section.
  out.push({
    label: "Invoice No.",
    value: bill.invoiceNo ?? "",
    date: bill.invoiceDate ? prettyDate(bill.invoiceDate) : null,
    hasDate: true,
  });
  out.push({
    label: "Our Challan No.",
    value: bill.ourChallanNo ?? "",
    date: bill.ourChallanDate ? prettyDate(bill.ourChallanDate) : null,
    hasDate: true,
  });
  return out;
}

function renderParties(sheet: Sheet, bill: BillCopy): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const top = sheet.y;

  const rows = referenceGrid(bill);
  /* The grid is a FIXED 7-slot template, like the workbook it comes from: a bill
     with fewer reference rows leaves the extra slots blank rather than shortening
     the box, which is what keeps the transport, the recipient rule and the table
     below at their reference positions. A bill with more rows grows the box by
     exactly the extra rows and pushes everything below it down with it. */
  const usedSlots = rows.length + 1; // + the PLACE OF SUPPLY row
  const slots = Math.max(PARTIES_GRID_SLOTS, usedSlots);
  const extra = (slots - PARTIES_GRID_SLOTS) * PARTIES_ROW_H;
  const gridH = slots * PARTIES_ROW_H;

  const transportTop = top + PARTIES_TO_TRANSPORT + extra;
  const rcptRuleY = top + PARTIES_TO_RCPT_RULE + extra;
  const tableTop = top + PARTIES_TO_TABLE + extra;

  /* ---- right column: the document reference grid ------------------------- */
  sheet.page.rect(PARTIES_GRID_X, top, PARTIES_GRID_W, gridH, { lineWidth: 1.5, stroke: true });
  for (let k = 1; k < slots; k++) {
    const y = top + k * PARTIES_ROW_H;
    sheet.page.line(PARTIES_GRID_X, y, PARTIES_GRID_X + PARTIES_GRID_W, y, 0.75);
  }
  sheet.page.line(PARTIES_DIV_LABEL, top, PARTIES_DIV_LABEL, top + gridH, 0.75);
  sheet.page.line(PARTIES_DIV_DATE, top, PARTIES_DIV_DATE, top + gridH, 0.75);

  /* Every row shares ONE baseline (the label's), which is at most 1pt from the
     value's own bbox-derived baseline in the reference; text() ignores an empty
     string, so a blank cell keeps its border and reads as an empty field rather
     than as a dash or a zero. */
  const drawGridRow = (i: number, label: string, value: string, date: string | null): void => {
    const base = top + PARTIES_GRID_BASE + i * PARTIES_ROW_H;
    sheet.page.text(label, PARTIES_LABEL_X, base, { font: "bold", size: PARTIES_LABEL_SIZE });
    if (value !== "") {
      sheet.page.text(value, PARTIES_VALUE_R, base, { size: PARTIES_VALUE_SIZE, align: "right" });
    }
    sheet.page.text("Date :", PARTIES_DATE_X, base, { font: "bold", size: PARTIES_DATE_SIZE });
    if (date) {
      sheet.page.text(date, PARTIES_DATE_R, base, { size: PARTIES_VALUE_SIZE, align: "right" });
    }
  };

  rows.forEach((row, i) => drawGridRow(i, row.label, row.value, row.hasDate ? row.date : null));

  /* PLACE OF SUPPLY follows the source rows, exactly where the reference puts it
     after "E-way Bill No.". The state code shares the row, in the date cell. */
  const posBase = top + PARTIES_GRID_BASE + rows.length * PARTIES_ROW_H;
  sheet.page.text("PLACE OF SUPPLY", PARTIES_LABEL_X, posBase, { font: "bold", size: PARTIES_LABEL_SIZE });
  if (bill.placeOfSupply) {
    sheet.page.text(bill.placeOfSupply, PARTIES_VALUE_R, posBase, { size: PARTIES_VALUE_SIZE, align: "right" });
  }
  if (bill.stateCode !== null && bill.stateCode !== undefined) {
    sheet.page.text(`STATE CODE: ${bill.stateCode}`, PARTIES_DATE_X, posBase, {
      font: "bold",
      size: PARTIES_DATE_SIZE,
    });
  }

  /* ---- transport, directly under the grid -------------------------------- */
  if (bill.transporterMode !== null || bill.vehicleNumber !== null) {
    sheet.page.rect(PARTIES_GRID_X + 0.09, transportTop, PARTIES_GRID_W + 0.63, TRANSPORT_H, {
      lineWidth: 1.5,
      stroke: true,
    });
    sheet.page.line(TRANSPORT_DIV1, transportTop, TRANSPORT_DIV1, transportTop + TRANSPORT_H, 0.75);
    sheet.page.line(TRANSPORT_DIV2, transportTop, TRANSPORT_DIV2, transportTop + TRANSPORT_H, 0.75);
    const base = transportTop + TRANSPORT_BASE;
    const modeLabel = "Mode of  Transport:";
    sheet.page.text(modeLabel, PARTIES_LABEL_X, base, { font: "bold", size: PARTIES_LABEL_SIZE });
    if (bill.transporterMode) {
      const labelW = measureText(modeLabel, "bold", PARTIES_LABEL_SIZE);
      sheet.page.text(bill.transporterMode, PARTIES_LABEL_X + labelW + 3, base, { size: PARTIES_VALUE_SIZE });
    }
    sheet.page.text("Vehicle No.:", TRANSPORT_VEHICLE_X, base, { font: "bold", size: PARTIES_LABEL_SIZE });
    if (bill.vehicleNumber) {
      sheet.page.text(bill.vehicleNumber, TRANSPORT_VEHICLE_VALUE_X, base, { size: PARTIES_VALUE_SIZE });
    }
  }

  /* ---- left column: who is being billed ----------------------------------
   *
   * The company name and each ADDRESS LINE stay separate entries, so the invoice
   * shows the address with the line breaks the workbook gave it; a long line
   * still wraps. Only the FOOT of the block is ruled — the reference has no box
   * around the recipient, just a rule under it.
   */
  const leftLines: LeftLine[] = [];
  if (bill.recipientHeading) leftLines.push({ text: bill.recipientHeading, bold: true, size: 9 });
  if (bill.partyName) leftLines.push({ text: bill.partyName, bold: true, size: 9.6 });
  for (const line of bill.partyAddress) {
    if (line.trim() !== "") leftLines.push({ text: line, bold: false, size: 9 });
  }
  if (bill.partyGstNo) {
    leftLines.push({ text: `Party's GST No. ${bill.partyGstNo}`, bold: true, size: 9 });
  }
  if (bill.state || bill.stateCode !== null) {
    const bits: string[] = [];
    if (bill.state) bits.push(`State: ${bill.state}`);
    if (bill.stateCode !== null && bill.stateCode !== undefined) bits.push(`State Code: ${bill.stateCode}`);
    leftLines.push({ text: bits.join("      "), bold: false, size: 9 });
  }

  sheet.page.line(RCPT_X, rcptRuleY, RCPT_R, rcptRuleY, 0.75);
  leftLines.forEach((line, i) => {
    sheet.page.text(line.text, RCPT_TEXT_X, top + RCPT_BASE + i * RCPT_PITCH, {
      font: line.bold ? "bold" : "regular",
      size: line.size,
    });
  });

  sheet.y = tableTop;
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
  page.rect(geo.sr, y, TABLE_W, HEADER_H, { lineWidth: 0.7, stroke: true });
  for (const col of TABLE_COLS) {
    if (col.key === "sr") continue;
    page.line(geo[col.key], y, geo[col.key], y + HEADER_H, 0.5);
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
      y + TABLE_HEAD_BASE,
      { font: "bold", size, align: col.align }
    );
  }
}

function itemHeight(item: BillLineItem): number {
  const lines = wrapText(item.description, COL_DESC - 2 * CELL_PAD, "regular", T.tableCell);
  // Row top pad (10.25) + one line pitch per extra description line + bottom pad
  // (9.07): the descender of the last line stays inside the cell however tall the
  // row grows.
  return TABLE_ROW_PAD + (lines.length - 1) * TABLE_LEADING;
}

function drawTableRow(page: PdfPage, geo: TableGeometry, item: BillLineItem, y: number, h: number): void {
  /* Body rows carry only their LEFT edge, the column dividers and the bottom
     rule. The reference leaves the right side of the table open and each row's
     top is the previous row's bottom. */
  page.line(geo.sr, y, geo.sr, y + h, 0.5);
  for (const col of TABLE_COLS) {
    if (col.key === "sr") continue;
    page.line(geo[col.key], y, geo[col.key], y + h, 0.5);
  }
  page.line(TABLE_X, y + h, TABLE_X + TABLE_W, y + h, 0.5);

  const baseY = y + TABLE_BASE;
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
   Signature block geometry
   ──────────────────────────────────────────────
   Everything below the table is anchored to the sheet rather than measured and
   reserved in flow, so the old block-height functions are gone: the table now
   breaks against the fixed band top instead. What remains is the signature
   block's own distances. */
const SIG_LEADING = 9.76;
/**
 * Clearance between whatever the last drawn content was and the signature rule.
 *
 * The rule is anchored to the foot of the sheet, but the closing blocks above it
 * (the totals band, the words and the terms) move down with the header when a
 * logo lengthens it — so on a logo page the closing rule can reach into the
 * space the anchored rule and its text used to leave. A 6pt clearance is the
 * minimum that keeps the ink apart; the rule is pushed below it only by that
 * much and never by the block's own height.
 */
const SIG_FLOW_GAP = 6;
/**
 * Distance from the page's bottom edge to the signature RULES.
 *
 * Anchored on the RULE rather than on the block's bottom edge because the block's
 * height varies with how many designations the workbook supplies, and the rule is
 * the line that has to land in the same place on every bill.
 */
const SIG_RULE_FROM_BOTTOM = 59.25;

function renderTable(sheet: Sheet, bill: BillCopy): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const geo = tableGeometry(TABLE_X);

  // A bill with no line items is still a bill: draw the empty table so the
  // document keeps its shape instead of silently losing the section.
  const items: BillLineItem[] =
    bill.lineItems.length > 0
      ? bill.lineItems
      : [{ srNo: null, description: "", hsnCode: null, uom: null, quantity: null, rate: null, amount: null }];

  /* The closing band is anchored at BAND_TOP, so the table must finish — its
     rows, the closing rule and the total-quantity box — before that. Breaking a
     row one step early is invisible; overprinting the totals is not. A logo
     lengthens the header, so the band, and therefore the limit, move down too. */
  const bandTop = BAND_TOP + sheet.headerGrowth;
  const limit = bandTop - TABLE_TQ_STRIP;

  drawTableHeader(sheet.page, geo, sheet.y);
  sheet.y += HEADER_H;

  for (const item of items) {
    const h = itemHeight(item);
    // Keep each row whole; on overflow start a page and repeat the header so the
    // columns stay identifiable.
    if (sheet.y + h > limit) {
      sheet.newPage();
      drawTableHeader(sheet.page, geo, sheet.y);
      sheet.y += HEADER_H;
    }
    drawTableRow(sheet.page, geo, item, sheet.y, h);
    sheet.y += h;
  }

  // --- total quantity, on the table's own baseline -------------------------
  sheet.y += TABLE_CLOSE_GAP;
  sheet.page.line(TABLE_X, sheet.y, TABLE_X + TABLE_W, sheet.y, 0.6);
  const tqTop = sheet.y + (TABLE_TQ_STRIP - TABLE_CLOSE_GAP - TQ_H);
  sheet.page.rect(TQ_X, tqTop, TQ_W, TQ_H, { lineWidth: 1.0, stroke: true });
  sheet.page.line(TQ_DIV1, tqTop, TQ_DIV1, tqTop + TQ_H, 0.5);
  sheet.page.line(TQ_DIV2, tqTop, TQ_DIV2, tqTop + TQ_H, 0.5);
  const tqBase = tqTop + TQ_BASE;
  sheet.page.text("Total Quantity", TQ_LABEL_X, tqBase, { font: "bold", size: T.totalLabel });
  sheet.page.text(cellQty(bill.totalQuantity), TQ_VALUE_R, tqBase, {
    font: "bold",
    size: T.totalLabel,
    align: "right",
  });
  sheet.y = tqTop + TQ_H;
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
      label: "ADD: CGST",
      value: money(bill.cgst),
      rate: taxRateLabel(bill.cgstRate, bill.cgst, bill.amountBeforeTax),
    },
    {
      label: "ADD: SGST",
      value: money(bill.sgst),
      rate: taxRateLabel(bill.sgstRate, bill.sgst, bill.amountBeforeTax),
    },
    {
      label: "ADD: IGST",
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
  const rows = totalRows(bill);
  const bandTop = BAND_TOP + sheet.headerGrowth;
  const page = sheet.page;

  // The label/value divider runs the full height of the band.
  page.line(TOTALS_DIV_X, bandTop + TOTALS_DIV_TOP, TOTALS_DIV_X, bandTop + TOTALS_DIV_BOTTOM, 0.5);

  /* Eight row rules, but the boxed grand-total row's own two edges ARE rules 4
     and 5: they are drawn as the box below rather than as loose lines. */
  for (let i = 0; i < rows.length; i++) {
    if (i === TOTALS_GRAND_FROM || i === TOTALS_GRAND_TO) continue;
    const ruleY = bandTop + TOTALS_RULE0 + i * TOTALS_RULE_PITCH;
    page.line(TOTALS_X, ruleY, TOTALS_X + TOTALS_W, ruleY, 0.5);
  }
  const grandTop = bandTop + TOTALS_RULE0 + TOTALS_GRAND_FROM * TOTALS_RULE_PITCH;
  const grandH = (TOTALS_GRAND_TO - TOTALS_GRAND_FROM) * TOTALS_RULE_PITCH;
  page.rect(TOTALS_X, grandTop, TOTALS_W, grandH, { lineWidth: 1.0, stroke: true });

  rows.forEach((row, i) => {
    const bold = row.bold === true;
    const labelBase = refBaseline(bandTop + TOTALS_TEXT0 + i * TOTALS_TEXT_PITCH, T.totalLabel, bold);
    page.text(row.label, TOTALS_LABEL_X, labelBase, { font: bold ? "bold" : "regular", size: T.totalLabel });
    if (row.rate) {
      // The rate sits on rows 1..3, i.e. one step below its TOTALS_RATE0 origin.
      const rateBase = refBaseline(bandTop + TOTALS_RATE0 + (i - 1) * TOTALS_TEXT_PITCH, T.totalRate, false);
      page.text(row.rate, TOTALS_RATE_R, rateBase, {
        size: T.totalRate,
        align: "right",
        color: [0x53 / 255, 0x55 / 255, 0x56 / 255],
      });
    }
    /* An empty value leaves its cell blank rather than printing a dash, so a
       template row with nothing in it still reads as an empty field. */
    if (row.value !== "") {
      const size = bold ? T.totalGrand : T.totalValue;
      const valueBase = refBaseline(bandTop + TOTALS_VALUE0 + i * TOTALS_TEXT_PITCH, size, true);
      page.text(row.value, TOTALS_VALUE_R, valueBase, { font: "bold", size, align: "right" });
    }
  });
}

/* ──────────────────────────────────────────────
   Amount in words
   ────────────────────────────────────────────── */

function renderWords(sheet: Sheet, bill: BillCopy): void {
  if (!bill.amountInWords) return;
  const top = WORDS_TOP + sheet.headerGrowth;
  const lines = wrapText(
    `Total Invoice Amount in Words: - ${bill.amountInWords}`,
    WORDS_R - WORDS_TEXT_X,
    "bold",
    T.words
  );
  /* An L, not a box: the reference rules the left edge and the foot only. */
  sheet.page.line(WORDS_X, top, WORDS_X, top + WORDS_H, 0.5);
  sheet.page.line(WORDS_X, top + WORDS_H, WORDS_R, top + WORDS_H, 0.5);
  const base0 = refBaseline(top + (WORDS_TEXT_TOP - WORDS_TOP), T.words, true);
  lines.forEach((line, i) => {
    sheet.page.text(line, WORDS_TEXT_X, base0 + i * (T.words + 2.6), { font: "bold", size: T.words });
  });
  /* The words box is content the signature block must clear if a logo has pushed
     it down. `renderColumns` continues the maximum from here. */
  sheet.y = Math.max(sheet.y, top + WORDS_H);
}

/* ──────────────────────────────────────────────
   Bank details / terms
   ────────────────────────────────────────────── */

function renderColumns(sheet: Sheet, bill: BillCopy): void {
  const page = sheet.page;
  const growth = sheet.headerGrowth;
  const { notes } = splitFooter(bill);

  /* The lowest ink this pass draws. The signature block reads it so its anchored
     rule cannot be overprinted by the closing rule when a logo has pushed the
     whole closing stack down. Seeded from `sheet.y`, which by now is the words
     box's foot (or the table's, when there are no words). */
  let bottom = sheet.y;

  /* ---- bank details, top left -------------------------------------------- */
  if (bill.bankLines.length > 0 || notes.length > 0) {
    const ruleY = BANK_RULE_Y + growth;
    page.line(BANK_X, ruleY, BANK_R, ruleY, 0.5);
  }
  if (bill.bankLines.length > 0) {
    page.text("Bank Details", BANK_HEAD_X, refBaseline(BANK_HEAD_TOP + growth, T.columnHead, true), {
      font: "bold",
      size: T.columnHead,
    });
    bill.bankLines.forEach((line, i) => {
      const base = refBaseline(BANK_ROW0 + i * BANK_ROW_PITCH + growth, T.columnBody, false);
      page.text(line, BANK_ROW_X, base, { size: T.columnBody });
      bottom = Math.max(bottom, base);
    });
  }
  /* The certification note is not a section of its own here: the reference
     prints it directly under the bank rows, in the same narrow column. */
  if (notes.length > 0) {
    const lastRow = BANK_ROW0 + Math.max(bill.bankLines.length - 1, 0) * BANK_ROW_PITCH;
    let y = refBaseline(lastRow + BANK_NOTE_GAP + growth, T.note, false);
    for (const note of notes) {
      for (const wrapped of wrapText(note, BANK_R - BANK_ROW_X, "regular", T.note)) {
        page.text(wrapped, BANK_ROW_X, y, { size: T.note, color: [0x2b / 255, 0x2e / 255, 0x30 / 255] });
        bottom = Math.max(bottom, y);
        y += T.note + 2.2;
      }
    }
  }

  /* ---- terms, full width below the words box ----------------------------- */
  if (bill.termsLines.length === 0) {
    sheet.y = bottom;
    return;
  }
  const headTop = TERMS_HEAD_TOP + growth;
  const headBase = refBaseline(headTop, TERMS_HEAD_SIZE, true);
  page.text("Terms & Conditions", BANK_X, headBase, { font: "bold", size: TERMS_HEAD_SIZE });

  let y = headBase + 13.79;
  let lastBase = y;
  const wrapW = WORDS_R - BANK_X;
  for (const line of bill.termsLines) {
    /* Mixed-style line. Every run of a visual line shares ONE baseline, so the
       larger bold window sits in the sentence rather than above or below it. */
    for (const visual of layoutRuns(splitEmphasis(line), wrapW, TERMS_BODY_SIZE)) {
      let x = BANK_X;
      for (const run of visual) {
        if (run.text !== "") {
          const size = run.emph ? TERMS_BODY_SIZE + EMPH_SIZE_DELTA : TERMS_BODY_SIZE;
          page.text(run.text, x, y, { font: run.emph ? "bold" : "regular", size });
          x += measurePdfText(run.text, { font: run.emph ? "bold" : "regular", size });
        }
      }
      lastBase = y;
      y += 15.2;
    }
  }
  /* The reference closes the terms with a filled rule (21.07–558.75 at
     738.61–739.87); a 1.26pt line centred on 739.24 is the same ink. */
  const ruleY = lastBase + (TERMS_RULE_TOP + TERMS_RULE_THICKNESS / 2 - 732.09);
  page.line(TERMS_RULE_X, ruleY, TERMS_RULE_R, ruleY, TERMS_RULE_THICKNESS);
  sheet.y = Math.max(bottom, ruleY);
}

/* ──────────────────────────────────────────────
   Notes and signatures
   ────────────────────────────────────────────── */

const SUPPLIER_SIG_RE = /^\s*for\s+\S|proprietor|proprietorship|director|partner|signatory|for\s+and\s+on\s+behalf/i;

/**
 * A footer line that names the supplier: "For EXAMPLE ENGINEERING WORKS".
 *
 * Split out from `SUPPLIER_SIG_RE` because the two answer different questions. That one
 * asks "does this line belong in the signature block at all", and a bare "(Proprietor)"
 * qualifies. This one asks "does this line already NAME the company", which only a "For
 * ..." line does - and only that answer suppresses adding a name of our own.
 */
const SUPPLIER_FOR_RE = /^\s*for\s+\S/i;

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
  // Name the supplier on the signature block when the footer does not already name one,
  // so a template that carried only the "(Proprietor)" designation still says who is
  // signing.
  //
  // WHEN A "FOR ..." LINE ALREADY EXISTS, IT IS LEFT ALONE - even if it names somebody
  // other than `bill.sellerName`.
  //
  // The workbook naming itself in its own footer is the bill exercising the same
  // precedence rule as every other field: its value wins. `sellerName` may by then have
  // come from the Invoice Business Profile, because the workbook carried no seller block,
  // so the two disagree by construction - the workbook's footer names one company while
  // the profile supplies another. Adding a second "For ..." line would print both names
  // on one invoice, which is worse than either alone: a customer cannot tell which
  // company is issuing the bill.
  //
  // This also keeps the profile from contradicting itself. `onBehalfOf` already let the
  // workbook's signatory line win, so synthesising another one from the profile's company
  // name here would undo that decision in the one place it is visible.
  if (bill.sellerName && !supplierLines.some((l) => SUPPLIER_FOR_RE.test(l))) {
    supplierLines.unshift(`For ${bill.sellerName}`);
  }
  return { notes, supplierLines };
}

function renderSignatures(sheet: Sheet, bill: BillCopy): void {
  /* `sheet.page` is read at each draw site, never captured here: reserve() can
     call newPage(), which replaces the page this function would be drawing on. */
  const size = T.signature;
  const { supplierLines } = splitFooter(bill);
  const receiverLines = bill.signatureLines.length > 0 ? bill.signatureLines : ["(Receivers Signature)"];

  /* The block is anchored on the RULE rather than on its bottom edge: the height
     varies with how many designations the workbook supplies, but the rule is the
     line that has to land in the same place on every bill. It never rises above
     the foot anchor, and a longer header can push the closing blocks down into
     that anchor — in which case the rule drops just far enough to clear them
     rather than overprinting the terms' closing rule. */
  const anchorLineY = PAGE_H - SIG_RULE_FROM_BOTTOM;
  const lineY = Math.max(anchorLineY, sheet.y + SIG_FLOW_GAP);

  const drawColumn = (x: number, lines: string[], align: "left" | "right"): void => {
    sheet.page.line(x, lineY, x + SIG_RULE_W, lineY, 0.6);
    let y = lineY + SIG_TEXT_OFFSET;
    for (const line of lines) {
      for (const wrapped of wrapText(line, SIG_RULE_W, "regular", size)) {
        sheet.page.text(wrapped, align === "right" ? x + SIG_RULE_W : x, y, { size, align });
        y += SIG_LEADING;
      }
    }
  };

  drawColumn(SIG_LEFT_X, supplierLines, "left");
  drawColumn(SIG_RIGHT_X, receiverLines, "right");
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
  logo?: PdfImage | null,
  profile?: BusinessProfile | null
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
  const labelled: BillCopy[] = bills.map((bill) => {
    const kinded: BillCopy = {
      ...bill,
      label: copyLabel,
      kind:
        (Object.keys(COPY_KIND_BY_LABEL) as CopyKind[]).find(
          (k) => COPY_KIND_BY_LABEL[k].toUpperCase() === copyLabel.trim().toUpperCase()
        ) ?? bill.kind,
    };
    /* Company-level DEFAULTS are folded in here, once, for every bill in the
       document, and only after the label override so a copied designation can
       never be mistaken for business data.

       The call is a no-op when no profile is configured — it returns the very
       object it was handed — so an invoice rendered without a profile passes
       through this function completely untouched. That is what keeps every
       pre-existing invoice byte-identical. */
    return applyBusinessProfile(kinded, profile);
  });

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
    page.text("E & O.E", MARGIN_X, FOOTER_BASELINE, { size: T.footer, color: [0.3, 0.3, 0.3] });
    page.text(
      `${copyLabel}   |   ${pageOwner[i] ?? ""}   |   Page ${i + 1} of ${total}`,
      MARGIN_X + CONTENT_W,
      FOOTER_BASELINE,
      { size: T.footer, align: "right", color: [0.3, 0.3, 0.3] }
    );
  });

  return sheet.doc.build();
}