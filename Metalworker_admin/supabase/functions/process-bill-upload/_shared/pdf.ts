// supabase/functions/process-bill-upload/_shared/pdf.ts
//
// A small, dependency-free PDF 1.4 writer.
//
// WHY A HAND-ROLLED WRITER
// The requirement is a print-ready A4 invoice that looks IDENTICAL whether the
// upload came from the browser admin or the mobile admin, generated with no
// LibreOffice, no native converter and no unavailable dependency. The output
// only has to be black text, black rules, black boxes and two Base-14 fonts -
// all of which is a few hundred lines of PDF syntax. Pulling in a PDF library
// would add a dependency to the Deno runtime for no visual benefit, and would
// risk the two clients diverging if their toolchains ever drifted.
//
// DESIGN NOTES
// * Text is positioned with `Tm` at an absolute point rather than with a running
//   cursor, so a page's content stream is order-independent and easy to reason
//   about. Each `drawText` is self-contained: BT ... Tm ... Tj ... ET.
// * Coordinates are supplied TOP-DOWN (y measured from the top of the page),
//   which is how the layout is written; the writer flips to PDF's bottom-left
//   origin on the way out.
// * All strings are transliterated to WinAnsi and encoded as ISO-8859-1 bytes,
//   never UTF-8: a literal PDF string is a byte string, and a multi-byte UTF-8
//   sequence would be read as garbage. The rupee sign is transliterated to
//   "Rs." because the Base-14 fonts have no rupee glyph.

import { type FontName, measureText } from "./fontMetrics.ts";

/** A4 portrait, in PostScript points. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

const FONT_RESOURCE: Record<FontName, string> = { regular: "F1", bold: "F2" };

/* ──────────────────────────────────────────────
   Text encoding
   ────────────────────────────────────────────── */

// Typographic characters the Base-14 fonts cannot render, mapped to the ASCII a
// real invoice would have used. Written as escapes because half of this set is
// invisible characters that would otherwise be unreviewable in the source.
const TRANSLITERATE: Record<string, string> = {
  "\u20B9": "Rs.", // RUPEE SIGN - the substitution that actually matters
  "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'", // single quotes
  "\u201C": '"', "\u201D": '"', "\u201E": '"', // double quotes
  "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", // hyphens and dashes
  "\u2014": "-", "\u2015": "-", "\u2212": "-",
  "\u2026": "...", // ellipsis
  "\u2022": "-", // bullet
  "\u00B7": "-", // middle dot
  "\u00A0": " ", "\u2007": " ", "\u2009": " ", "\u2002": " ", // non-breaking / thin / en space
  "\u200A": " ", "\u202F": " ", "\u2005": " ", // hair space
  "\u200B": "", "\u200C": "", "\u200D": "", "\uFEFF": "", // zero-width chars and BOM
  "\u00D7": "x", "\u00F7": "/", "\u00B0": " deg",
  "\u2122": "(TM)", "\u00AE": "(R)", "\u00A9": "(C)",
  "\u00BD": " 1/2", "\u00BC": " 1/4", "\u00BE": " 3/4",
  "\u20AC": "EUR", "\u00A3": "GBP", "\u00A5": "JPY", "\u00A2": "c",
  "\u2260": "!=", "\u2264": "<=", "\u2265": ">=",
  "\u2190": "<-", "\u2192": "->", "\u2191": "^", "\u2193": "v",
  "\u2211": "Sum", "\u2116": "No.", "\u221A": "sqrt",
};

/** Map a string onto characters the two embedded fonts can actually draw. */
function toWinAnsi(input: string): string {
  let out = "";
  for (const ch of input) {
    const mapped = TRANSLITERATE[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.charCodeAt(0);
    // 0x00-0x1F are control characters; 0x80-0x9F would be WinAnsi-specific
    // mapping rather than Latin-1, and transliteration has already removed the
    // only realistic sources of those.
    if (code < 32 || (code >= 0x7f && code <= 0x9f)) continue;
    if (code > 0xff) continue;
    out += ch;
  }
  return out;
}

/** Escape a string for use inside a PDF literal string `( ... )`. */
function pdfString(input: string): string {
  const text = toWinAnsi(input);
  let out = "";
  for (const ch of text) {
    if (ch === "\\") out += "\\\\";
    else if (ch === "(") out += "\\(";
    else if (ch === ")") out += "\\)";
    else out += ch;
  }
  return out;
}

/** ISO-8859-1 bytes. Distinct from TextEncoder, which is always UTF-8. */
function latin1Bytes(input: string): Uint8Array {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    bytes[i] = input.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function num(n: number): string {
  // Trim float noise so content streams stay small and byte offsets stable.
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/* ──────────────────────────────────────────────
   Page
   ────────────────────────────────────────────── */

export interface TextOptions {
  font?: FontName;
  size?: number;
  align?: "left" | "center" | "right";
  /** Draw each character in this colour. Defaults to black. */
  color?: [number, number, number];
}

/**
 * Width of `text` as it would be drawn, without needing a page.
 *
 * Exists because layout has to be measurable before anything is drawn: a block
 * reserves its height and only afterwards is placed, and the two must agree or the
 * document overlaps itself. A caller holding no page still needs the same number
 * `PdfPage.measure` would give, and duplicating the `toWinAnsi` conversion at each
 * call site is how those two numbers start to differ.
 */
export function measurePdfText(text: string, opts: TextOptions = {}): number {
  return measureText(toWinAnsi(text), opts.font ?? "regular", opts.size ?? 9);
}

export class PdfPage {
  readonly width: number;
  readonly height: number;
  private readonly ops: string[] = [];

  constructor(width = PAGE_WIDTH, height = PAGE_HEIGHT) {
    this.width = width;
    this.height = height;
  }

  /** Width of `text` as it would be drawn on this page. */
  measure(text: string, opts: TextOptions = {}): number {
    return measurePdfText(text, opts);
  }

  /**
   * Draw one line of text. `y` is the BASELINE measured from the top of the
   * page, so the first line of a block sits comfortably below its top edge.
   */
  text(value: string, x: number, y: number, opts: TextOptions = {}): void {
    const font = opts.font ?? "regular";
    const size = opts.size ?? 9;
    const align = opts.align ?? "left";
    const color = opts.color ?? [0, 0, 0];

    if (value === "") return;

    const clean = toWinAnsi(value);
    const width = measureText(clean, font, size);
    let left = x;
    if (align === "right") left = x - width;
    else if (align === "center") left = x - width / 2;

    // Keep text inside the page box rather than letting it run off the edge.
    if (left < 2) left = 2;
    else if (left + width > this.width - 2) left = this.width - 2 - width;

    const baseline = this.height - y;
    this.ops.push(
      `${num(color[0])} ${num(color[1])} ${num(color[2])} rg`,
      "BT",
      `/${FONT_RESOURCE[font]} ${num(size)} Tf`,
      `1 0 0 1 ${num(left)} ${num(baseline)} Tm`,
      `(${pdfString(value)}) Tj`,
      "ET"
    );
  }

  /** A straight rule. Coordinates are top-down, like `text`. */
  line(x1: number, y1: number, x2: number, y2: number, width = 0.6, color: [number, number, number] = [0, 0, 0]): void {
    this.ops.push(
      `${num(color[0])} ${num(color[1])} ${num(color[2])} RG`,
      `${num(width)} w`,
      `${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`
    );
  }

  /** A rectangle, stroked and/or filled. Coordinates are top-down. */
  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { lineWidth?: number; stroke?: boolean; fill?: boolean; color?: [number, number, number] } = {}
  ): void {
    const { lineWidth = 0.6, stroke = true, fill = false, color = [0, 0, 0] } = opts;
    const [r, g, b] = color;
    this.ops.push(`${num(r)} ${num(g)} ${num(b)} rg`, `${num(r)} ${num(g)} ${num(b)} RG`, `${num(lineWidth)} w`);
    const bottom = this.height - y - h;
    this.ops.push(`${num(x)} ${num(bottom)} ${num(w)} ${num(h)} re`);
    if (fill) this.ops.push("f");
    if (stroke) this.ops.push("S");
    else if (!fill) this.ops.push("n");
  }

  /** The finished content stream, as PDF bytes. */
  encode(): Uint8Array {
    return latin1Bytes(`${this.ops.join("\n")}\n`);
  }
}

/* ──────────────────────────────────────────────
   Document
   ────────────────────────────────────────────── */

export interface DocumentInfo {
  title: string;
  subject?: string;
}

export class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly info: DocumentInfo;

  constructor(info: DocumentInfo) {
    this.info = info;
  }

  addPage(): PdfPage {
    const page = new PdfPage();
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /**
   * The finished pages, in order.
   *
   * A caller that needs the page count before serialising - to stamp
   * "Page 2 of 3" footers, for example - has to reach back into the pages after
   * the layout pass but before `build`.
   */
  getPages(): readonly PdfPage[] {
    return this.pages;
  }

  /**
   * Serialise to a complete PDF file.
   *
   * Object numbering is fixed up front so the /Kids array and the /Pages parent
   * references can be written without a second pass. Byte offsets for the xref
   * table are accumulated as the file is concatenated, because PDF requires them
   * to be exact.
   */
  build(): Uint8Array {
    if (this.pages.length === 0) throw new Error("A PDF must have at least one page");

    const n = this.pages.length;
    const catalogId = 1;
    const pagesId = 2;
    const firstPageId = 3;
    const regularFontId = firstPageId + n * 2;
    const boldFontId = regularFontId + 1;
    const infoId = boldFontId + 1;

    // Content streams are built first because their /Length must be known.
    const contents = this.pages.map((p) => p.encode());

    const chunks: Uint8Array[] = [];
    let length = 0;
    const push = (s: string): void => {
      const bytes = latin1Bytes(s);
      chunks.push(bytes);
      length += bytes.length;
    };
    const pushBytes = (bytes: Uint8Array): void => {
      chunks.push(bytes);
      length += bytes.length;
    };
    /** Records the byte offset of the object that is about to be written. */
    const offsets: number[] = [];

    // A binary comment on line 2 marks the file as containing 8-bit data.
    pushBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const object = (id: number, body: string): void => {
      offsets[id] = length;
      push(`${id} 0 obj\n${body}\nendobj\n`);
    };

    const kids = this.pages.map((_, i) => `${firstPageId + i * 2} 0 R`).join(" ");

    object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    object(pagesId, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);

    for (let i = 0; i < n; i++) {
      const pageId = firstPageId + i * 2;
      const contentId = pageId + 1;
      const content = contents[i];
      object(
        pageId,
        `<< /Type /Page /Parent ${pagesId} 0 R ` +
          `/MediaBox [0 0 ${num(this.pages[i].width)} ${num(this.pages[i].height)}] ` +
          `/Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> ` +
          `/Contents ${contentId} 0 R >>`
      );
      offsets[contentId] = length;
      push(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
      pushBytes(content);
      push("\nendstream\nendobj\n");
    }

    for (const [id, base] of [
      [regularFontId, "Helvetica"],
      [boldFontId, "Helvetica-Bold"],
    ] as const) {
      object(
        id,
        `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`
      );
    }

    const infoParts = [`/Title (${pdfString(this.info.title)})`, "/Producer (Metalworker Bills)"];
    if (this.info.subject) infoParts.push(`/Subject (${pdfString(this.info.subject)})`);
    object(infoId, `<< ${infoParts.join(" ")} >>`);

    const maxId = infoId;
    const xrefOffset = length;

    let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= maxId; id++) {
      const offset = offsets[id];
      if (offset === undefined) throw new Error(`Object ${id} was never written`);
      xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    push(xref);
    push(
      `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF\n`
    );

    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/* ──────────────────────────────────────────────
   Word wrapping
   ────────────────────────────────────────────── */

/**
 * Break `text` into lines that each fit inside `maxWidth`.
 *
 * Long unbreakable tokens (a part number, a GSTIN) are split mid-token rather
 * than allowed to overflow the page, which is what keeps a stray long string
 * from silently pushing content off the edge of the sheet.
 */
export function wrapText(text: string, maxWidth: number, font: FontName = "regular", size = 8): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  const widthOf = (s: string): number => measureText(toWinAnsi(s), font, size);

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (widthOf(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    // The word alone may still be too wide; hard-split it.
    if (widthOf(word) > maxWidth) {
      let piece = "";
      for (const ch of word) {
        if (widthOf(piece + ch) > maxWidth && piece !== "") {
          lines.push(piece);
          piece = ch;
        } else {
          piece += ch;
        }
      }
      current = piece;
    } else {
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}
