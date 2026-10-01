// Print exactly what the parser captures for one worksheet, so a gap between the
// workbook and the model is visible as data rather than guessed at.
//
//   node supabase/functions/_selftest/probe-bill.ts "BILL 301 TO.xlsx" "316 L"
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, COPY_ORDER } from "../process-bill-upload/_shared/parseBill.ts";
import { formatJobKind } from "../process-bill-upload/_shared/formatJobKind.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(here, "../../../..");
const file = resolve(REPO, process.argv[2] ?? "BILL 301 TO.xlsx");
const want = (process.argv[3] ?? "316 L").trim();

const wb = await readXlsx(readFileSync(file));
const { bills, skipped } = parseBills(wb.sheets);
if (skipped.length) console.log(`skipped: ${skipped.map((s) => s.sheet ?? s).join(", ")}`);
const bill = bills.find((b) => b.sheetName.trim() === want);
if (!bill) {
  console.error(`no bill for sheet "${want}". have: ${bills.map((b) => b.sheetName).join(" | ")}`);
  process.exit(1);
}

const o = bill.original;
const show = (k: string, v: unknown) =>
  console.log(`  ${k.padEnd(20)} ${v === null || v === undefined || v === "" ? "— (empty)" : JSON.stringify(v)}`);

console.log(`\nsheet "${bill.sheetName}"  rows ${o.firstRow}..${o.lastRow}`);
console.log("── seller ──");
show("sellerName", o.sellerName);
show("sellerDescriptor", o.sellerDescriptor);
show("sellerTaxLine", o.sellerTaxLine);
show("sellerAddress", o.sellerAddress);
show("sellerContact", o.sellerContact);
console.log("── recipient ──");
show("recipientHeading", o.recipientHeading);
show("recipientNote", o.recipientNote);
show("partyName", o.partyName);
show("partyAddress", o.partyAddress);
show("partyGstNo", o.partyGstNo);
console.log("── metadata ──");
show("invoiceNo", o.invoiceNo);
show("invoiceDate", o.invoiceDate);
show("ourChallanNo", o.ourChallanNo);
show("ourChallanDate", o.ourChallanDate);
show("yourChallanNo", o.yourChallanNo);
show("yourChallanDate", o.yourChallanDate);
show("orderNo", o.orderNo);
show("orderNoLabel", o.orderNoLabel);
show("orderDate", o.orderDate);
show("ewayBillNo", o.ewayBillNo);
show("ewayBillDate", o.ewayBillDate);
show("placeOfSupply", o.placeOfSupply);
show("state", o.state);
show("stateCode", o.stateCode);
show("transporterMode", o.transporterMode);
show("vehicleNumber", o.vehicleNumber);
console.log("── referenceRows (as the renderer receives them) ──");
for (const r of o.referenceRows) {
  console.log(
    `  [${r.hasDateCell ? "D" : " "}] ${r.label.padEnd(22)} value=${JSON.stringify(r.value)} date=${JSON.stringify(r.date)}`
  );
}
console.log("── money ──");
for (const k of [
  "totalQuantity", "amountBeforeTax", "cgst", "sgst", "igst",
  "totalGst", "amountAfterTax", "reverseChargeGst", "roundOff",
] as const) {
  show(k, o[k]);
}
show("amountInWords", o.amountInWords);
show("jobKind (raw)", o.jobKind);
show("jobKind (shown)", formatJobKind(o.jobKind));
show("cgstRate", o.cgstRate);
show("sgstRate", o.sgstRate);
show("igstRate", o.igstRate);
console.log("── line items ──");
for (const it of o.lineItems) {
  console.log(
    `  ${it.srNo ?? "-"} | ${JSON.stringify(it.description)} | hsn=${it.hsnCode ?? "-"} | uom=${it.uom ?? "-"} | qty=${it.quantity ?? "-"} | rate=${it.rate ?? "-"} | amt=${it.amount ?? "-"}`
  );
}
console.log("── bank ──");
o.bankLines.forEach((l) => console.log(`  | ${l}`));
console.log("── terms ──");
o.termsLines.forEach((l) => console.log(`  | ${l}`));
console.log("── signature ──");
o.signatureLines.forEach((l) => console.log(`  | ${l}`));
console.log("── notes ──");
o.notes.forEach((l) => console.log(`  | ${l}`));
console.log("── footer wording ──");
show("certification", o.certification);
show("onBehalfOf", o.onBehalfOf);
show("signatureDesignation", o.signatureDesignation);
show("receiverSignature", o.receiverSignature);
show("notesExtra", o.notesExtra);
console.log(`\ncopies present: ${COPY_ORDER.filter((c) => !!bill[c]).join(", ")}`);
