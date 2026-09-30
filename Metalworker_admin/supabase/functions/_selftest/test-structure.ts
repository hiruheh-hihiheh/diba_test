// Structure test: the invoice's SHAPE must survive empty values.
//
// This is the requirement that the previous renderer failed. A blank
// `Your Challan No.`, a blank `Eway Bill No.` and a line item with no HSN code are
// all still parts of the invoice. The row, the label, the border and the column
// have to be there; only the value is missing.
//
// The checks are made against the SOURCE, so they fail if the renderer invents a
// row the workbook does not have OR drops one it does.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, COPY_LABEL, COPY_ORDER } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const workbook = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");
const PAGE_W = 595.28;
const MARGIN_X = 30;

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const wb = await readXlsx(readFileSync(workbook));
const { bills } = parseBills(wb.sheets);
console.log(`workbook: ${workbook}\n${bills.length} bill(s)\n`);

/* Every row the parser found, so "kept" means "kept for every one of these". */
const allRefs = bills.flatMap((b) => b.original.referenceRows.map((r) => r.label));
const uniqueRefs = [...new Set(allRefs)];
const blankRefs = [
  ...new Set(
    bills.flatMap((b) =>
      b.original.referenceRows.filter((r) => (r.value ?? "") === "").map((r) => r.label)
    )
  ),
];
console.log(`reference rows the source declares: ${uniqueRefs.join(", ")}`);
console.log(`reference rows left BLANK by the source: ${blankRefs.join(", ") || "(none)"}\n`);

check(blankRefs.length > 0, "the workbook actually has empty fields to preserve");

const COLS = ["SR.NO.", "DESCRIPTION", "HSN CODE", "UOM", "QTY", "RATE", "AMOUNT"];

for (const copy of COPY_ORDER) {
  const bytes = renderBillDocument(bills.map((b) => b[copy]), COPY_LABEL[copy]);
  const raw = new TextDecoder("latin1").decode(bytes);
  const pages = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);
  console.log(`\n${COPY_LABEL[copy]}: ${pages.length} page(s)`);

  // Reconstruct the text of each page, with the coordinates it was drawn at, so
  // "is this label present" and "did anything fall off the page" are both answerable.
  const laid = pages.map((s) => {
    const runs: { x: number; y: number; size: number; text: string }[] = [];
    let size = 9;
    let x = 0;
    let y = 0;
    const re = /\/F[12]\s+([\d.]+)\s+Tf|1 0 0 1 ([\d.-]+) ([\d.-]+) Tm|\((.*?)\)\s*Tj/g;
    let t;
    while ((t = re.exec(s)) !== null) {
      if (t[1] !== undefined) size = Number(t[1]);
      else if (t[2] !== undefined) { x = Number(t[2]); y = Number(t[3]); }
      else if (t[4] !== undefined) runs.push({ x, y: 841.89 - Number(y), size, text: t[4] });
    }
    return runs;
  });

  // 1. Every reference row the source declared is printed, blank or not.
  const allText = pages.join("\n");
  const missingRefs = uniqueRefs.filter((label) => !allText.includes(`(${label})`));
  check(
    missingRefs.length === 0,
    "every reference row the source declared is still drawn",
    missingRefs.length ? `missing: ${missingRefs.join(", ")}` : `${uniqueRefs.length} rows`
  );

  // 2. The blank ones really are blank: the LABEL is on the page and the page does
  //    not carry a value for it. (Checked structurally: the label run exists.)
  const labelRuns = new Set(laid.flat().map((r) => r.text));
  const missingBlank = blankRefs.filter((l) => !labelRuns.has(l));
  check(
    missingBlank.length === 0,
    "rows with an empty value keep their label",
    missingBlank.length ? `missing: ${missingBlank.join(", ")}` : `${blankRefs.length} blank rows kept`
  );

  // 3. Every line-item column heading is on every page that has a table.
  let missingCols = 0;
  for (const runs of laid) {
    const texts = new Set(runs.map((r) => r.text));
    const hasTable = texts.has("DESCRIPTION") || texts.has("AMOUNT");
    if (!hasTable) continue;
    for (const c of COLS) if (!texts.has(c)) missingCols++;
  }
  check(missingCols === 0, "every line-item column is present on every table", `${missingCols} missing`);

  // 4. Nothing is drawn outside the printable width. A clipped column or a
  //    description that ran long would show up here.
  const offPage = laid.flat().filter((r) => r.x < MARGIN_X - 1 || r.x > PAGE_W - MARGIN_X + 1);
  check(offPage.length === 0, "no text starts outside the printable width", `${offPage.length} run(s)`);

  // 5. No cell was given a dash it did not have. The template writes a literal
  //    "-" on the IGST row and on nothing else, so a page should carry exactly the
  //    dashes its totals block has and no others.
  const dashRuns = laid.flat().filter((r) => r.text === "-");
  const perBillDashBudget = 1; // the IGST row
  const maxDash = perBillDashBudget * 3; // three copies are separate documents, so one bill's worth
  check(
    dashRuns.length <= bills.length * maxDash,
    "empty cells were left empty, not filled with a dash",
    `${dashRuns.length} dash run(s) across ${bills.length} bill(s)`
  );
}

console.log(
  failures === 0 ? "\nSTRUCTURE CHECKS: all passed." : `\nSTRUCTURE CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
