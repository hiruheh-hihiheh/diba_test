// supabase/functions/_selftest/write-xlsx.ts
//
// A MINIMAL .xlsx WRITER, for the copy-flexibility tests.
//
// WHY IT EXISTS
// The flexibility this suite proves is about what the WORKBOOK contains, and the
// workbooks under test have to differ in exactly one respect: which copy blocks
// they carry. Producing those by hand in Excel would mean the fixture is not
// reproducible, and copying a real three-copy sheet and deleting two copy blocks
// is how a real workbook gets built anyway.
//
// The writer is deliberately not a general-purpose Excel library. It emits the
// smallest valid workbook that `readXlsx` accepts: inline strings, no shared
// string table, no styles, no merges, no formulas. That is enough because the
// parser is driven entirely by cell TEXT, which is the point.
//
// NOT PRODUCTION CODE. Nothing in `supabase/functions/*/index.ts` imports this,
// and the app never writes a workbook back — the uploaded .xlsx is stored
// untouched, so synthesis can never modify a customer's source file.

import type { Sheet, SheetCell } from "../process-bill-upload/_shared/xlsx.ts";

/** "A1" -> { row: 0, col: 0 }. Zero-based, as the parser indexes. */
function cellRef(row: number, col: number): string {
  let letters = "";
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row + 1}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Control characters are illegal in XML 1.0 and would make the file unopenable.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function sheetXml(sheet: Sheet): string {
  const rows = new Map<number, SheetCell[]>();
  for (const cell of sheet.cells.values()) {
    const list = rows.get(cell.row);
    if (list) list.push(cell);
    else rows.set(cell.row, [cell]);
  }

  const body = [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, cells]) => {
      const inner = cells
        .sort((a, b) => a.col - b.col)
        .map((cell) => {
          const ref = cellRef(cell.row, cell.col);
          if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
            return `<c r="${ref}"><v>${cell.value}</v></c>`;
          }
          /* `xml:space="preserve"` matters: the template's footer and address cells
             carry trailing spaces that are part of the printed invoice. */
          const text = xmlEscape(String(cell.value));
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
        })
        .join("");
      return `<row r="${row + 1}">${inner}</row>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

/* ── A minimal ZIP writer ──────────────────────────────────────────────
   STORED, not deflated, for the container. Only ~20 members at a few KB each,
   and this keeps the writer to a few lines with no compressor bookkeeping —
   correctness of the fixture matters, size does not. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files: { path: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.path, "utf8");
    const crc = crc32(f.data);
    const sizes = f.data.length;
    const flags = 0x0800; // UTF-8 filename

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(sizes, 18);
    local.writeUInt32LE(sizes, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, f.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014B50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(sizes, 20);
    cd.writeUInt32LE(sizes, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + sizes;
  }

  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, cdBuf, end]);
}

/** Build a workbook .xlsx from in-memory sheets and return its bytes. */
export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const sheetEntries = sheets.map((s, i) => ({ s, i }));

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheetEntries
      .map(
        ({ i }) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("") +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    sheetEntries
      .map(
        ({ s, i }) =>
          `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join("") +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetEntries
      .map(
        ({ i }) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join("") +
    `</Relationships>`;

  const files = [
    { path: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { path: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { path: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { path: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    ...sheetEntries.map(({ s, i }) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(sheetXml(s), "utf8"),
    })),
  ];

  return new Uint8Array(zip(files));
}