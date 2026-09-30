// supabase/functions/_selftest/test-parse.ts
//
// Parses a real workbook and prints every field the parser derived, so the
// output can be diffed against the expected invoice figures by eye or by
// script. Nothing here is imported by the edge function.
//
//   node supabase/functions/_selftest/test-parse.ts [path/to/workbook.xlsx]
//
// Requires Node 22.6+ (type stripping) or Node 23+; developed on Node 25.2.1.
// The warning about a typeless module on stderr is harmless.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, sanitizeBaseName } from "../process-bill-upload/_shared/parseBill.ts";

/* The repo root is two levels above this file: <repo>/Metalworker_admin/supabase/functions/_selftest */
const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const workbook = process.argv[2] ?? resolve(REPO, "SAMPLE.xlsx");

const wb = await readXlsx(readFileSync(workbook));
const { bills, skipped } = parseBills(wb.sheets);

console.log(`workbook: ${workbook}`);
console.log("sheets:", wb.sheets.map((s) => s.name).join(", "));
console.log("baseName:", sanitizeBaseName(workbook.replace(/^.*[\\/]/, "")));
console.log("skipped:", JSON.stringify(skipped));
console.log("bills:", bills.length);

/* Every sheet must have produced a bill and nothing must have been skipped.
   A skipped sheet is a silent data loss: the workbook looks like it imported
   fine while an invoice is missing, so it is reported as a hard failure. */
let failures = 0;
if (skipped.length > 0) {
  console.log(`  FAIL  ${skipped.length} sheet(s) were skipped`);
  failures++;
}
if (bills.length === 0) {
  console.log("  FAIL  no bills were parsed");
  failures++;
}

for (const b of bills) {
  const o = b.original;
  console.log(`\n===== sheet "${b.sheetName}" =====`);
  console.log(
    `  copy spans: O ${o.firstRow}-${o.lastRow} | D ${b.duplicate.firstRow}-${b.duplicate.lastRow} | T ${b.triplicate.firstRow}-${b.triplicate.lastRow}`
  );
  console.log(`  seller: ${o.sellerName}`);
  console.log(`  descriptor: ${o.sellerDescriptor}`);
  console.log(`  taxline: ${o.sellerTaxLine}`);
  console.log(`  address: ${String(o.sellerAddress).slice(0, 60)}...`);
  console.log(`  contact: ${String(o.sellerContact).slice(0, 60)}...`);
  console.log(`  recipientHeading: ${o.recipientHeading}`);
  console.log(`  recipientNote: ${o.recipientNote}`);
  console.log(`  partyName: ${o.partyName}`);
  console.log(`  partyGstNo: ${o.partyGstNo}`);
  console.log(`  invoiceNo: ${o.invoiceNo}   invoiceDate: ${o.invoiceDate}`);
  console.log(`  ourChallan: ${o.ourChallanNo} / ${o.ourChallanDate}`);
  console.log(`  yourChallan: ${o.yourChallanNo} / ${o.yourChallanDate}`);
  console.log(`  order: ${o.orderNo}   label: ${o.orderNoLabel}   date: ${o.orderDate}`);
  console.log(`  eway: ${o.ewayBillNo}`);
  console.log(
    `  placeOfSupply: ${o.placeOfSupply}  state: ${o.state}  stateCode: ${o.stateCode}`
  );
  console.log(
    `  transporter: ${o.transporterMode}  vehicle: ${o.vehicleNumber}`
  );
  console.log(`  jobKind: ${o.jobKind}`);

  console.log("  lineItems:");
  for (const li of o.lineItems) {
    console.log(
      `    #${li.srNo} hsn=${li.hsnCode} uom=${li.uom} qty=${li.quantity} rate=${li.rate} amt=${li.amount}`
    );
    console.log(`       ${li.description}`);
  }

  console.log(
    `  TOTALS qty=${o.totalQuantity} beforeTax=${o.amountBeforeTax} cgst=${o.cgst} sgst=${o.sgst} igst=${o.igst} totalGst=${o.totalGst} afterTax=${o.amountAfterTax} reverse=${o.reverseCharge} roundOff=${o.roundOff}`
  );
  console.log(`  words: ${o.amountInWords}`);
  console.log(`  bank: ${JSON.stringify(o.bankDetails)}`);
  console.log(`  terms: ${JSON.stringify(o.terms)}`);
  console.log(`  sig:   ${JSON.stringify(o.signatures)}`);
  console.log(`  notes: ${JSON.stringify(o.notes)}`);
  console.log(
    `  duplicate lineItems=${b.duplicate.lineItems.length} triplicate lineItems=${b.triplicate.lineItems.length}`
  );

  /* The three copies are the SAME invoice. If any copy parsed a different
     total, the copy-detection span is wrong and every printed figure after the
     first is silently different. */
  for (const [name, copy] of [
    ["duplicate", b.duplicate],
    ["triplicate", b.triplicate],
  ] as const) {
    if (
      copy.amountAfterTax !== o.amountAfterTax ||
      copy.invoiceNo !== o.invoiceNo
    ) {
      console.log(
        `  FAIL  ${name} copy disagrees with original (${copy.invoiceNo} / ${copy.amountAfterTax} vs ${o.invoiceNo} / ${o.amountAfterTax})`
      );
      failures++;
    }
  }
}

console.log(
  failures === 0
    ? "\nPARSE CHECKS: all passed."
    : `\nPARSE CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
