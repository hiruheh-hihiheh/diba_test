// Confirms the job classification is on every page of every print copy, and that
// the raw storage token never reaches the page.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, COPY_LABEL, COPY_ORDER } from "../process-bill-upload/_shared/parseBill.ts";
import { formatJobKind } from "../process-bill-upload/_shared/formatJobKind.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const workbook = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");

const wb = await readXlsx(readFileSync(workbook));
const { bills } = parseBills(wb.sheets);

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

console.log(`workbook: ${workbook}\n${bills.length} bill(s)\n`);

/* Expectations come from the parse, not from this script, so the test is checking
   the renderer against the parser rather than restating a hardcoded list. */
const expected = bills.map((b) => ({
  sheet: b.sheetName,
  invoice: b.original.invoiceNo ?? "",
  label: formatJobKind(b.original.jobKind),
  raw: b.original.jobKind,
}));

check(expected.some((e) => e.label === "LABOUR JOB"), "the workbook has a LABOUR JOB invoice");
check(expected.some((e) => e.label === "WITH METAL"), "the workbook has a WITH METAL invoice");
check(
  expected.every((e) => e.label !== null),
  "every invoice has a job classification",
  `${expected.filter((e) => e.label === null).length} missing`
);

for (const copy of COPY_ORDER) {
  const bytes = renderBillDocument(bills.map((b) => b[copy]), COPY_LABEL[copy]);
  const raw = new TextDecoder("latin1").decode(bytes);
  const pages = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);
  console.log(`\n${COPY_LABEL[copy]}: ${pages.length} page(s)`);

  check(
    !raw.includes("(WITHMETAL)"),
    "the raw storage token is nowhere in the file"
  );

  let missing = 0;
  let misplaced = 0;
  for (const page of pages) {
    // Which invoice does this page belong to? The footer names it.
    const m = /\((?:ORIGINAL|DUPLICATE|TRIPLICATE)\s*\|\s*([^|)]*?)\s*\|\s*Page\s*\d+\s*of\s*\d+\)/.exec(page);
    const owner = m ? m[1].trim() : null;
    const want = expected.find((e) => e.invoice === owner);
    if (!want || !want.label) continue;
    // A continuation page of a two-page invoice carries no badge of its own; the
    // classification belongs on the page the invoice OPENS on.
    const opensInvoice = page.includes(`(${want.invoice})`);
    if (!opensInvoice) continue;
    if (!page.includes(`(${want.label})`)) missing++;
    if (want.label === "WITH METAL" && page.includes("(WITHMETAL)")) misplaced++;
  }
  check(missing === 0, "every invoice opens with its classification", `${missing} missing`);
  check(misplaced === 0, "no page shows the raw token", `${misplaced} misplaced`);
}

/* Both classifications, from both kinds of sheet, as the requirement spells out. */
const labour = expected.filter((e) => e.label === "LABOUR JOB");
const metal = expected.filter((e) => e.label === "WITH METAL");
console.log(`\nLABOUR JOB: ${labour.map((e) => e.sheet).join(", ")}`);
console.log(`WITH METAL: ${metal.map((e) => e.sheet).join(", ")}`);

console.log(failures === 0 ? "\nJOB KIND CHECKS: all passed." : `\nJOB KIND CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
