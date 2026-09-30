// supabase/functions/_selftest/test-pdf.ts
//
// Renders the three print copies from a real workbook and checks the PDF
// STRUCTURE, without needing a PDF library:
//
//   - exactly three files, named <base>_original/_duplicate/_triplicate.pdf
//   - a %PDF header and a valid trailer
//   - one page per bill, and /Pages /Count agreeing with that
//   - `startxref` landing on the xref table, and every xref offset resolving
//     to the object it claims (this is the check that would catch a
//     byte-offset bug in the writer)
//   - one content stream per page
//   - every page carrying its own invoice number, total and quantity
//
// `audit.ts` is the companion layout auditor: this file proves the file is
// well-formed, audit.ts proves the page looks like an invoice.
//
//   node supabase/functions/_selftest/test-pdf.ts [path/to/workbook.xlsx]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import {
  parseBills,
  sanitizeBaseName,
  COPY_LABEL,
  COPY_ORDER,
} from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const outDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

const workbook = process.argv[2] ?? resolve(REPO, "SAMPLE.xlsx");
const wb = await readXlsx(readFileSync(workbook));
const { bills } = parseBills(wb.sheets);
const base = sanitizeBaseName(basename(workbook));

let failures = 0;
const check = (ok: boolean, label: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

/** `1234567.5` -> `"1,234,567.50"`, only to predict what the renderer prints. */
const groupThousands = (n: number): string =>
  Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    .replace(/^/, n < 0 ? "-" : "");

console.log(
  `workbook: ${workbook}\n${bills.length} bill(s) from ${wb.sheets.map((s) => s.name).join(", ")}\n`
);

/* One PDF per copy, named after the workbook. Six PDFs would mean the copies
   were concatenated instead of rendered as three documents. */
check(bills.length > 0, "at least one bill was parsed");

for (const copy of COPY_ORDER) {
  const filename = `${base}_${copy}.pdf`;
  /* One DOCUMENT per copy, holding one page per invoice in worksheet order.
     The three copies are picked off the same parse, so a page can never mix
     figures from two invoices. */
  const copies = bills.map((b) => b[copy]);
  const bytes: Uint8Array = renderBillDocument(copies, COPY_LABEL[copy]);
  writeFileSync(resolve(outDir, filename), bytes);

  const raw = new TextDecoder("latin1").decode(bytes);
  const size = `${(bytes.length / 1024).toFixed(1)} KiB`;

  console.log(`\n${filename}  ${size}`);

  check(bytes.length > 2000, "file is not trivially small", `${bytes.length} bytes`);
  check(raw.startsWith("%PDF-1.4"), "valid PDF header", JSON.stringify(raw.slice(0, 8)));
  check(raw.trimEnd().endsWith("%%EOF"), "valid PDF trailer");

  const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check(pageCount === bills.length, "one page per bill", `${pageCount} pages, ${bills.length} bills`);

  const declared = /\/Count\s+(\d+)/.exec(raw);
  check(
    !!declared && Number(declared[1]) === bills.length,
    "/Pages /Count matches",
    declared ? declared[1] : "absent"
  );

  // `startxref` must point at the xref table itself, not at a stale offset.
  const startxref = /startxref\s+(\d+)/.exec(raw);
  let xrefOk = false;
  if (startxref) {
    const at = Number(startxref[1]);
    xrefOk = raw.slice(at, at + 4) === "xref";
  }
  check(xrefOk, "startxref lands on the xref table");

  /* Every xref entry must point at its OWN object header. Object N must be
     reachable at the offset listed on xref line N+1, and the free entry
     (offset 0, generation 65535) is not a real object. Reading the table from
     `startxref` rather than by regex is deliberate: this is the check that
     would catch a byte-offset bug in the writer, so it must use the same
     lookup a PDF reader does. */
  let xrefEntries = 0;
  let badOffsets = 0;
  if (startxref) {
    const table = raw.slice(Number(startxref[1]));
    const firstThree = table.split(/\r?\n/).slice(0, 3).join("\n");
    const count = Number(/xref\s+0\s+(\d+)/.exec(firstThree)?.[1] ?? 0);
    const linesOfTable = table.split(/\r?\n/);
    for (let obj = 1; obj < count; obj++) {
      const entry = linesOfTable[2 + obj] ?? "";
      const off = Number(entry.slice(0, 10));
      const gen = Number(entry.slice(11, 16));
      xrefEntries++;
      const at = raw.slice(off, off + 32);
      if (!new RegExp(`^${obj} ${gen} obj`).test(at)) {
        badOffsets++;
        if (badOffsets <= 3) {
          check(false, `xref entry for object ${obj}`, `offset ${off} -> ${JSON.stringify(at.slice(0, 20))}`);
        }
      }
    }
  }
  check(
    xrefEntries > 0 && badOffsets === 0,
    "all xref offsets resolve",
    `${xrefEntries} objects checked`
  );

  const streams = (raw.match(/\/Length \d+ >>\s*stream/g) ?? []).length;
  check(streams === bills.length, "one content stream per page", `${streams} streams`);

  // Each page must carry its own invoice no, total and quantity, so an
  // overflowing or mis-ordered page can never pass silently. Content streams
  // are uncompressed here, so a plain substring test on the per-page slice is
  // enough — no PDF parser needed.
  const pages = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);

  bills.forEach((bill, i) => {
    const page = pages[i] ?? "";
    const has = (needle: string) => page.includes(`(${needle})`);
    const no = has(bill.original.invoiceNo ?? "");
    // The invoice prints grouped thousands ("15,635.00"), so both the grouped
    // and the bare form are accepted: which one appears is a formatting choice,
    // the amount itself is what is being asserted.
    const amount = bill.original.amountAfterTax;
    const total = has(amount.toFixed(2)) || has(groupThousands(amount));
    const qty = has(String(bill.original.totalQuantity));
    check(
      no && total && qty,
      `page ${i + 1} carries ${bill.original.invoiceNo}`,
      `no=${no} total=${total} qty=${qty}`
    );
  });
}

console.log(
  failures === 0
    ? `\nPDF CHECKS: all passed. Output in ${outDir}`
    : `\nPDF CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
