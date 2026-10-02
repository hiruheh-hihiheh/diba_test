// Renders ONE bill's three documents so they can be opened and looked at
// individually — the same thing a bill row's View / Download / Print resolves to.
//
//   node supabase/functions/_selftest/render-one.ts <sheet-or-invoice> [copy]
//
// Defaults to invoice 301, original.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import {
  parseBills,
  safeBillToken,
  COPY_LABEL,
  COPY_ORDER,
  type CopyKind,
} from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const outDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

const needle = process.argv[2] ?? "FIX/301/2026-27";
const only = process.argv[3] as CopyKind | undefined;

const wb = await readXlsx(readFileSync(resolve(REPO, "BILL 301 TO.xlsx")));
const { bills } = parseBills(wb.sheets);
const bill = bills.find(
  (b) => b.original.invoiceNo === needle || b.sheetName === needle || b.original.invoiceNo?.includes(needle)
);
if (!bill) {
  console.error(`no bill matching "${needle}". Try one of:`);
  for (const b of bills) console.error(`  ${b.original.invoiceNo}  (sheet ${b.sheetName})`);
  process.exit(1);
}

const token = safeBillToken(bill.original.invoiceNo, bill.sheetName);
// A stand-in for the real upload/bill ids, so the shape of the stored name is
// what gets inspected.
const fakeUploadId = "00000000-0000-0000-0000-000000000000";
const fakeBillId = "11111111-1111-1111-1111-111111111111";

console.log(`bill: ${bill.original.invoiceNo}  (sheet ${bill.sheetName}, job ${bill.original.jobKind})`);
for (const copy of COPY_ORDER) {
  if (only && copy !== only) continue;
  /* All three documents are rendered from the ORIGINAL block, which is what
     `process-bill-upload` does. Rendering each copy from its own block would make
     this tool disagree with production, and sheet `320` of the production workbook is
     exactly the case where they differ: its ORIGINAL writes `Your Challan No.: abc`
     and its other two leave the row blank. */
  const bytes = renderBillDocument([bill.original], COPY_LABEL[copy]);
  const file = `${fakeBillId}_${token}_v1_${copy}.pdf`;
  writeFileSync(resolve(outDir, file), bytes);
  const pages = (new TextDecoder("latin1").decode(bytes).match(/stream\r?\n([\s\S]*?)\r?\nendstream/g) ?? []).length;
  console.log(`  ${file}  ${(bytes.length / 1024).toFixed(1)} KiB  ${pages} page(s)`);
  console.log(`    stored as: ${fakeUploadId}/${file}`);
}
