// Dump one worksheet cell-by-cell so the invoice's real structure can be read
// directly, instead of inferred from the parser.
//
//   node supabase/functions/_selftest/dump-sheet.ts "BILL 301 TO.xlsx" "316 L" [blockStart] [blockEnd]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx, textAt, cellAt } from "../process-bill-upload/_shared/xlsx.ts";
import { findCopyBlocks } from "../process-bill-upload/_shared/parseBill.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(here, "../../../..");
const file = resolve(REPO, process.argv[2] ?? "BILL 301 TO.xlsx");
const want = process.argv[3] ?? "316 L";

const wb = await readXlsx(readFileSync(file));
const sheet = wb.sheets.find((s) => s.name.trim() === want.trim());
if (!sheet) {
  console.error(`no sheet named "${want}". have: ${wb.sheets.map((s) => s.name).join(" | ")}`);
  process.exit(1);
}

const blocks = findCopyBlocks(sheet);
const from = Number(process.argv[4] ?? blocks[0]?.start ?? 0);
const to = Number(process.argv[5] ?? blocks[0]?.end ?? sheet.maxRow);

console.log(`sheet "${sheet.name}"  ${sheet.maxRow}x${sheet.maxCol}`);
console.log(`copy blocks: ${blocks.map((b) => `${b.label}@${b.start}-${b.end}`).join(", ")}`);
console.log(`--- rows ${from}..${to} (0-based), ORIGINAL block ---\n`);

for (let r = from; r <= to; r++) {
  const cells: string[] = [];
  for (let c = 0; c <= sheet.maxCol; c++) {
    const t = textAt(sheet, r, c);
    if (!t) continue;
    const cell = cellAt(sheet, r, c);
    const merge = cell?.merge;
    const span = merge && merge.c2 > c ? `..${String.fromCharCode(65 + merge.c2)}` : "";
    cells.push(`${String.fromCharCode(65 + c)}${span}=${JSON.stringify(t)}`);
  }
  if (cells.length === 0) {
    console.log(`r${String(r + 1).padStart(2)} |`);
    continue;
  }
  console.log(`r${String(r + 1).padStart(2)} | ${cells.join("  ")}`);
}
