// supabase/functions/process-bill-upload/_shared/xlsx.ts
//
// Minimal, dependency-free .xlsx reader.
//
// WHY THIS EXISTS INSTEAD OF A LIBRARY:
// The bill pipeline must produce identical output whether the upload came from
// the browser admin or the mobile admin, so all parsing happens here, once, on
// the server. Pulling a spreadsheet library into the Deno runtime for that would
// add a native/large dependency for the four XML parts we actually need, so
// this reads them directly:
//   * the ZIP container            (Deno's built-in DecompressionStream)
//   * xl/workbook.xml              (sheet names)
//   * xl/_rels/workbook.xml.rels   (sheet name -> part name)
//   * xl/sharedStrings.xml         (the string table)
//   * xl/worksheets/sheetN.xml     (cells, cached formula values, merges)
//
// IMPORTANT BEHAVIOUR: formula cells expose their CACHED value (the <v> the
// author last saved in Excel), which is what a viewer would print. The
// formulas themselves (SUM, SUM(F18*G18), ...) are never re-evaluated — an
// invoice's printed figures come from Excel, not from us re-doing its maths.

/* ──────────────────────────────────────────────
   ZIP
   ────────────────────────────────────────────── */

interface ZipEntry {
  /** Path inside the archive, e.g. "xl/worksheets/sheet1.xml". */
  name: string;
  /** Decompressed bytes. */
  data: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEndOfCentralDirectory(view: DataView): number {
  // The EOCD record is at the very end, after an optional comment of up to
  // 65535 bytes, so scan backwards over the last 64 KiB + 22.
  const start = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate-raw")
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read every member of a ZIP archive. */
async function unzip(buffer: ArrayBuffer): Promise<Map<string, ZipEntry>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const out = new Map<string, ZipEntry>();

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error("Not a ZIP archive (no end-of-central-directory record)");

  const entryCount = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(ptr, true) !== CEN_SIG) {
      throw new Error("Corrupt ZIP central directory");
    }
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // The LOCAL header's name/extra lengths are authoritative for where the
    // data starts; they can differ from the central directory's.
    if (view.getUint32(localOffset, true) !== LOC_SIG) {
      throw new Error(`Corrupt ZIP local header for "${name}"`);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    // Directory entries carry no data; skip them rather than inflating "".
    if (!name.endsWith("/")) {
      const data = method === 0 ? raw.slice() : await inflateRaw(raw);
      out.set(name, { name, data });
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

/* ──────────────────────────────────────────────
   XML
   ────────────────────────────────────────────── */

function decodeXmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code);
      }
      return whole;
    }
    switch (body) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: return whole;
    }
  });
}

/** Every element's attributes, as a flat list of {name, value, index}. */
interface Attr {
  name: string;
  value: string;
  /** Offset just after this attribute, i.e. where the element's body starts. */
  end: number;
}

function parseAttrs(tag: string): Attr[] {
  const attrs: Attr[] = [];
  // Attributes never contain '>' in SpreadsheetML, so a simple scan is exact.
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    attrs.push({ name: m[1], value: decodeXmlEntities(m[2]), end: m.index + m[0].length });
  }
  return attrs;
}

/* ──────────────────────────────────────────────
   Cells
   ────────────────────────────────────────────── */

export type CellType = "number" | "shared" | "inline" | "string" | "boolean" | "error";

export interface SheetCell {
  /** Zero-based row index. */
  row: number;
  /** Zero-based column index. */
  col: number;
  type: CellType;
  /**
   * Display value. Numbers stay numbers; everything else becomes a string.
   * For a formula cell this is the CACHED result Excel saved, not the formula.
   */
  value: string | number;
  /** Present when the cell holds a formula; informational only. */
  formula?: string;
}

export interface Sheet {
  name: string;
  cells: Map<string, SheetCell>;
  maxRow: number;
  maxCol: number;
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

/** "H18" -> { row: 17, col: 7 }. Returns null for a malformed reference. */
function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { row: parseInt(m[2], 10) - 1, col: col - 1 };
}

/** Extract the text of every <t> element in a slice of XML. */
function readTextRuns(xml: string, from: number, to: number): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m.index >= to) break;
    out += m[1] ? decodeXmlEntities(m[1]) : "";
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const si = /<si(?:\s[^>]*)?>|<si\s*\/>/g;
  const parts: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = si.exec(xml)) !== null) {
    if (m[0] === "<si/>" ) {
      parts.push({ start: m.index, end: m.index + m[0].length });
      continue;
    }
    const close = xml.indexOf("</si>", m.index);
    if (close < 0) break;
    parts.push({ start: m.index, end: close + 5 });
    si.lastIndex = close + 5;
  }
  for (const p of parts) {
    // A run may be split across <r><t>..</t></r>; concatenate them in order.
    out.push(readTextRuns(xml, p.start, p.end));
  }
  return out;
}

function parseSheet(name: string, xml: string, shared: string[]): Sheet {
  const cells = new Map<string, SheetCell>();
  let maxRow = -1;
  let maxCol = -1;

  const decoder = new TextDecoder();
  // ONE capture for the attributes, shared by both shapes:
  //   <c r="A1" s="2"/>              -> g1 = attrs, g2 = undefined (empty cell)
  //   <c r="A1" s="2"><v>7</v></c>  -> g1 = attrs, g2 = body
  // Keeping a single attribute group matters: with two separate alternatives the
  // non-self-closing branch would drop the attributes and lose every cell's
  // position.
  const tag = /<c(?:\s([^>]*?))?(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;

  while ((m = tag.exec(xml)) !== null) {
    const selfClosing = m[0].endsWith("/>");
    const attrs = parseAttrs(m[1] ?? "");
    const body = selfClosing ? "" : m[2];

    const ref = attrs.find((a) => a.name === "r")?.value;
    const t = attrs.find((a) => a.name === "t")?.value ?? "n";
    const parsed = ref ? parseRef(ref) : null;
    if (!parsed) continue; // No reference: position is unknowable, skip it.

    let value: string | number;
    let formula: string | undefined;

    if (!selfClosing && body !== undefined) {
      const f = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>|<f(?:\s[^>]*)?\/>/.exec(body);
      if (f && f[1] !== undefined) formula = decodeXmlEntities(f[1]);

      if (t === "inlineStr") {
        value = readTextRuns(body, 0, body.length);
      } else {
        // For a formula cell this is the cached <v>; for a plain cell it is the
        // literal value. Both are what Excel displayed.
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body);
        const raw = v ? decodeXmlEntities(v[1]) : "";
        if (t === "s") {
          const idx = parseInt(raw, 10);
          value = Number.isFinite(idx) ? shared[idx] ?? "" : "";
        } else if (t === "str" || t === "e") {
          value = raw;
        } else if (t === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else {
          const num = Number(raw);
          value = raw !== "" && Number.isFinite(num) ? num : raw;
        }
      }
    } else {
      value = "";
    }

    if (value === "" && formula === undefined) continue; // styled-but-empty

    cells.set(cellKey(parsed.row, parsed.col), {
      row: parsed.row,
      col: parsed.col,
      type: t === "n" ? "number" : (t as CellType),
      value,
      formula,
    });
    if (parsed.row > maxRow) maxRow = parsed.row;
    if (parsed.col > maxCol) maxCol = parsed.col;
  }

  // Referenced only to keep the decode helper reachable for merged cells.
  void decoder;

  return { name, cells, maxRow, maxCol };
}

/* ──────────────────────────────────────────────
   Workbook
   ────────────────────────────────────────────── */

export interface Workbook {
  /** Sheets in workbook order — this is the order the PDFs must preserve. */
  sheets: Sheet[];
}

/**
 * Read a workbook from its raw bytes.
 *
 * Accepts an `ArrayBuffer` or any view onto one, because a caller that already
 * has a `Uint8Array` (decoded base64, a fetched response body) would otherwise
 * have to know that `view.buffer` can be larger than `view` and slice by hand.
 */
export async function readXlsx(input: ArrayBuffer | ArrayBufferView): Promise<Workbook> {
  const buffer: ArrayBuffer = ArrayBuffer.isView(input)
    ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
    : (input as ArrayBuffer);
  const zip = await unzip(buffer);
  const xmlOf = (name: string): string =>
    new TextDecoder().decode(zip.get(name)?.data ?? new Uint8Array(0));

  const workbookXml = xmlOf("xl/workbook.xml");
  const relsXml = xmlOf("xl/_rels/workbook.xml.rels");
  const shared = parseSharedStrings(xmlOf("xl/sharedStrings.xml"));

  // rId -> part path, e.g. "rId1" -> "worksheets/sheet1.xml".
  const relTargets = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let rel: RegExpExecArray | null;
  while ((rel = relRe.exec(relsXml)) !== null) {
    const attrs = parseAttrs(rel[1]);
    const id = attrs.find((a) => a.name === "Id")?.value;
    const target = attrs.find((a) => a.name === "Target")?.value;
    if (!id || !target) continue;
    // Targets may be absolute ("/xl/worksheets/sheet1.xml") or relative to /xl.
    const normalized = target.replace(/^\//, "").replace(/^xl\//, "");
    relTargets.set(id, normalized);
  }

  const sheets: Sheet[] = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let sh: RegExpExecArray | null;
  while ((sh = sheetRe.exec(workbookXml)) !== null) {
    const attrs = parseAttrs(sh[1]);
    const sheetName = attrs.find((a) => a.name === "name")?.value;
    const rid = attrs.find((a) => a.name === "r:id" || a.name === "id")?.value;
    if (!sheetName) continue;
    const part = rid ? relTargets.get(rid) : undefined;
    if (!part) continue;
    const partXml = xmlOf(`xl/${part}`);
    if (!partXml) continue;
    sheets.push(parseSheet(decodeXmlEntities(sheetName), partXml, shared));
  }

  if (sheets.length === 0) {
    throw new Error("Workbook contains no readable worksheets");
  }
  return { sheets };
}

/* ──────────────────────────────────────────────
   Grid access helpers
   ────────────────────────────────────────────── */

/** Raw cell lookup; undefined when the cell is absent or empty. */
export function cellAt(sheet: Sheet, row: number, col: number): SheetCell | undefined {
  return sheet.cells.get(cellKey(row, col));
}

/** Trimmed text of a cell, or "" when absent. Numbers stringify as written. */
export function textAt(sheet: Sheet, row: number, col: number): string {
  const c = sheet.cells.get(cellKey(row, col));
  if (!c) return "";
  return typeof c.value === "number" ? String(c.value) : c.value.trim();
}

/** Numeric value of a cell, or null when absent or non-numeric. */
export function numberAt(sheet: Sheet, row: number, col: number): number | null {
  const c = sheet.cells.get(cellKey(row, col));
  if (!c) return null;
  if (typeof c.value === "number") return c.value;
  const n = Number(String(c.value).trim());
  return Number.isFinite(n) ? n : null;
}

/** The first row in [0, maxRow] that has any cell. -1 when the sheet is empty. */
export function firstDataRow(sheet: Sheet): number {
  let best = -1;
  for (const c of sheet.cells.values()) if (best < 0 || c.row < best) best = c.row;
  return best;
}
