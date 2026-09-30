// Structure probe: what does a real production workbook actually contain?
// READ-ONLY. Prints sheet names, then for a few sheets every label-shaped cell
// with whatever sits to its right — including the "nothing to the right" case,
// which is exactly the empty-field situation the renderer used to drop.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx, textAt } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills } from "../process-bill-upload/_shared/parseBill.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const file = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");
const wb = await readXlsx(readFileSync(file));

console.log(`workbook: ${file}`);
console.log(`sheets (${wb.sheets.length}): ${wb.sheets.map((s) => JSON.stringify(s.name)).join(", ")}`);

const squash = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Any cell that reads like a field label: short, mostly letters, ends in a
// colon-ish or is a known metadata word.
function isLabelish(text) {
  const t = String(text).trim();
  if (t.length === 0 || t.length > 40) return false;
  if (/^[\d.,\/-]+$/.test(t)) return false; // pure number
  const words = t.split(/[\s:.\-]+/).filter(Boolean);
  if (words.length === 0) return false;
  return /[A-Za-z]{3}/.test(t);
}

const wanted = process.argv[3] ? process.argv[3].split(",") : null;

for (const sheet of wb.sheets) {
  if (wanted && !wanted.includes(sheet.name)) continue;

  console.log(`\n================ ${JSON.stringify(sheet.name)}  (maxRow=${sheet.maxRow} maxCol=${sheet.maxCol}) ================`);
  for (let r = 0; r <= sheet.maxRow; r++) {
    const marks = [];
    for (let c = 0; c <= sheet.maxCol; c++) {
      const t = String(textAt(sheet, r, c) ?? "").trim();
      if (t === "") continue;
      marks.push(`${c}:${t.length > 30 ? t.slice(0, 30) + "…" : t}`);
    }
    if (marks.length === 0) continue;
    // Only print rows that contain something label-like, plus the row right
    // after it (dates/values), so empties are visible in context.
    const joined = marks.join(" ");
    if (/invoice|challan|order|eway|date|qty|rate|amount|hsn|uom|sr|description|total|gst|round|reverse|vehicle|transporter|supply|state|job|labour|with|metal|place|billed|recipient/i.test(joined)) {
      console.log(`  r${String(r + 1).padStart(3)}  ${joined.slice(0, 150)}`);
    }
  }
}

// Also report what the parser made of every sheet — especially jobKind and which
// optional fields came back empty, since that is what the renderer must still draw.
const { bills, skipped } = parseBills(wb.sheets);
console.log(`\n\n########## PARSE SUMMARY ##########  bills=${bills.length} skipped=${JSON.stringify(skipped)}`);
for (const b of bills) {
  const o = b.original;
  const empties = [];
  if (!o.invoiceNo) empties.push("invoiceNo");
  if (!o.ourChallanNo) empties.push("ourChallanNo");
  if (!o.ourChallanDate) empties.push("ourChallanDate");
  if (!o.yourChallanNo) empties.push("yourChallanNo");
  if (!o.yourChallanDate) empties.push("yourChallanDate");
  if (!o.orderNo) empties.push("orderNo");
  if (!o.orderDate) empties.push("orderDate");
  if (!o.ewayBillNo) empties.push("ewayBillNo");
  if (o.reverseCharge === null || o.reverseCharge === undefined) empties.push("reverseCharge");
  const lineCells = o.lineItems.map((li) => [li.srNo, li.hsnCode, li.uom, li.quantity, li.rate, li.amount].map((v) => (v === null || v === undefined || v === "" ? "_" : v)).join("/"));
  console.log(
    `  ${JSON.stringify(b.sheetName).padEnd(10)} jobKind=${JSON.stringify(o.jobKind)} ` +
    `items=${o.lineItems.length} emptyFields=[${empties.join(",") || "none"}]`
  );
  if (lineCells.some((c) => c.includes("_"))) console.log(`      rows with empty cells: ${lineCells.filter((c) => c.includes("_")).join("  ")}`);
  const longest = o.lineItems.map((li) => (li.description ?? "").length).sort((a, b) => b - a)[0] ?? 0;
  if (longest > 70) console.log(`      longest description = ${longest} chars`);
}
