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
import type { PdfImage } from "./pdfImage.ts";

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

  /**
   * Draw a registered image into the box (x, y, w, h). `y` is the TOP edge of
   * that box, like every other call here.
   *
   * The placement is the caller's whole responsibility: this method draws the
   * box it is given, so the aspect ratio has to have been worked out before the
   * call. `renderBill.ts` is where that decision is made, and where it is
   * measured against the real header geometry.
   *
   * The `q`/`Q` pair saves and restores the graphics state, so an image cannot
   * leak a transform into whatever is drawn next — the same reason every other
   * primitive here is self-contained.
   */
  image(resource: string, x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.ops.push(
      "q",
      `${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.height - y - h)} cm`,
      `/${resource} Do`,
      "Q"
    );
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
  private readonly images: { name: string; image: PdfImage }[] = [];

  constructor(info: DocumentInfo) {
    this.info = info;
  }

  addPage(): PdfPage {
    const page = new PdfPage();
    this.pages.push(page);
    return page;
  }

  /**
   * Attach an image to this document and return the resource name to draw it
   * with.
   *
   * Registering is separate from drawing so the object appears once in the file
   * however many places use it: a logo repeated on three print copies is one
   * object and three `/Im0 Do` calls, not three copies of the pixels.
   *
   * Registering the same `PdfImage` twice returns the same name rather than
   * writing it twice, so a caller cannot accidentally double a file's weight by
   * re-registering between renders.
   */
  registerImage(image: PdfImage): string {
    const existing = this.images.find((entry) => entry.image === image);
    if (existing) return existing.name;
    const name = `Im${this.images.length}`;
    this.images.push({ name, image });
    return name;
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

    /* Images are numbered after the document info dictionary, which is last in
       the file today and therefore the one object whose id does not have to
       move. A transparent image takes two objects: the colour plane and its soft
       mask, and the mask is referenced from the colour plane's own dictionary,
       so it must be numbered first for that reference to be written with a
       known id. */
    const firstImageId = infoId + 1;
    let nextImageId = firstImageId;
    const imageIds = this.images.map(({ image }) => {
      const smaskId = image.smask ? nextImageId++ : null;
      const colorId = nextImageId++;
      return { colorId, smaskId };
    });
    const maxId = nextImageId - 1;

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
    /** A stream object: the dictionary, then exactly /Length bytes of payload.
     *
     *  `keys` is the dictionary's own entries WITHOUT a leading space, so that an
     *  empty `keys` produces exactly `<< /Length n >>` — the same single space the
     *  content streams have always had. Composing this with string concatenation
     *  instead would put two spaces there and change the bytes of every document
     *  this file has ever produced. */
    const streamObject = (id: number, keys: string, bytes: Uint8Array): void => {
      offsets[id] = length;
      const entries = keys === "" ? `/Length ${bytes.length}` : `${keys} /Length ${bytes.length}`;
      push(`${id} 0 obj\n<< ${entries} >>\nstream\n`);
      pushBytes(bytes);
      push("\nendstream\nendobj\n");
    };

    const kids = this.pages.map((_, i) => `${firstPageId + i * 2} 0 R`).join(" ");

    /* Empty unless an image was registered. An invoice with no logo must not
       carry an empty /XObject entry: that would change the bytes of every
       document produced before this feature existed, for no benefit, and the
       "no logo renders exactly as it always did" guarantee is much easier to
       keep honest when the no-logo path is byte-identical rather than merely
       visually identical. */
    const xobject =
      this.images.length === 0
        ? ""
        : ` /XObject << ${this.images
            .map((entry, i) => `/${entry.name} ${imageIds[i].colorId} 0 R`)
            .join(" ")} >>`;

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
          `/Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >>${xobject} >> ` +
          `/Contents ${contentId} 0 R >>`
      );
      streamObject(contentId, "", content);
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

    /* Image objects. The soft mask is written before the colour plane it is
       referenced from, because its object id has to be known when the colour
       plane's dictionary is written. */
    for (let i = 0; i < this.images.length; i++) {
      const { image } = this.images[i];
      const { colorId, smaskId } = imageIds[i];

      if (image.smask && smaskId !== null) {
        streamObject(
          smaskId,
          `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
            `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
          image.smask.data
        );
      }

      const smaskRef = image.smask && smaskId !== null ? ` /SMask ${smaskId} 0 R` : "";
      streamObject(
        colorId,
        `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
          `/ColorSpace /${image.colorSpace} /BitsPerComponent 8 /Filter /${image.filter}${smaskRef}`,
        image.data
      );
    }

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

/* ──────────────────────────────────────────────
   Streaming assembly
   ────────────────────────────────────────────── */

/**
 * Writes a text-only document page by page, producing exactly the bytes
 * `PdfDocument.build()` would produce for the same pages.
 *
 * WHY THIS EXISTS
 * A workbook aggregate is too large to lay out in one Edge Function invocation, so
 * it is laid out in chunks and assembled afterwards. A general PDF library has to
 * parse every chunk into an object graph and serialise the whole merged graph
 * again, which is what exhausted the worker. This writer needs neither: the object
 * numbering of a text-only document depends only on its page count, so once the
 * total is known every page can be written straight out as its bytes arrive, and
 * the only thing held is the output itself.
 *
 * Images are deliberately not supported: aggregates carry no logo, and a document
 * that needs one is built with `PdfDocument`.
 */
export class PdfPageStreamWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  private readonly offsets: number[] = [];
  private written = 0;
  private finished = false;
  private readonly pageCount: number;
  private readonly info: DocumentInfo;

  constructor(info: DocumentInfo, pageCount: number) {
    if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("A PDF must have at least one page");
    this.info = info;
    this.pageCount = pageCount;

    this.pushBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(" ");
    this.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    this.object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  }

  /** Bytes written so far. Lets a caller stop before an output grows past a cap. */
  get byteLength(): number {
    return this.length;
  }

  /**
   * Append the next page. `content` is the page's content stream, given as parts
   * so a body and its footer can be written without first being joined.
   */
  addPage(content: Uint8Array[], width = PAGE_WIDTH, height = PAGE_HEIGHT): void {
    if (this.finished) throw new Error("The document is already finished");
    if (this.written >= this.pageCount) throw new Error(`More than the declared ${this.pageCount} pages were written`);
    const pageId = 3 + this.written * 2;
    const contentId = pageId + 1;
    const regularFontId = 3 + this.pageCount * 2;
    this.object(
      pageId,
      `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${num(width)} ${num(height)}] ` +
        `/Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${regularFontId + 1} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`
    );
    const streamLength = content.reduce((sum, part) => sum + part.length, 0);
    this.offsets[contentId] = this.length;
    this.push(`${contentId} 0 obj\n<< /Length ${streamLength} >>\nstream\n`);
    for (const part of content) this.pushBytes(part);
    this.push("\nendstream\nendobj\n");
    this.written++;
  }

  /** Write the fonts, the info dictionary and the cross-reference table. */
  finish(): Uint8Array {
    if (this.finished) throw new Error("The document is already finished");
    if (this.written !== this.pageCount) {
      throw new Error(`Declared ${this.pageCount} pages but ${this.written} were written`);
    }
    this.finished = true;
    const regularFontId = 3 + this.pageCount * 2;
    const boldFontId = regularFontId + 1;
    const infoId = boldFontId + 1;
    for (const [id, base] of [
      [regularFontId, "Helvetica"],
      [boldFontId, "Helvetica-Bold"],
    ] as const) {
      this.object(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
    }
    const infoParts = [`/Title (${pdfString(this.info.title)})`, "/Producer (Metalworker Bills)"];
    if (this.info.subject) infoParts.push(`/Subject (${pdfString(this.info.subject)})`);
    this.object(infoId, `<< ${infoParts.join(" ")} >>`);

    const xrefOffset = this.length;
    let xref = `xref\n0 ${infoId + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= infoId; id++) {
      const offset = this.offsets[id];
      if (offset === undefined) throw new Error(`Object ${id} was never written`);
      xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    this.push(xref);
    this.push(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    this.chunks.length = 0;
    return out;
  }

  private object(id: number, body: string): void {
    this.offsets[id] = this.length;
    this.push(`${id} 0 obj\n${body}\nendobj\n`);
  }

  private push(s: string): void {
    this.pushBytes(latin1Bytes(s));
  }

  private pushBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
}

/* ──────────────────────────────────────────────
   Reading back and validating
   ────────────────────────────────────────────── */

/** A PDF that is not a complete, self-consistent document of the expected shape. */
export class PdfStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfStructureError";
  }
}

export interface PdfStructure {
  pageCount: number;
  /** Each page's content stream, as views into the input (not copies). */
  contents: Uint8Array[];
  /** True when any page references an image. */
  hasImages: boolean;
}

/**
 * Parse and verify a PDF written by this module.
 *
 * Every check here is structural and exact, because this is what stands between a
 * truncated or corrupt file and a financial document being published:
 * - the header, the trailer and `%%EOF` are present;
 * - `startxref` points at the cross-reference table;
 * - every in-use cross-reference entry points at the object it claims to be;
 * - the page tree's /Count matches its /Kids, and every page's content stream is
 *   exactly /Length bytes followed by `endstream`.
 *
 * It reads only this writer's own layout. A PDF from anywhere else is reported as
 * a structure error rather than half-understood.
 */
export function readPdfStructure(bytes: Uint8Array): PdfStructure {
  if (bytes.length < 64) throw new PdfStructureError("The file is too short to be a PDF");
  // One character per byte, so string offsets are byte offsets. Only ASCII tokens
  // are ever searched for, so how the high half decodes does not matter.
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.startsWith("%PDF-1.")) throw new PdfStructureError("The file does not start with a PDF header");
  if (!text.endsWith("%%EOF\n")) throw new PdfStructureError("The file does not end with %%EOF (truncated?)");

  const sx = text.lastIndexOf("startxref\n");
  if (sx < 0) throw new PdfStructureError("No startxref");
  const xrefOffset = Number(text.slice(sx + 10, text.indexOf("\n", sx + 10)));
  if (!Number.isInteger(xrefOffset) || !text.startsWith("xref\n", xrefOffset)) {
    throw new PdfStructureError("startxref does not point at the cross-reference table");
  }

  const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefOffset, xrefOffset + 32));
  if (!header) throw new PdfStructureError("Malformed cross-reference header");
  const size = Number(header[1]);
  const entriesStart = xrefOffset + header[0].length;
  const offsets: number[] = [];
  for (let id = 0; id < size; id++) {
    const entry = text.slice(entriesStart + id * 20, entriesStart + id * 20 + 20);
    const m = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(entry);
    if (!m) throw new PdfStructureError(`Malformed cross-reference entry ${id}`);
    if (m[3] === "n") {
      const offset = Number(m[1]);
      if (!text.startsWith(`${id} 0 obj\n`, offset)) {
        throw new PdfStructureError(`Cross-reference entry ${id} does not point at object ${id}`);
      }
      offsets[id] = offset;
    }
  }

  const trailer = /^trailer\n<< \/Size (\d+) \/Root (\d+) 0 R/.exec(text.slice(entriesStart + size * 20, sx));
  if (!trailer || Number(trailer[1]) !== size) throw new PdfStructureError("Trailer /Size does not match the table");

  const objectBody = (id: number): string => {
    const offset = offsets[id];
    if (offset === undefined) throw new PdfStructureError(`Object ${id} is missing`);
    const start = offset + `${id} 0 obj\n`.length;
    const end = text.indexOf("\nendobj\n", start);
    if (end < 0) throw new PdfStructureError(`Object ${id} is not terminated`);
    return text.slice(start, end);
  };

  const catalog = objectBody(Number(trailer[2]));
  const pagesRef = /\/Type \/Catalog \/Pages (\d+) 0 R/.exec(catalog);
  if (!pagesRef) throw new PdfStructureError("The catalog has no page tree");
  const pages = objectBody(Number(pagesRef[1]));
  const tree = /\/Kids \[([\d R]*)\] \/Count (\d+)/.exec(pages);
  if (!tree) throw new PdfStructureError("Malformed page tree");
  const kids = (tree[1].match(/\d+ 0 R/g) ?? []).map((ref) => Number(ref.split(" ")[0]));
  const pageCount = Number(tree[2]);
  if (pageCount < 1 || kids.length !== pageCount) throw new PdfStructureError("Page tree /Count does not match its /Kids");

  const contents: Uint8Array[] = [];
  let hasImages = false;
  for (const kid of kids) {
    const page = objectBody(kid);
    if (!page.startsWith("<< /Type /Page ")) throw new PdfStructureError(`Object ${kid} is not a page`);
    if (page.includes("/XObject")) hasImages = true;
    const contentRef = /\/Contents (\d+) 0 R/.exec(page);
    if (!contentRef) throw new PdfStructureError(`Page ${kid} has no content stream`);
    const contentId = Number(contentRef[1]);
    const offset = offsets[contentId];
    if (offset === undefined) throw new PdfStructureError(`Content stream ${contentId} is missing`);
    const head = new RegExp(`^${contentId} 0 obj\\n<< /Length (\\d+) >>\\nstream\\n`).exec(text.slice(offset, offset + 64));
    if (!head) throw new PdfStructureError(`Content stream ${contentId} has an unexpected header`);
    const start = offset + head[0].length;
    const end = start + Number(head[1]);
    if (!text.startsWith("\nendstream\nendobj\n", end)) {
      throw new PdfStructureError(`Content stream ${contentId} is not exactly /Length bytes`);
    }
    contents.push(bytes.subarray(start, end));
  }

  return { pageCount, contents, hasImages };
}

/** CRC-32 (IEEE), so a stored file can be checked against what was written. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
