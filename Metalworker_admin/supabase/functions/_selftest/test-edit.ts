// Acceptance test for EDITING a bill, and for the database bridge the editor
// depends on.
//
// The load-bearing claim of this feature is "the PDF is generated from the database
// bill, not from the old Excel upload". That is only true if the round trip loses
// nothing, and the only honest way to check it is to compare the two documents
// byte for byte:
//
//     render(from the parse)  ===  render(from the stored record)
//
// If those differ on any field, an edit followed by a re-print would silently drop
// or reformat whatever the bridge lost — the address, the seller header, a tax rate,
// the footer wording — and no amount of UI testing would show it.
//
// Also covered: the recalculation rules against all 20 production invoices, the
// amount-in-words generator, the bank's lossless round trip, validation, and the
// isolation guarantee that editing one bill cannot alter another.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readXlsx } from "../process-bill-upload/_shared/xlsx.ts";
import { parseBills, copyDisagreements, COPY_LABEL, COPY_ORDER } from "../process-bill-upload/_shared/parseBill.ts";
import { renderBillDocument } from "../process-bill-upload/_shared/renderBill.ts";
import {
  amountInWords,
  bankLinesOf,
  billFromRecord,
  parseBankLines,
  toBillRecord,
  type BillRecord,
} from "../process-bill-upload/_shared/billDocument.ts";
import {
  applyPatch,
  computeBillValues,
  EditError,
} from "../process-bill-upload/_shared/billEdit.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const workbook = process.argv[2] ?? resolve(REPO, "BILL 301 TO.xlsx");

let failures = 0;
const check = (ok: boolean, label: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const section = (name: string): void => console.log(`\n${name}`);

const wb = await readXlsx(readFileSync(workbook));
const { bills } = parseBills(wb.sheets);
console.log(`workbook: ${workbook}\n${bills.length} bill(s)\n`);

const UPLOAD_ID = "00000000-0000-0000-0000-000000000001";
/** PostgREST returns every uuid as a string, which is what the bridge must accept. */
const asRecord = (b: (typeof bills)[number]): BillRecord =>
  toBillRecord(b, UPLOAD_ID) as unknown as BillRecord;

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);
const pageCount = (bytes: Uint8Array): number =>
  (latin1(bytes).match(/stream\r?\n([\s\S]*?)\r?\nendstream/g) ?? []).length;

/* ──────────────────────────────────────────────
   1. The bridge loses nothing
   ────────────────────────────────────────────── */
section("1. render(parse) must equal render(stored record), byte for byte");

/* All three copies are rendered from the ORIGINAL block, which is what
   `process-bill-upload` does: the three blocks on a worksheet are three physical
   print copies of ONE invoice, so the three documents must carry identical data. */
let roundTripFailures = 0;
for (const b of bills) {
  for (const copy of COPY_ORDER) {
    const fromParse = renderBillDocument([b.original], COPY_LABEL[copy]);
    const fromRecord = renderBillDocument(
      [billFromRecord(asRecord(b), b.original.lineItems, COPY_LABEL[copy])],
      COPY_LABEL[copy]
    );
    if (fromParse.length !== fromRecord.length) {
      if (roundTripFailures < 4) {
        check(false, `${b.sheetName} ${copy}: ${fromParse.length} B vs ${fromRecord.length} B`);
      }
      roundTripFailures++;
      continue;
    }
    for (let i = 0; i < fromParse.length; i++) {
      if (fromParse[i] !== fromRecord[i]) {
        if (roundTripFailures < 4) {
          check(false, `${b.sheetName} ${copy}: first difference at byte ${i}`);
        }
        roundTripFailures++;
        break;
      }
    }
  }
}
check(
  roundTripFailures === 0,
  `all ${bills.length * COPY_ORDER.length} documents identical through the database`,
  `${roundTripFailures} differ`
);

/* And the source's own copy disagreements are found rather than inherited. */
const disagreeing = bills
  .map((b) => ({ sheet: b.sheetName, fields: copyDisagreements(b) }))
  .filter((d) => d.fields.length > 0);
check(
  disagreeing.length > 0,
  "the workbook really does contain a copy disagreement, so the check is exercised",
  disagreeing.map((d) => `${d.sheet}: ${d.fields.map((f) => f.field).join(",")}`).join(" | ")
);
check(
  disagreeing.every((d) => d.sheet === "320" && d.fields.some((f) => f.field === "yourChallanNo")),
  "and it is the one on sheet 320, where ORIGINAL says 'abc' and the other two are blank",
  JSON.stringify(disagreeing[0]?.fields[0] ?? null)
);
/* The production upload resolves all three copies in favour of ORIGINAL, so the value
   the workbook put in one block reaches all three documents. Rendering each copy from
   its own block instead would print "abc" on the original and nothing on the other
   two — three documents of one invoice that disagree with each other. */
const sheet320 = bills.find((b) => b.sheetName.trim() === "320");
check(!!sheet320, "sheet 320 is present to check the resolution");
if (sheet320) {
  const withValue = COPY_ORDER.filter((copy) =>
    latin1(renderBillDocument([sheet320.original], COPY_LABEL[copy])).includes("(abc) Tj")
  );
  check(
    withValue.length === COPY_ORDER.length,
    "the resolved challan number reaches all three copies, not just the original",
    `${withValue.length} of ${COPY_ORDER.length}: ${withValue.join(", ")}`
  );
  const withoutValue = COPY_ORDER.filter(
    (copy) => !latin1(renderBillDocument([sheet320[copy]], COPY_LABEL[copy])).includes("(abc) Tj")
  );
  check(
    withoutValue.length === COPY_ORDER.length - 1,
    "and the old behaviour — one block per copy — really did drop it from two of them",
    `${withoutValue.length} copies lacked it`
  );
}

/* ──────────────────────────────────────────────
   2. Recalculation reproduces the production totals
   ────────────────────────────────────────────── */
section("2. computeBillValues with an empty patch must reproduce the stored figures");

let totalFailures = 0;
const details: string[] = [];
for (const b of bills) {
  const record = asRecord(b);
  const { values } = computeBillValues(record, b.original.lineItems, {});
  const expect = (k: string, v: unknown): void => {
    const a = Number(values[k] ?? NaN);
    const e = Number(v ?? NaN);
    if (!(Math.abs(a - e) < 0.005)) {
      totalFailures++;
      if (details.length < 5) details.push(`${b.sheetName} ${k}: computed ${a} vs stored ${e}`);
    }
  };
  expect("total_quantity", b.original.totalQuantity);
  expect("amount_before_tax", b.original.amountBeforeTax);
  expect("cgst", b.original.cgst);
  expect("sgst", b.original.sgst);
  expect("igst", b.original.igst);
  expect("total_gst", b.original.totalGst);
  expect("amount_after_tax", b.original.amountAfterTax);
}
check(
  totalFailures === 0,
  "line x rate, tax on the base, and before + gst + round off all match the workbook",
  details.join(" | ")
);

const rounding = bills.filter(
  (b) => b.original.roundOff !== null && b.original.roundOff !== 0
);
check(
  rounding.length > 0,
  "the rule is actually exercised by real rounding",
  `${rounding.length} of ${bills.length} invoices round`
);
check(
  rounding.every((b) => {
    const o = b.original;
    return Math.abs(o.amountBeforeTax! + o.totalGst! + o.roundOff! - o.amountAfterTax!) < 0.005;
  }),
  "each rounded invoice satisfies after = before + gst + round off"
);
check(
  bills.every((b) => b.original.cgstRate === 9 && b.original.sgstRate === 9 && b.original.igstRate === 18),
  "rates are stored as percentages, not the workbook's 0.09 fractions"
);
check(
  bills.every((b) => asRecord(b).igst_rate === 18),
  "the 18% IGST rate survives to the row, which is what makes it printable at 0.00"
);

/* ──────────────────────────────────────────────
   3. Amount in words
   ────────────────────────────────────────────── */
section("3. amountInWords");
const words: [number, string][] = [
  // 8,850 is eight thousand — the workbook's own line for 88,850 is "EIGHTY
  // THOUSAND ...", and both forms are asserted below so the scale handling is
  // pinned on both sides of a boundary.
  [8850, "EIGHT THOUSAND EIGHT HUNDRED AND FIFTY ONLY"],
  [88850, "EIGHTY EIGHT THOUSAND EIGHT HUNDRED AND FIFTY ONLY"],
  [100, "ONE HUNDRED ONLY"],
  [7500, "SEVEN THOUSAND FIVE HUNDRED ONLY"],
  [1234567, "TWELVE LAKH THIRTY FOUR THOUSAND FIVE HUNDRED AND SIXTY SEVEN ONLY"],
  [0, "ZERO ONLY"],
  [10000000, "ONE CRORE ONLY"],
  [105, "ONE HUNDRED AND FIVE ONLY"],
  [0.5, "FIFTY PAISE ONLY"],
  [33040, "THIRTY THREE THOUSAND AND FORTY ONLY"],
  [19999, "NINETEEN THOUSAND NINE HUNDRED AND NINETY NINE ONLY"],
];
for (const [value, expected] of words) {
  check(amountInWords(value) === expected, `${value} ->`, String(amountInWords(value)));
}
check(amountInWords(null) === null, "a missing amount produces no words, not \"null\"");

/* ──────────────────────────────────────────────
   4. The bank block round trips exactly
   ────────────────────────────────────────────── */
section("4. bank details keep the workbook's own wording");
for (const b of bills) {
  const lines = b.original.bankLines;
  if (lines.length === 0) continue;
  const parts = parseBankLines(lines);
  const rebuilt = bankLinesOf(parts);
  if (rebuilt.join("|") !== lines.join("|")) {
    check(false, `${b.sheetName} bank lines rebuilt exactly`, JSON.stringify(rebuilt));
  }
}
check(
  bills.every((b) => {
    const lines = b.original.bankLines;
    return lines.length === 0 || bankLinesOf(parseBankLines(lines)).join("|") === lines.join("|");
  }),
  "label + value reproduces every bank line, for all 20 invoices"
);
const sampleBank = parseBankLines([
  "Bank Name: EXAMPLE BANK LTD",
  "ACCOUNT NUMBER:00000000123456",
  "BRANCH: EXAMPLE BRANCH",
  "IFSC CODE:EXAM0000001",
]);
check(
  sampleBank.ifsc_code?.label === "IFSC CODE:" && sampleBank.ifsc_code?.value === "EXAM0000001",
  "a label with no space before its value is still split correctly",
  JSON.stringify(sampleBank.ifsc_code)
);
check(
  Object.keys(sampleBank).length === 4,
  "bank name, account number, branch and IFSC are four separate editable parts",
  Object.keys(sampleBank).join(", ")
);

/* ──────────────────────────────────────────────
   5. The required labour invoice
   ────────────────────────────────────────────── */
section("5. FIX/316/2026-27 carries the full production data");
const labour = bills.find((b) => b.original.invoiceNo === "FIX/316/2026-27");
check(!!labour, "the labour invoice under test is present");
if (labour) {
  const o = labour.original;
  const rec = asRecord(labour);
  check(o.partyName === "M/s. Example Cookers Ltd.,", "company name", String(o.partyName));
  check(
    o.partyAddress.join("|") ===
      'C-21,22 "U" Road,|Example Industrial Estate,|Example City - 000 001.',
    "the address keeps all three source lines, quotes and all",
    JSON.stringify(o.partyAddress)
  );
  check(
    rec.party_address === o.partyAddress.join("\n"),
    "the address is stored with its line breaks"
  );
  check(o.transporterMode === "VEHICLE", "transporter", String(o.transporterMode));
  check(o.vehicleNumber === "MH 00 EX 0000", "vehicle", String(o.vehicleNumber));
  check(o.yourChallanNo === "WT/OGC/TR/9000006", "your challan", String(o.yourChallanNo));
  check(o.orderNoLabel === "Service Order No.:", "the labour order label", String(o.orderNoLabel));
  check(o.ewayBillNo === null && o.ewayBillDate === null, "e-way is genuinely blank in the source");
  check(
    o.referenceRows.some((r) => r.label === "Eway Bill No." && r.value === null && r.hasDateCell),
    "the e-way ROW still exists, which is the empty-field requirement"
  );
  check(
    o.termsLines.some((l) => /40 DAYS/i.test(l)),
    "the terms contain the payment window"
  );
  check(
    o.certification === "Certified that the particulars given above are true and correct" &&
      o.onBehalfOf === "For EXAMPLE ENGINEERING WORKS" &&
      o.signatureDesignation === "(Proprietor)" &&
      o.receiverSignature === "(Receivers Signature)",
    "all four footer phrases are captured by name"
  );

  /* The specific acceptance example, read back out of the produced document. */
  const pdf = renderBillDocument(
    [billFromRecord(rec, o.lineItems, "ORIGINAL")],
    COPY_LABEL.original
  );
  const raw = latin1(pdf);
  const has = (s: string): boolean => raw.includes(`(${s.replace(/([()\\])/g, "\\$1")})`);
  check(has("M/s. Example Cookers Ltd.,"), "the PDF prints the company name");
  for (const line of o.partyAddress) check(has(line), "the PDF prints the address line", line);
  check(has("Transporter:"), "the transporter label is present");
  check(has("VEHICLE"), "the transporter value is present");
  check(has("Vehicle No.:"), "the vehicle label is present");
  check(has("MH 00 EX 0000"), "the vehicle value is present");
  check(has("Eway Bill No.") && has("Eway Bill Date"), "the empty e-way rows are still printed");
  check(has("40 DAYS"), "the emphasized payment window is printed");
  check(pageCount(pdf) === 1, "and it all fits on one A4 page", `${pageCount(pdf)} pages`);
}

/* ──────────────────────────────────────────────
   6. Editing changes this bill only
   ────────────────────────────────────────────── */
section("6. an edit changes the bill it targets and nothing else");

if (labour) {
  const target = labour;
  const neighbour = bills.find((b) => b.sheetName === "315 L") ?? bills[1];
  const neighbourBefore = renderBillDocument(
    [billFromRecord(asRecord(neighbour), neighbour.original.lineItems, COPY_LABEL.original)],
    COPY_LABEL.original
  );

  const record = asRecord(target);
  const before = renderBillDocument(
    [billFromRecord(record, target.original.lineItems, COPY_LABEL.original)],
    COPY_LABEL.original
  );

  const edited = computeBillValues(record, target.original.lineItems, {
    party_address: "Unit 7, Andheri Industrial Estate\nAndheri East, Mumbai - 400 069.",
    party_name: "M/s. Example Cookers Private Limited,",
    vehicle_number: "MH 01 AB 1234",
    your_challan_no: "WT/OGC/TR/999999",
    line_items: [
      {
        sr_no: 1,
        description: "REWORKED 5L DEEP KADHAI FLANGE TOOL",
        hsn_code: "82073000",
        uom: "NOS",
        quantity: 3,
        rate: 9000,
      },
      { sr_no: 2, description: "Second line added by the editor", hsn_code: "82073000", uom: "NOS", quantity: 1, rate: 1000 },
    ],
    terms: "1.Payment requested within 15 DAYS\n2. Payment requested by NEFT only.",
    // Explicitly asks for the words to be rebuilt. Omitting the key would keep the
    // imported wording, which is the documented and intended behaviour.
    amount_in_words: null,
  });
  const after = renderBillDocument(
    [
      billFromRecord(
        { ...record, ...edited.values, amount_in_words: edited.values.amount_in_words } as BillRecord,
        edited.lineItems,
        COPY_LABEL.original
      ),
    ],
    COPY_LABEL.original
  );
  const raw = latin1(after);
  const has = (s: string): boolean => raw.includes(`(${s.replace(/([()\\])/g, "\\$1")})`);

  /* The recalculated figures, asserted against the rule rather than a snapshot. */
  check(edited.values.amount_before_tax === 28000, "3 x 9,000 + 1 x 1,000", String(edited.values.amount_before_tax));
  check(edited.values.cgst === 2520, "CGST 9% of 28,000", String(edited.values.cgst));
  check(edited.values.sgst === 2520, "SGST 9% of 28,000", String(edited.values.sgst));
  check(edited.values.total_gst === 5040, "total GST", String(edited.values.total_gst));
  check(edited.values.amount_after_tax === 33040, "after tax, round off 0", String(edited.values.amount_after_tax));
  check(
    edited.values.amount_in_words ===
      amountInWords(Number(edited.values.amount_after_tax)),
    "the words were regenerated to match the new total",
    String(edited.values.amount_in_words)
  );
  check(edited.lineItems.length === 2, "the added line survives");
  check(edited.lineItems[0].amount === 27000, "line 1 amount is 3 x 9,000", String(edited.lineItems[0].amount));

  check(has("M/s. Example Cookers Private Limited,"), "the new company name is printed");
  check(has("Unit 7, Andheri Industrial Estate"), "the new address line 1 is printed");
  check(has("Andheri East, Mumbai - 400 069."), "the new address line 2 is printed");
  check(!has('C-21,22 "U" Road,'), "the old address is gone");
  check(has("MH 01 AB 1234"), "the new vehicle is printed");
  check(!has("MH 00 EX 0000"), "the old vehicle is gone");
  check(has("WT/OGC/TR/999999"), "the new challan is printed");
  check(!has("WT/OGC/TR/9000006"), "the old challan is gone");
  check(has("REWORKED 5L DEEP KADHAI FLANGE TOOL"), "the edited description is printed");
  check(has("Second line added by the editor"), "the added line is printed");
  check(has("15 DAYS"), "the edited terms are printed");
  check(!has("40 DAYS"), "the old payment window is gone");
  check(has("27,000.00") && has("1,000.00") && has("33,040.00"), "the new figures are printed");
  check(has("9%") && has("18%"), "the tax rates are printed, including IGST at zero");
  check(after.length !== before.length, "the document really did change");

  const neighbourAfter = renderBillDocument(
    [billFromRecord(asRecord(neighbour), neighbour.original.lineItems, COPY_LABEL.original)],
    COPY_LABEL.original
  );
  check(
    neighbourAfter.length === neighbourBefore.length &&
      latin1(neighbourAfter) === latin1(neighbourBefore),
    `sibling ${neighbour.sheetName} is byte-identical, untouched`
  );
}

/* ──────────────────────────────────────────────
   7. Validation
   ────────────────────────────────────────────── */
section("7. validation rejects what it should and accepts what it should");

const rejects = (patch: Record<string, unknown>, why: string): void => {
  try {
    applyPatch(patch as never);
    check(false, `rejects ${why}`);
  } catch (err) {
    check(err instanceof EditError, `rejects ${why}`, err instanceof Error ? err.message : String(err));
  }
};
const accepts = (patch: Record<string, unknown>, why: string): void => {
  try {
    applyPatch(patch as never);
    check(true, `accepts ${why}`);
  } catch (err) {
    check(false, `accepts ${why}`, err instanceof Error ? err.message : String(err));
  }
};

rejects({ invoice_date: "28/09/2026" }, "a non-ISO date");
rejects({ invoice_no: "" }, "an empty invoice number");
rejects({ party_gst_no: "NOTAGST" }, "a malformed GST number");
rejects({ state_code: "Maharashtra" }, "a state name in the state-code field");
rejects({ cgst_rate: 150 }, "a tax rate over 100");
rejects({ line_items: [{ description: "x", quantity: -1 }] }, "a negative quantity");
rejects({ line_items: [{ description: "x", rate: -5 }] }, "a negative rate");
rejects({ line_items: "not a list" }, "line items that are not a list");
rejects({ seller_name: "x".repeat(5000) }, "an over-long name");
accepts(
  { unknown_column: 1 } as Record<string, unknown>,
  "an unknown column, which is ignored rather than being a fatal error"
);
accepts({ cgst_rate: 0.09 }, "a rate typed as a fraction, as printed on the old invoice");
accepts({ round_off: -0.4 }, "a negative round off, which is how a total rounds down");
accepts({ eway_bill_no: null, eway_bill_date: null }, "clearing an optional field");
accepts({ party_address: "" }, "clearing an optional address");
accepts({ line_items: [{ description: "x" }] }, "a line with no quantity or rate");

/* A partial patch must not blank the fields it did not mention. */
const partial = applyPatch({ party_address: "One line only." });
check(
  !("vehicle_number" in partial.values),
  "a partial patch touches only the fields it names"
);
check(
  partial.regenerateWords === false && partial.explicitWords === null,
  "omitting the words leaves the stored wording alone"
);
const cleared = applyPatch({ amount_in_words: null });
check(cleared.regenerateWords === true, "sending null words asks for a regeneration");

/* Blank editor rows are dropped rather than printed as empty table lines. */
const withBlank = applyPatch({
  line_items: [
    { description: "kept", quantity: 1, rate: 100 },
    { description: "   " },
    { description: "also kept", quantity: 2, rate: 200 },
  ],
});
check(withBlank.lineItems?.length === 2, "a blank line row is dropped, not saved");

/* ──────────────────────────────────────────────
   8. The reference block survives an edit
   ────────────────────────────────────────────── */
section("8. the reference block is derived, so it cannot drift from the fields");
if (labour) {
  const rec = asRecord(labour);
  const grid = billFromRecord(rec, labour.original.lineItems, "ORIGINAL").referenceRows;
  check(
    grid.map((r) => r.label).join("|") ===
      "Invoice No.|Our Challan No.|Your Challan No.|Service Order No|Eway Bill No.",
    "all five rows, in the template's order, with the labour order label",
    grid.map((r) => r.label).join("|")
  );
  check(
    grid.every((r) => r.hasDateCell),
    "every row keeps its Date cell, blank or not"
  );
  check(
    grid[4].value === null && grid[4].date === null,
    "the e-way row exists with an empty value"
  );
  const swapped = billFromRecord(
    { ...rec, order_no_label: "Purchase Order No.:" },
    labour.original.lineItems,
    "ORIGINAL"
  );
  check(
    swapped.referenceRows[3].label === "Purchase Order No",
    "the order row names whichever label the bill carries"
  );
}

console.log(failures === 0 ? "\nEDIT CHECKS: all passed." : `\nEDIT CHECKS: ${failures} failure(s).`);
if (failures > 0) process.exitCode = 1;
