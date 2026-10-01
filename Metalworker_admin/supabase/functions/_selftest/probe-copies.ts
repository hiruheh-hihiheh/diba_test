import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const wb = await readXlsx(readFileSync(resolve(REPO, "BILL 301 TO.xlsx")));
const { bills } = parseBills(wb.sheets);
const t = bills.find((x) => x.sheetName.trim() === "301")!;
const runs = (b: Uint8Array) => [...new TextDecoder("latin1").decode(b).matchAll(/\(([^()]*)\)\s*Tj/g)].map((m) => m[1]);
const a = runs(renderBillDocument([t.original], "ORIGINAL"));
const b = runs(renderBillDocument([t.duplicate], "ORIGINAL"));
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) console.log(`L${i}  original=${JSON.stringify(a[i])}\n    duplicate=${JSON.stringify(b[i])}`);
}
console.log("--- referenceRows ---");
console.log("original :", t.original.referenceRows.map((r) => `${r.label}=${r.value}/${r.date}/${r.hasDateCell}`).join(" | "));
console.log("duplicate:", t.duplicate.referenceRows.map((r) => `${r.label}=${r.value}/${r.date}/${r.hasDateCell}`).join(" | "));
