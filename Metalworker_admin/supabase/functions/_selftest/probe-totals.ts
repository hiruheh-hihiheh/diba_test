// Check how the workbook's own totals relate to its lines and tax cells, so the
// editor's recalculation rules match the source instead of replacing them.
//
//   node supabase/functions/_selftest/probe-totals.ts "BILL 301 TO.xlsx"
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx, textAt } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills } from "../process-bill-upload/_shared/parseBill.ts";
import { findCopyBlocks, squash } from "../process-bill-upload/_shared/parseBill.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(here, "../../../..");
const wb = await readXlsx(readFileSync(resolve(REPO, process.argv[2] ?? "BILL 301 TO.xlsx")));

const r2 = (n: number | null | undefined) => (n === null || n === undefined ? "    —  " : n.toFixed(2).padStart(7));
const rate = (t: number | null, b: number | null) =>
  t === null || b === null || b === 0 ? "   —   " : ((t / b) * 100).toFixed(4).padStart(8);

console.log(
  "sheet      kind        before      cgst  cgst%      sgst  sgst%      igst  igst%      gst    after  round   words-match  sum(qty*rate)  lineAmt-sum"
);

const { bills } = parseBills(wb.sheets);
for (const b of bills) {
  const o = b.original;
  const sheet = wb.sheets.find((s) => s.name === b.sheetName)!;
  // Read the raw rate cells the renderer currently ignores.
  const block = findCopyBlocks(sheet)[0];
  let cgstCell: string | null = null;
  let sgstCell: string | null = null;
  let igstCell: string | null = null;
  for (let r = block.start; r <= block.end; r++) {
    for (let c = 0; c <= sheet.maxCol; c++) {
      const t = textAt(sheet, r, c);
      if (!t) continue;
      const k = squash(t);
      if (k === "ADDCGST" || k === "ADDCGSTS" || k === "CGST") cgstCell = textAt(sheet, r, c + 1) || null;
      if (k === "ADDSGST" || k === "SGST") sgstCell = textAt(sheet, r, c + 1) || null;
      if (k === "ADDIGST" || k === "IGST") igstCell = textAt(sheet, r, c + 1) || null;
    }
  }
  const sumQR = o.lineItems.reduce(
    (s, it) => s + (it.quantity !== null && it.rate !== null ? it.quantity * it.rate : (it.amount ?? 0)),
    0
  );
  const sumLine = o.lineItems.reduce((s, it) => s + (it.amount ?? 0), 0);
  const computed = (o.amountBeforeTax ?? 0) + (o.totalGst ?? 0);
  const wordsNum = wordsToNumber(o.amountInWords ?? "");
  const afterWithRound = (o.amountAfterTax ?? 0);
  const wordsOk = wordsNum === null ? "?" : Math.abs(wordsNum - afterWithRound) < 0.5 ? "YES" : `NO(${wordsNum})`;

  console.log(
    [
      b.sheetName.padEnd(10).slice(0, 10),
      (o.jobKind ?? "?").padEnd(11).slice(0, 11),
      r2(o.amountBeforeTax),
      r2(o.cgst), rate(o.cgst, o.amountBeforeTax),
      r2(o.sgst), rate(o.sgst, o.amountBeforeTax),
      r2(o.igst), rate(o.igst, o.amountBeforeTax),
      r2(o.totalGst),
      r2(o.amountAfterTax),
      r2(o.roundOff),
      wordsOk.padEnd(11),
      String(cgstCell ?? "—").padStart(4),
      String(sgstCell ?? "—").padStart(4),
      String(igstCell ?? "—").padStart(4),
      " before+gst=" + r2(computed),
      " ==after? " + (Math.abs(computed - afterWithRound) < 0.005 ? "yes" : "NO"),
      " sumQR=" + sumQR.toFixed(2),
      " lineSum=" + sumLine.toFixed(2),
    ].join(" ")
  );
}

/** Best-effort Indian number words -> digits, for checking the words line. */
function wordsToNumber(w: string): number | null {
  const one: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  };
  const tens: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const mult: Record<string, number> = { thousand: 1e3, lakh: 1e5, crore: 1e7 };
  const t = w.toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  let total = 0, cur = 0;
  for (const w2 of t.split(" ")) {
    if (w2 in one) cur += one[w2];
    else if (w2 in tens) cur += tens[w2];
    else if (w2 in mult) { const m = mult[w2]; total += (cur || 1) * m; cur = 0; }
    else if (w2 === "HUNDRED") cur = (cur || 1) * 100;
  }
  total += cur;
  return total || null;
}
