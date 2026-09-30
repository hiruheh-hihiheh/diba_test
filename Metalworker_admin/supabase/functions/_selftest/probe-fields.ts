// Focused probe: the two questions the renderer must answer correctly.
//  1. Does a long description in the source span several Excel rows, and does the
//     parser merge them into ONE line item (requirement 6)?
//  2. Which metadata label rows exist in the source, and which have empty values
//     (requirements 3 and 4)?
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx, textAt } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, squash } from "../process-bill-upload/_shared/parseBill.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const file = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");
const wb = await readXlsx(readFileSync(file));
const { bills } = parseBills(wb.sheets);

/* ---- 1. continuation rows ------------------------------------------------- */
console.log("########## CONTINUATION ROWS ##########");
const sheetOf = new Map(wb.sheets.map((s) => [s.name, s]));
for (const b of bills) {
  const sheet = sheetOf.get(b.sheetName);
  if (!sheet) continue;
  // count populated rows between the table header and the "Total Quantity" row
  let headerRow = -1;
  let totalRow = -1;
  for (let r = 0; r <= sheet.maxRow && r < b.original.firstRow + 60; r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      const t = String(textAt(sheet, r, c) ?? "").trim();
      if (squash(t) === "SRNO" && headerRow < 0) headerRow = r;
      if (squash(t) === "TOTALQUANTITY" && totalRow < 0 && headerRow >= 0) totalRow = r;
    }
    if (totalRow >= 0) break;
  }
  if (headerRow < 0) continue;
  const bodyRows = [];
  for (let r = headerRow + 1; r < (totalRow < 0 ? sheet.maxRow : totalRow); r++) {
    const populated = [];
    for (let c = 0; c <= sheet.maxCol; c++) {
      const t = String(textAt(sheet, r, c) ?? "").trim();
      if (t !== "") populated.push(`c${c}=${t.length > 26 ? t.slice(0, 26) + "…" : t}`);
    }
    if (populated.length) bodyRows.push({ r: r + 1, populated });
  }
  const noSr = bodyRows.filter((x) => !x.populated.some((p) => /^c1=\d+$/.test(p)));
  if (noSr.length > 0 || b.original.lineItems.some((li) => (li.description ?? "").length > 80)) {
    console.log(`\n${JSON.stringify(b.sheetName)}: ${b.original.lineItems.length} item(s) from ${bodyRows.length} populated row(s); ${noSr.length} row(s) with no SR`);
    for (const x of noSr.slice(0, 4)) console.log(`   continuation r${x.r}: ${x.populated.join(" | ")}`);
    for (const li of b.original.lineItems) {
      if ((li.description ?? "").length > 80) console.log(`   merged description (${li.description.length} chars): ${li.description.slice(0, 150)}`);
    }
  }
}

/* ---- 2. metadata label rows and whether they carry a value ---------------- */
console.log("\n\n########## METADATA LABEL ROWS (ORIGINAL copy only) ##########");
const META = [
  ["INVOICENO", "Invoice No."],
  ["OURCHALLANNO", "Our Challan No."],
  ["YOURCHALLANNO", "Your Challan No."],
  ["SERVICEORDENO", "Service Order No."],
  ["PURCHASEORDENO", "Purchase Order No."],
  ["EWAYBILLNO", "Eway Bill No."],
  ["DATE", "Date"],
];
for (const b of bills.slice(0, 4)) {
  const sheet = sheetOf.get(b.sheetName)!;
  console.log(`\n--- ${JSON.stringify(b.sheetName)} (jobKind=${JSON.stringify(b.original.jobKind)})`);
  for (let r = b.original.firstRow; r < b.original.firstRow + 20; r++) {
    for (let c = 2; c <= sheet.maxCol; c++) {
      const t = String(textAt(sheet, r, c) ?? "").trim();
      const sq = squash(t);
      const hit = META.find(([k]) => k === sq);
      if (!hit) continue;
      // gather the whole row to see if any cell to the right holds a value
      const rowVals = [];
      for (let d = c + 1; d <= sheet.maxCol; d++) {
        const v = String(textAt(sheet, r, d) ?? "").trim();
        rowVals.push(v === "" ? "_" : v);
      }
      const anyValue = rowVals.some((v) => v !== "_");
      console.log(
        `   r${String(r + 1).padStart(3)} c${c} ${hit[1].padEnd(20)} ${anyValue ? "HAS VALUE " : "EMPTY     "} [${rowVals.join(" | ")}]`
      );
    }
  }
}
