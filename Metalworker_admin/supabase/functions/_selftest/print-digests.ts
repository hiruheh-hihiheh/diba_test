// Print the full sha256 of each copy's no-logo render, for re-pinning the digests in
// test-logo.ts. Verification only.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import {
  parseBills,
  COPY_LABEL,
  COPY_ORDER,
} from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const wb = await readXlsx(readFileSync(resolve(REPO, "BILL 301 TO.xlsx")));
const { bills } = parseBills(wb.sheets);
const found = bills.find((b) => b.original.sellerAddress && b.original.sellerContact) ?? bills[0];

for (const copy of COPY_ORDER) {
  const bytes = renderBillDocument([found[copy]], COPY_LABEL[copy]);
  const digest = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  console.log(`  ${copy}: "${digest}",   // ${COPY_LABEL[copy]}  ${bytes.length}B`);
}