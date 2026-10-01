// Where exactly do render(parse) and render(stored record) disagree?
//
//   node supabase/functions/_selftest/diff-roundtrip.ts "BILL 301 TO.xlsx" "301"
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, COPY_LABEL, COPY_ORDER } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { billFromRecord, toBillRecord, type BillRecord } from "../process-bill-upload/_shared/billDocument.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const wb = await readXlsx(readFileSync(resolve(REPO, process.argv[2] ?? "BILL 301 TO.xlsx")));
const { bills } = parseBills(wb.sheets);
const want = process.argv[3];
const target = want ? bills.find((b) => b.sheetName.trim() === want.trim()) : bills[0];
if (!target) {
  console.error("no such sheet");
  process.exit(1);
}

const copyArg = (process.argv[4] ?? "original") as (typeof COPY_ORDER)[number];
const copy = COPY_ORDER.includes(copyArg) ? copyArg : "original";

const a = renderBillDocument([target[copy]], COPY_LABEL[copy]);
const b = renderBillDocument(
  [
    billFromRecord(
      toBillRecord(target, "00000000-0000-0000-0000-000000000001") as unknown as BillRecord,
      target[copy].lineItems,
      COPY_LABEL[copy]
    ),
  ],
  COPY_LABEL[copy]
);

const la = new TextDecoder("latin1").decode(a);
const lb = new TextDecoder("latin1").decode(b);

/** The drawn strings, in order, so the difference is readable rather than a byte offset. */
const runs = (s: string): string[] =>
  [...s.matchAll(/\(([^()]*)\)\s*Tj/g)].map((m) => m[1]);

const ra = runs(la);
const rb = runs(lb);
console.log(`sheet ${target.sheetName} ${copy}: ${a.length} B vs ${b.length} B, ${ra.length} vs ${rb.length} runs\n`);

const onlyA = ra.filter((x) => !rb.includes(x));
const onlyB = rb.filter((x) => !ra.includes(x));
if (onlyA.length === 0 && onlyB.length === 0) {
  let firstDiff = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff < 0) {
    console.log("BYTE IDENTICAL");
  } else {
    const around = (buf: Uint8Array): string =>
      new TextDecoder("latin1")
        .decode(buf.slice(Math.max(0, firstDiff - 90), firstDiff + 90))
        .replace(/[^\x20-\x7e\n]/g, ".");
    console.log(`same strings; first byte difference at ${firstDiff}`);
    console.log(`  parse : ...${around(a)}...`);
    console.log(`  record: ...${around(b)}...`);
  }
}

console.log("only in render(parse):");
onlyA.forEach((s) => console.log(`  - ${JSON.stringify(s)}`));
console.log("only in render(record):");
onlyB.forEach((s) => console.log(`  + ${JSON.stringify(s)}`));

console.log("\nfield comparison:");
const rec = toBillRecord(target, "u") as Record<string, unknown>;
const o = target.original;
const pairs: [string, unknown, unknown][] = [
  ["party_name", o.partyName, rec.party_name],
  ["party_address", o.partyAddress.join("|"), rec.party_address],
  ["bank_details", JSON.stringify(o.bankLines), JSON.stringify(rec.bank_details)],
  ["terms", JSON.stringify(o.termsLines), rec.terms],
  ["seller_descriptor", o.sellerDescriptor, rec.seller_descriptor],
  ["seller_tax_line", o.sellerTaxLine, rec.seller_tax_line],
  ["seller_address", o.sellerAddress, rec.seller_address],
  ["seller_contact", o.sellerContact, rec.seller_contact],
  ["certification", o.certification, rec.certification],
  ["on_behalf_of", o.onBehalfOf, rec.on_behalf_of],
  ["signature_designation", o.signatureDesignation, rec.signature_designation],
  ["receiver_signature", o.receiverSignature, rec.receiver_signature],
  ["cgstRate", o.cgstRate, rec.cgst_rate],
  ["eway_bill_date", o.ewayBillDate, rec.eway_bill_date],
];
for (const [k, x, y] of pairs) {
  const same = JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  if (!same) console.log(`  DIFF ${k}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
}
console.log("(only differences shown)");
