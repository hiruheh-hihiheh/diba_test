// supabase/functions/_selftest/test-challan-creator.ts
//
// THE DELIVERY CHALLAN CREATOR: SAME ARCHITECTURE, DIFFERENT DOCUMENT.
//
// What this proves, without a database:
//
//   A. a challan form sends the challan fields and nothing financial — no tax rates,
//      no bank block, no terms, no amount in words;
//   B. "New Challan + Profile" preloads the company details a challan actually prints
//      and deliberately leaves the bank and payment terms blank;
//   C. a copy carries the customer, references, transport, every line item and every
//      REMARK, and never carries the source's identity or storage paths;
//   D. `computeBillValues` stores a challan with every money column null, a real
//      Total Quantity and its remarks intact;
//   E. validation is type-aware: a challan needs a number, a date and items, but is
//      never blocked by a missing rate, tax rate or amount;
//   F. the PDF renderer produces a challan (title, REMARKS, total quantity) with no
//      invoice money on it;
//   G. both client copies of the form module behave identically for a challan;
//   H. the server scopes duplicate detection and copy sources by document type.
//
// The test data is placeholder text on purpose. Nothing here asserts a real company
// name, a real customer or a real number.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  billFromRecord,
  computeTotals,
  documentTypeOf,
  round2,
  type BillRecord,
} from "../process-bill-upload/_shared/billDocument.ts";
import { computeBillValues, type BillPatch } from "../process-bill-upload/_shared/billEdit.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import { COPY_LABEL, type BillLineItem } from "../process-bill-upload/_shared/parseBill.ts";
import {
  BILL_LINE_ITEM_COLUMNS,
  copyBaseRecord,
  emptyBillRecord,
  findDuplicateInvoiceNos,
  lineItemFromRow,
  lineItemInsertRow,
  validateForFinalize,
} from "../process-bill-upload/_shared/billCreator.ts";
import { NO_PROFILE } from "../process-bill-upload/_shared/businessProfile.ts";
import * as adminForm from "../../../src/services/creatorForm.ts";
import * as desktopForm from "../../../../Metalworker_desktop/src/services/creatorForm.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

let failures = 0;
const check = (ok: boolean, label: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  — ${detail}` : ""}`);
};
const section = (title: string): void => console.log(`\n${title}`);

const moneyColumns = [
  "amount_before_tax",
  "cgst",
  "cgst_rate",
  "sgst",
  "sgst_rate",
  "igst",
  "igst_rate",
  "total_gst",
  "amount_after_tax",
  "reverse_charge_gst",
  "round_off",
  "amount_in_words",
  "bank_details",
  "terms",
] as const;

/** A stored challan row, built from the canonical blank record. */
function challanRecord(overrides: Partial<BillRecord> = {}): BillRecord {
  return {
    ...emptyBillRecord("original", "delivery_challan"),
    id: "11111111-1111-4111-8111-111111111111",
    sheet_name: "341 L",
    invoice_no: "CH/2026/041",
    invoice_date: "2026-10-04",
    party_name: "PLACEHOLDER PARTY",
    party_address: "1 PLACEHOLDER ROAD\nPLACEHOLDER CITY",
    party_gst_no: "27AAACD5678E1Z9",
    state: "MAHARASHTRA",
    state_code: "27",
    your_challan_no: "YC-9",
    your_challan_date: "2026-10-01",
    order_no: "SO-77",
    order_no_label: "Service Order No.",
    order_date: "2026-10-02",
    transporter_mode: "ROAD",
    vehicle_number: "MH00AA0000",
    seller_name: "PLACEHOLDER ENGINEERING",
    seller_descriptor: "FABRICATION WORK",
    seller_tax_line: "GST No.27AAACD5678E1Z9",
    seller_address: "PLACEHOLDER WORKS\nPLACEHOLDER CITY",
    seller_contact: "0000000000",
    job_kind: "LABOUR JOB",
    certification: "Received above material in good & condition",
    on_behalf_of: "For PLACEHOLDER ENGINEERING",
    signature_designation: "(Proprietor)",
    receiver_signature: "(Receivers Signature)",
    ...overrides,
  };
}

/** Stored `bill_line_items` rows, which is what a copy reads. */
const items = [
  {
    sr_no: 1,
    description: "MS PLATE 6MM",
    hsn_code: "7208",
    uom: "KG",
    quantity: 125.5,
    rate: null,
    amount: null,
    remarks: "CUT TO SIZE",
  },
  {
    sr_no: 2,
    description: "ANGLE 50X50",
    hsn_code: "7216",
    uom: "NOS",
    quantity: 12,
    rate: null,
    amount: null,
    remarks: null,
  },
];

/** The same rows in the renderer's shape, for `billFromRecord` and `computeTotals`. */
const billItems = items.map((item) => ({
  srNo: item.sr_no,
  description: item.description,
  hsnCode: item.hsn_code,
  uom: item.uom,
  quantity: item.quantity,
  rate: item.rate,
  amount: item.amount,
  remarks: item.remarks,
}));

/* ──────────────────────────────────────────────
   A. What a challan form sends
   ────────────────────────────────────────────── */

section("A. the challan patch carries the challan, never the invoice");

{
  const seed = adminForm.seedFromRecord(
    challanRecord() as unknown as Record<string, unknown>,
    items as unknown as Record<string, unknown>[],
    "copy"
  );
  const patch = adminForm.buildPatch({
    values: seed.values,
    lines: seed.lines,
    documentType: "delivery_challan",
  }) as Record<string, unknown>;

  for (const key of ["cgst_rate", "sgst_rate", "igst_rate", "round_off", "reverse_charge_gst", "amount_in_words"]) {
    check(!(key in patch), `a challan does not send ${key}`);
  }
  check(!("bank_details" in patch), "and does not send a bank block");
  check(!("terms" in patch), "and does not send payment terms");
  check(!("eway_bill_no" in patch), "and does not send an E-way bill number, which its template has no row for");
  check(!("our_challan_no" in patch), "and does not send an Our Challan number, which its template has no row for");
  check(!("place_of_supply" in patch), "and does not send a place of supply");

  check(patch.invoice_no === "CH/2026/041", "the challan number goes in the canonical number field");
  check(patch.invoice_date === "2026-10-04", "and the challan date in the canonical date field");
  check(patch.your_challan_no === "YC-9" && patch.your_challan_date === "2026-10-01", "the party's challan survives");
  check(patch.order_no === "SO-77" && patch.order_date === "2026-10-02", "the order survives");
  check(patch.transporter_mode === "ROAD" && patch.vehicle_number === "MH00AA0000", "transport survives");
  check(patch.job_kind === "LABOUR JOB", "the job type survives");

  const lines = patch.line_items as adminForm.LineItemPatch[] | undefined;
  check(!!lines && lines.length === 2, "both line items are sent", JSON.stringify(lines?.length));
  check(lines?.[0]?.remarks === "CUT TO SIZE", "a remark is sent verbatim");
  check(lines?.[1]?.remarks === null, "and an empty remark is null, not a stale value");
  check(lines?.[0]?.quantity === 125.5 && lines?.[0]?.hsn_code === "7208" && lines?.[0]?.uom === "KG", "quantity, HSN and UOM survive");
  check(lines?.[0]?.rate === null && lines?.[0]?.amount === null, "no rate or amount is invented for a challan line");
}

/* ──────────────────────────────────────────────
   B. Profile preload
   ────────────────────────────────────────────── */

section("B. New Challan + Profile preloads only what a challan prints");

{
  const profile = {
    company_name: "PLACEHOLDER ENGINEERING",
    business_description: "FABRICATION WORK",
    gst_number: "27AAACD5678E1Z9",
    msme_number: "UDYAM-XX-00-0000000",
    office_address: "PLACEHOLDER WORKS\nPLACEHOLDER CITY",
    email_1: "hello@example.com",
    mobile_1: "0000000000",
    certification_text: "Received above material in good & condition",
    authorized_signatory_text: "For PLACEHOLDER ENGINEERING",
    authorized_signatory_designation: "(Proprietor)",
    receiver_signature_label: "(Receivers Signature)",
    bank_name: "PLACEHOLDER BANK",
    bank_account_number: "000123",
    bank_branch: "PLACEHOLDER",
    bank_ifsc: "EXAM0000001",
    payment_days: 30,
    term_1: "Payment within 30 days.",
  } as const;

  const seed = adminForm.seedFromProfile(profile, "new", "delivery_challan");
  check(seed.values.seller_name === profile.company_name, "the company name is preloaded");
  check(seed.values.seller_address === profile.office_address, "the office address is preloaded");
  check(seed.values.seller_tax_line?.includes("GST No."), "the GST line is preloaded");
  check(seed.values.certification === profile.certification_text, "the receipt acknowledgement is preloaded");
  check(seed.values.on_behalf_of === profile.authorized_signatory_text, "the For <company> line is preloaded");
  check(seed.values.signature_designation === profile.authorized_signatory_designation, "the signatory designation is preloaded");
  check(seed.values.receiver_signature === profile.receiver_signature_label, "the receiver label is preloaded");

  check(Object.values(adminForm.bankPartValues(seed.bank)).every((v) => v === ""), "NO bank details are preloaded");
  check(seed.terms.every((line) => line === ""), "NO payment terms are preloaded");
  check(seed.amountInWords === "", "NO amount in words is preloaded");

  const patch = adminForm.buildPatch({ values: seed.values, lines: seed.lines, documentType: "delivery_challan" });
  check(!("bank_details" in patch) && !("terms" in patch), "and the resulting patch still carries neither");

  /* The invoice path is unchanged: the same profile still fills the bank and terms. */
  const invoiceSeed = adminForm.seedFromProfile(profile, "new");
  check(adminForm.bankPartValues(invoiceSeed.bank).bank_name === profile.bank_name, "the Tax Invoice profile seed keeps its bank block");
  check(invoiceSeed.terms[0] === profile.term_1, "and its terms");
}

/* ──────────────────────────────────────────────
   C. A copy preserves the document and loses the identity
   ────────────────────────────────────────────── */

section("C. copying a challan is a new draft, not a reference");

{
  const stored = challanRecord({
    original_pdf_path: "manual/old_original.pdf",
    duplicate_pdf_path: "manual/old_duplicate.pdf",
    triplicate_pdf_path: "manual/old_triplicate.pdf",
    creator_draft_key: "previous-key",
    status: "finalized",
    copied_from_bill_id: "22222222-2222-4222-8222-222222222222",
  }) as unknown as Record<string, unknown>;

  const seed = adminForm.seedFromRecord(stored, items as unknown as Record<string, unknown>[], "copy");
  check(seed.lines.length === 2, "every line is seeded");
  check(seed.lines[0].remarks === "CUT TO SIZE", "including a remark");
  check(seed.values.party_name === "PLACEHOLDER PARTY", "the customer is preserved");
  check(seed.values.seller_name === "PLACEHOLDER ENGINEERING", "the seller is preserved");
  check(seed.values.transporter_mode === "ROAD" && seed.values.vehicle_number === "MH00AA0000", "transport is preserved");
  check(seed.values.your_challan_no === "YC-9" && seed.values.order_no === "SO-77", "references are preserved");
  check(seed.values.job_kind === "LABOUR JOB", "job type is preserved");
  check(seed.values.certification?.startsWith("Received above material"), "signature wording is preserved");

  /* The identity is never in the seed at all, because `seedFromRecord` reads a named
     field list rather than projecting the row. */
  const serialised = JSON.stringify(seed);
  for (const forbidden of ["original_pdf_path", "duplicate_pdf_path", "triplicate_pdf_path", "creator_draft_key", "copied_from_bill_id", "finalized_at"]) {
    check(!serialised.includes(forbidden), `the seed never reads ${forbidden}`);
  }
  check(!("id" in seed.values), "and never reads the source id");
}

/* ──────────────────────────────────────────────
   D. Computed values
   ────────────────────────────────────────────── */

section("D. a challan stores quantity and remarks, and no money");

{
  const patch: BillPatch = {
    invoice_no: "CH/NEW-1",
    invoice_date: "2026-10-05",
    party_name: "PLACEHOLDER PARTY",
    job_kind: "WITH METAL",
    line_items: [
      { sr_no: 1, description: "MS PLATE", hsn_code: "7208", uom: "KG", quantity: 10, rate: 999, amount: 9990, remarks: "RUSH" },
      { sr_no: 2, description: "ANGLE", hsn_code: "7216", uom: "NOS", quantity: 2.5, rate: 500, amount: 1250, remarks: null },
    ],
    /* A client that sends these on a challan must not be able to store them. */
    cgst_rate: 9,
    sgst_rate: 9,
    igst_rate: 18,
    bank_details: { bank_name: { label: "Bank Name:", value: "PLACEHOLDER BANK" } },
    terms: "Payment within 30 days.",
    amount_in_words: "TEN THOUSAND ONLY",
  };

  const computed = computeBillValues(
    emptyBillRecord("original", "delivery_challan"),
    [],
    patch
  );
  const values = computed.values as Record<string, unknown>;

  for (const column of moneyColumns) {
    check(values[column] === null, `${column} is null, not zero and not the client's value`);
  }
  check(round2(Number(values.total_quantity)) === 12.5, "total quantity is the sum of the quantities", String(values.total_quantity));
  check(computed.lineItems.length === 2, "both lines survive");
  check(computed.lineItems[0].remarks === "RUSH", "a remark survives the calculation");
  check(computed.lineItems[1].remarks === null, "and an absent remark stays null");
  check(computed.lineItems.every((line) => line.rate === null && line.amount === null), "no line carries a rate or amount");
  check(values.job_kind === "WITH METAL", "the job type is stored");

  /* The invoice branch is untouched: the same patch on an invoice still charges. */
  const invoice = computeBillValues(emptyBillRecord("original", "tax_invoice"), [], patch);
  check(Number(invoice.values.amount_before_tax) > 0 && Number(invoice.values.total_gst) > 0, "the same patch on a Tax Invoice still computes money");
}

/* ──────────────────────────────────────────────
   E. Type-aware validation
   ────────────────────────────────────────────── */

section("E. validation blocks what would be unusable, and nothing else");

{
  const complete = {
    patch: { invoice_no: "CH/1", invoice_date: "2026-10-05" } as BillPatch,
    lineItems: [
      { srNo: 1, description: "MS PLATE", hsnCode: null, uom: "KG", quantity: 10, rate: null, amount: null, remarks: null },
    ],
    totals: { amountBeforeTax: 0, totalGst: 0, amountAfterTax: 0 },
    documentType: "delivery_challan" as const,
  };

  check(validateForFinalize(complete).length === 0, "a challan with a number, a date and material passes");

  const noNumber = validateForFinalize({ ...complete, patch: { invoice_date: "2026-10-05" } });
  check(noNumber.some((e) => e.field === "invoice_no" && /challan number/i.test(e.message)), "a missing challan number is named as a challan number");

  const noDate = validateForFinalize({ ...complete, patch: { invoice_no: "CH/1" } });
  check(noDate.some((e) => e.field === "invoice_date" && /challan date/i.test(e.message)), "a missing challan date is named as a challan date");

  const noItems = validateForFinalize({ ...complete, lineItems: [] });
  check(noItems.some((e) => e.field === "line_items"), "a challan with no items is refused");

  /* An invoice with the same shape is refused for its own, financial reason. */
  /* The difference is real, and it is financial: an invoice line with a zero amount
     and no quantity/rate is the half-typed row its rules exist to catch. A challan has
     no rate or amount column at all, so it must not be caught by that rule. */
  const financialRow = [
    { srNo: 1, description: "ITEM", hsnCode: null, uom: null, quantity: null, rate: null, amount: 0, remarks: null },
  ];
  const challanWithFinancialRow = validateForFinalize({ ...complete, lineItems: financialRow });
  check(challanWithFinancialRow.length === 0, "a challan is not blocked by an invoice-only financial rule");
  const asInvoice = validateForFinalize({ ...complete, lineItems: financialRow, documentType: "tax_invoice" });
  check(asInvoice.some((e) => e.field === "line_items.0"), "the same row on a Tax Invoice is refused");
}

/* ──────────────────────────────────────────────
   F. The challan PDF
   ────────────────────────────────────────────── */

section("F. the challan PDF is a challan");

{
  const record = challanRecord();
  const bytes = renderBillDocument(
    [billFromRecord(record, billItems, COPY_LABEL.original)],
    COPY_LABEL.original,
    null,
    NO_PROFILE
  );
  const text = new TextDecoder("latin1").decode(bytes);

  check(text.includes("DELIVERY CHALLAN"), "the title says DELIVERY CHALLAN");
  check(text.includes("(REMARKS) Tj") || text.includes("REMARKS"), "the material table has a REMARKS column");
  check(text.includes("CUT TO SIZE"), "a line's remark is printed");
  check(text.includes("125.5"), "the quantity is printed");
  check(!/AMOUNT/ .test(text), "no AMOUNT column is printed");
  check(!/CGST|SGST|IGST/.test(text), "no GST breakdown is printed");
  check(!/Bank Name/i.test(text), "no bank block is printed");
  check(!/Amount in words/i.test(text), "no amount in words is printed");

  /* The tax invoice renderer is unchanged by any of this. */
  const invoiceBytes = renderBillDocument(
    [
      billFromRecord(
        {
          ...challanRecord({ document_type: "tax_invoice", invoice_no: "INV/1", amount_before_tax: 1000, total_gst: 180, amount_after_tax: 1180, cgst: 90, sgst: 90, cgst_rate: 9, sgst_rate: 9, igst_rate: 18 }),
        },
        [{ ...billItems[0], rate: 100, amount: 1000 }],
        COPY_LABEL.original
      ),
    ],
    COPY_LABEL.original,
    null,
    NO_PROFILE
  );
  const invoiceText = new TextDecoder("latin1").decode(invoiceBytes);
  check(invoiceText.includes("TAX INVOICE"), "a Tax Invoice still prints TAX INVOICE");
  check(/AMOUNT/.test(invoiceText), "and still has its AMOUNT column");
}

/* ──────────────────────────────────────────────
   G. Both client copies agree
   ────────────────────────────────────────────── */

section("G. admin and desktop forms behave identically for a challan");

{
  const stored = challanRecord() as unknown as Record<string, unknown>;
  const rows = items as unknown as Record<string, unknown>[];

  const fromAdmin = {
    seed: adminForm.seedFromRecord(stored, rows, "k"),
    profile: adminForm.seedFromProfile({ company_name: "X" }, "k", "delivery_challan"),
    patch: adminForm.buildPatch({
      values: adminForm.seedFromRecord(stored, rows, "k").values,
      lines: adminForm.seedFromRecord(stored, rows, "k").lines,
      documentType: "delivery_challan",
    }),
    totals: adminForm.creatorTotals(adminForm.seedFromRecord(stored, rows, "k").lines),
  };
  const fromDesktop = {
    seed: desktopForm.seedFromRecord(stored, rows, "k"),
    profile: desktopForm.seedFromProfile({ company_name: "X" }, "k", "delivery_challan"),
    patch: desktopForm.buildPatch({
      values: desktopForm.seedFromRecord(stored, rows, "k").values,
      lines: desktopForm.seedFromRecord(stored, rows, "k").lines,
      documentType: "delivery_challan",
    }),
    totals: desktopForm.creatorTotals(desktopForm.seedFromRecord(stored, rows, "k").lines),
  };

  for (const key of Object.keys(fromAdmin) as (keyof typeof fromAdmin)[]) {
    check(
      JSON.stringify(fromAdmin[key]) === JSON.stringify(fromDesktop[key]),
      `both copies agree on ${key}`
    );
  }
  check(fromAdmin.totals.totalQuantity === 137.5, "and both total the quantities", String(fromAdmin.totals.totalQuantity));
  check(fromAdmin.totals.amountBeforeTax === 0, "with no money on a challan");
}

/* ──────────────────────────────────────────────
   H. The request and the server guards
   ────────────────────────────────────────────── */

section("H. the request names its type, and the server scopes by it");

{
  /* The network layer cannot be imported here: it imports a Supabase client through a
     bundler-resolved specifier that Node's type stripping does not resolve. Its
     challan behaviour is `buildPatch` plus two guards, so both are checked directly. */
  const values = {
    invoice_no: "CH/9",
    invoice_date: "2026-10-05",
    party_name: "PLACEHOLDER",
    term_1: "Payment within 30 days.",
    cgst_rate: "9",
    amount_in_words: "SAYING",
  };
  const line = [
    { key: "a", srNo: "1", description: "MS PLATE", hsnCode: "7208", uom: "KG", quantity: "10", rate: "100", amount: "", remarks: "RUSH" },
  ];
  const challanPatch = adminForm.buildPatch({ values, lines: line, documentType: "delivery_challan" });
  check(!("bank_details" in challanPatch), "a challan request has no bank block");
  check(!("terms" in challanPatch), "no terms");
  check(!("cgst_rate" in challanPatch), "no tax rate");
  check(!("amount_in_words" in challanPatch), "no amount in words");
  check("line_items" in challanPatch, "but it does carry its line items");

  const invoicePatch = adminForm.buildPatch({ values, lines: line });
  check(invoicePatch.cgst_rate === 9, "the same values on a Tax Invoice still carry tax");

  const client = readFileSync(resolve(REPO, "Metalworker_admin/src/services/billCreator.ts"), "utf8");
  check(
    /document_type: documentType,/.test(client),
    "the request body names the document type"
  );
  check(
    /if \(!challan\) \{[\s\S]{0,400}bank_details/.test(client),
    "and the network layer only sends a bank block for a Tax Invoice"
  );

  /* Static guards on the edge function: a duplicate check and the source type check
     are SQL, so they are asserted as code shape rather than by running a database. */
  const server = readFileSync(resolve(REPO, "Metalworker_admin/supabase/functions/create-bill/index.ts"), "utf8");
  check(
    /\.eq\("invoice_no", String\(values\.invoice_no\)\)[\s\S]{0,120}\.eq\("document_type", documentType\)/.test(server),
    "duplicate detection is scoped to the same document type"
  );
  check(
    /documentTypeOf\(source as unknown as BillRecord\) !== options\.documentType/.test(server),
    "a copy source of the other type is refused on the server"
  );
  check(
    /read\.row\.document_type !== documentType/.test(server),
    "a draft of the other type is refused on the server"
  );
  check(
    /document_type: options\.documentType/.test(server),
    "the created bill records the requested type"
  );
  check(
    /document_type: options\.documentType,[\s\S]{0,80}?\}\)/.test(server) &&
      server.includes(".from(UPLOADS)") &&
      /document_type: options\.documentType/.test(server.slice(server.indexOf(".from(UPLOADS)"))),
    "and so does its provenance upload, which the composite foreign key requires"
  );
  check(
    /documentType,/.test(server),
    "validation receives the document type"
  );
}

/* ──────────────────────────────────────────────
   I. Type identity helpers
   ────────────────────────────────────────────── */

section("I. copies never change document type");

{
  const source = challanRecord({ cgst: 90, sgst: 90, igst: 0 });
  const base = copyBaseRecord(source, "delivery_challan");
  check(documentTypeOf(base) === "delivery_challan", "the base is a challan");
  check(base.cgst === null && base.sgst === null && base.igst === null, "and inherits no tax amounts");

  const invoiceBase = copyBaseRecord(challanRecord({ document_type: "tax_invoice", cgst: 90, sgst: 90 }), "tax_invoice");
  check(invoiceBase.cgst === 90 && invoiceBase.sgst === 90, "an invoice copy still inherits its applicability");

  const dupes = findDuplicateInvoiceNos("CH/2026/041", [
    { bill_id: "a", invoice_no: "ch/2026/041 ", invoice_date: null, sheet_name: null, party_name: null, status: null },
  ]);
  check(dupes.length === 1, "duplicate matching still trims and case-folds");

  /* `computeTotals` is untouched: a challan simply has no amounts to total. */
  const totals = computeTotals({ lineItems: billItems, cgstRate: null, sgstRate: null, igstRate: null, roundOff: null });
  check(totals.totalQuantity === 137.5 && totals.amountBeforeTax === 0, "the canonical totals agree with the form");
}

/* ──────────────────────────────────────────────
   J. Remarks survive the database row
   ────────────────────────────────────────────── */

section("J. remarks are written to, and read back from, bill_line_items");

{
  const remarkItem: BillLineItem = {
    srNo: 1,
    description: "MS PLATE",
    hsnCode: "7208",
    uom: "KG",
    quantity: 10,
    rate: null,
    amount: null,
    remarks: "  COLOUR: BLACK  ",
  };

  const row = lineItemInsertRow("bill-1", remarkItem);
  check(row.remarks === "  COLOUR: BLACK  ", "an insert carries the remark verbatim");
  check(row.bill_id === "bill-1" && row.sr_no === 1, "with the row's own identifiers");
  check(row.rate === null && row.amount === null, "and no money on a challan line");

  const back = lineItemFromRow({ ...row } as unknown as Record<string, unknown>);
  check(back.remarks === row.remarks, "the stored row reads back with the same remark");
  check(back.description === "MS PLATE" && back.quantity === 10, "and the rest of the line survives the round trip");

  const again = lineItemInsertRow("bill-1", back);
  check(again.remarks === row.remarks, "so a save made after a read does not lose it");

  check(lineItemInsertRow("bill-1", { ...remarkItem, remarks: "   " }).remarks === null, "a blank remark is stored as null");
  check(lineItemInsertRow("bill-1", { ...remarkItem, remarks: undefined }).remarks === null, "and so is a line that never had one");
  check(lineItemFromRow({ ...row, remarks: null } as unknown as Record<string, unknown>).remarks === null, "a null column reads back as null");
  check(BILL_LINE_ITEM_COLUMNS.includes("remarks"), "the shared column list includes remarks");

  /* The two writes in create-bill and its one read must go through these helpers. A
     second hand-written mapping is exactly how one path forgets the column again, so
     the count is asserted as well as the read. */
  const server = readFileSync(resolve(REPO, "Metalworker_admin/supabase/functions/create-bill/index.ts"), "utf8");
  const insertCalls = server.match(/lineItemInsertRow\(/g)?.length ?? 0;
  check(insertCalls === 2, "both writes (first insert and re-insert) use the shared row mapper", `found ${insertCalls}`);
  check(server.includes(".select(BILL_LINE_ITEM_COLUMNS)"), "readBill selects the shared column list");
  check(
    /\.map\(\(row: Record<string, unknown>\) => lineItemFromRow\(row\)\)/.test(server),
    "and maps stored rows back through the shared reader"
  );

  /* Copy Existing Challan: the form's remark reaches the copied line item. */
  const copy = copyBaseRecord(challanRecord(), "delivery_challan");
  const patch = adminForm.buildPatch({
    values: {},
    lines: [
      { key: "a", srNo: "1", description: "MS PLATE", hsnCode: "7208", uom: "KG", quantity: "5", rate: "", amount: "", remarks: "RUSH ORDER" },
    ],
    documentType: "delivery_challan",
  }) as BillPatch;
  const made = computeBillValues(copy, billItems, patch);
  check(made.lineItems[0]?.remarks === "RUSH ORDER", "a copied challan keeps the remark the form carried");
  check(made.lineItems[0]?.rate === null, "and still carries no money");
}

/* ──────────────────────────────────────────────
   K. Folder type and failure feedback
   ────────────────────────────────────────────── */

section("K. folders are scoped by type, and a refused link is not a success");

{
  /* The screens are React components and cannot be imported under plain Node, so their
     calls are asserted as code shape. The decision they delegate to — which folder kind
     a document type means — is asserted on the service that owns it. */
  const screens: [string, string][] = [
    ["desktop", readFileSync(resolve(REPO, "Metalworker_desktop/src/pages/CreateBill.tsx"), "utf8")],
    ["mobile", readFileSync(resolve(REPO, "Metalworker_admin/src/components/bills/CreateBillScreen.tsx"), "utf8")],
  ];
  for (const [name, source] of screens) {
    check(/fetchBillingFolders\(documentType\)/.test(source), `${name}: billing folders are read for this section's type`);
    check(/createBillingFolder\(name, documentType\)/.test(source), `${name}: a new folder is created for this section's type`);
    check(/generationNotice\(result,/.test(source), `${name}: the finalize result becomes a generation notice`);
  }

  for (const [name, path] of [
    ["desktop", "Metalworker_desktop/src/services/billingFolders.ts"],
    ["mobile", "Metalworker_admin/src/services/billingFolders.ts"],
  ] as const) {
    const service = readFileSync(resolve(REPO, path), "utf8");
    check(
      /documentType === "delivery_challan" \? CHALLAN_BILLING_FOLDER_KIND : BILLING_FOLDER_KIND/.test(service),
      `${name}: a challan resolves to challan_billing and an invoice to billing`
    );
  }
  const folderTypes = readFileSync(resolve(REPO, "Metalworker_desktop/src/types/folder.ts"), "utf8");
  check(/CHALLAN_BILLING_FOLDER_KIND[^=]*=\s*"challan_billing"/.test(folderTypes), "challan folders are typed challan_billing");
  check(/BILLING_FOLDER_KIND[^=]*=\s*"billing"/.test(folderTypes), "invoice folders are typed billing, unchanged");

  const words = { label: "Challan", noun: "challan" };
  const filed = adminForm.generationNotice({ folder_linked: true, jobs_error: null }, words);
  check(filed.tone === "success", "a fully filed challan is a plain success");
  check(/Original, Duplicate and Triplicate/.test(filed.body), "and still names the three copies");

  const folderOnly = adminForm.generationNotice({ folder_linked: false, jobs_error: null }, words);
  check(folderOnly.tone === "warning", "a folder that refused the link is NOT reported as success");
  check(/billing folder/.test(folderOnly.body), "the message says the folder link is the problem");
  check(/PDFs are correct/.test(folderOnly.body), "and that the document itself was generated");

  const jobsOnly = adminForm.generationNotice({ folder_linked: true, jobs_error: "job 12 is closed" }, words);
  check(jobsOnly.tone === "warning" && /job 12 is closed/.test(jobsOnly.body), "the existing job-link warning is preserved");

  const both = adminForm.generationNotice({ folder_linked: false, jobs_error: "job 12 is closed" }, words);
  check(/billing folder/.test(both.body) && /job 12 is closed/.test(both.body), "both failures are named together");
  check(!/generation failed/i.test(both.body), "without claiming the PDFs were not made");

  const invoice = { label: "Invoice", noun: "bill" };
  check(
    JSON.stringify(adminForm.generationNotice({ folder_linked: false, jobs_error: null }, invoice)) ===
      JSON.stringify(desktopForm.generationNotice({ folder_linked: false, jobs_error: null }, invoice)),
    "both client copies say the same thing"
  );
  check(
    adminForm.generationNotice({ folder_linked: true, jobs_error: null }, invoice).tone === "success",
    "a Tax Invoice whose folder linked is still a plain success"
  );
}

console.log(
  failures === 0
    ? "\nCHALLAN CREATOR CHECKS: all passed."
    : `\nCHALLAN CREATOR CHECKS: ${failures} failure(s).`
);
process.exit(failures === 0 ? 0 : 1);
