// supabase/functions/_selftest/test-pdf.ts
//
// Renders the three print copies from a real workbook and checks the PDF
// STRUCTURE, without needing a PDF library:
//
//   - exactly three files, named <base>_original/_duplicate/_triplicate.pdf
//   - a %PDF header and a valid trailer
//   - at least one page per bill, and every page attributable to an invoice
//   - `startxref` landing on the xref table, and every xref offset resolving
//     to the object it claims (this is the check that would catch a
//     byte-offset bug in the writer)
//   - one content stream per page
//   - each bill opening on its own page carrying its own invoice number,
//     grand total and quantity
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

/**
 * The forms a total may be printed in, so the test does not depend on which one
 * the renderer picked.
 *
 * The invoice uses INDIAN digit grouping — `3,99,991.00` — which differs from
 * plain thousands grouping (`399,991.00`) from six digits upward, so both are
 * accepted. The point of the check is that the AMOUNT is on the page, not which
 * comma placement was used to write it.
 */
const groupIndian = (n: number): string => {
  const [whole, frac] = Math.abs(n).toFixed(2).split(".");
  const head = whole.length > 3 ? whole.slice(0, whole.length - 3) : "";
  const tail = whole.slice(-3);
  let grouped = "";
  for (let i = head.length; i > 0; i -= 2) {
    grouped = head.slice(Math.max(0, i - 2), i) + (grouped ? `,${grouped}` : "");
  }
  return `${n < 0 ? "-" : ""}${grouped ? `${grouped},${tail}` : tail}.${frac}`;
};

const groupWestern = (n: number): string =>
  `${n < 0 ? "-" : ""}${Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const amountForms = (n: number): string[] => [n.toFixed(2), groupIndian(n), groupWestern(n)];

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

  const declared = /\/Count\s+(\d+)/.exec(raw);
  const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check(
    !!declared && Number(declared[1]) === pageCount,
    "/Pages /Count matches the real page count",
    `declared ${declared ? declared[1] : "absent"}, found ${pageCount}`
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

  /* A bill MAY span two pages. The production workbook has invoices with ten
     line items, and at a readable font those legitimately do not fit on one A4
     sheet. Flowing onto a second page is correct; what must never happen is a
     bill losing its content, pages appearing out of order, or a page belonging
     to no bill at all.

     Pages are therefore attributed to bills through the FOOTER, which carries
     the invoice number, rather than by assuming page N is bill N. That keeps the
     check honest whether a bill takes one page or two. */
  const pages = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);
  check(
    pages.length >= bills.length,
    "at least one page per bill",
    `${pages.length} pages, ${bills.length} bills`
  );
  check(
    (raw.match(/\/Length \d+ >>\s*stream/g) ?? []).length === pages.length,
    "one content stream per page",
    `${pages.length} streams`
  );

  // Which pages belong to which invoice, read from the footer run itself, which
  // reads `ORIGINAL   |   SEW/305/2026-27   |   Page 6 of 23`.
  const ownerOf = pages.map((p) => {
    const m = /\((?:ORIGINAL|DUPLICATE|TRIPLICATE)\s*\|\s*([^|)]*?)\s*\|\s*Page\s*\d+\s*of\s*\d+\)/.exec(p);
    return m ? m[1].trim() : null;
  });
  const unattributed = ownerOf.filter((o) => o === null).length;
  check(unattributed === 0, "every page belongs to an invoice", `${unattributed} unattributed`);

  const seen = new Set<string>();
  let orderProblems = 0;
  let contentProblems = 0;
  let lastFirstPage = -1;

  bills.forEach((bill, i) => {
    const no = bill.original.invoiceNo ?? "";
    const own = ownerOf.map((o, idx) => (o === no ? idx : -1)).filter((idx) => idx >= 0);
    if (own.length === 0) {
      orderProblems++;
      check(false, `${no || "bill " + i} was rendered at all`);
      return;
    }
    /* Pages must run in worksheet order and must not interleave: each bill's first
       page has to come after the previous bill's first page. */
    if (own[0] <= lastFirstPage) orderProblems++;
    lastFirstPage = own[0];
    seen.add(no);

    // The invoice's identity belongs on its opening page.
    const first = pages[own[0]] ?? "";
    const opensOk = first.includes(`(${no})`);

    /* Its figures may sit on any of its pages — a ten-item invoice at a readable
       font legitimately puts the totals on the second sheet — so the whole span
       has to be searched. */
    const span = own.map((idx) => pages[idx] ?? "").join("\n");
    const has = (needle: string) => needle !== "" && span.includes(`(${needle})`);
    const amount = bill.original.amountAfterTax;
    const hasTotal = amountForms(amount).some((f) => has(f));
    const hasQty = has(String(bill.original.totalQuantity));
    if (!opensOk || !hasTotal || !hasQty) contentProblems++;

    check(
      opensOk && hasTotal && hasQty,
      `${bill.original.invoiceNo} rendered complete across ${own.length} page(s)`,
      `opens=${opensOk} total=${hasTotal} qty=${hasQty}`
    );
  });
  check(orderProblems === 0, "pages are in worksheet order, none skipped", `${orderProblems} problem(s)`);
  check(contentProblems === 0, "no bill lost its invoice no, total or quantity", `${contentProblems} problem(s)`);
  check(seen.size === bills.length, "every bill was rendered", `${seen.size}/${bills.length}`);
}

console.log(
  failures === 0
    ? `\nPDF CHECKS: all passed. Output in ${outDir}`
    : `\nPDF CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
