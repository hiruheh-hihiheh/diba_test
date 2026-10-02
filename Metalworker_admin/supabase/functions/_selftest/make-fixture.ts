// supabase/functions/_selftest/make-fixture.ts
//
// BUILDS THE SANITIZED SINGLE-COPY FIXTURE: `test-bills-sanitized.xlsx`.
//
// WHY A GENERATOR AND NOT A COMMITTED REAL FILE
// The acceptance workbook for flexible copies was a real invoice, and a real
// invoice carries a customer's name, address, GST numbers and bank account. Those
// do not belong in a repository. So the fixture is generated from the real
// workbook's LAYOUT with the identifying values replaced, and the real file is
// never committed.
//
// WHAT IS SANITIZED
// Every value that could identify a business or an account: seller and recipient
// names, addresses, the city and the place of supply, GST and MSME numbers,
// e-mail addresses, phone numbers, bank name / account number / branch / IFSC,
// the vehicle number, and the invoice, challan and order numbers.
//
// The postal address and the place of supply used to be left as the real city
// and the real estate name. That was not a deliberate trade-off: the list above
// already claimed "addresses" were sanitized, and they were not.
// `test-fixture-hygiene.ts` now scans every committed workbook for the real
// locality and is what caught it, so the two cannot drift apart again.
//
// WHAT IS DELIBERATELY NOT CHANGED
// The structure and the arithmetic, because those are what the test is for:
//
//   * the sheet is 49 rows x 8 columns with its ORIGINAL marker at B2
//   * ORIGINAL is the ONLY copy marker — no DUPLICATE, no TRIPLICATE
//   * the header sentence "Original Copy of Invoice for Receipt ... Duplicate &
//     Triplicate Supplier or Transporter" is KEPT, because the exact-match copy
//     detection has to survive it
//   * the line-item table, its squashed headers and its HSN/UOM columns
//   * 1 x 9,000 = 9,000, then 9% CGST 810 + 9% SGST 810 + 18% IGST 0 = 1,620,
//     giving 10,620, round off 0, and the same words for that amount
//   * LABOUR JOB, the blank "Your Challan No." / "Eway Bill No." rows, the bank
//     block, the four footer rows, and every trailing space, because the trailing
//     spaces are part of the printed invoice
//   * "State: Maharashtra  State Code:27" and the state code 27 itself. The state
//     code is what selects CGST+SGST against IGST in the tax identity, so
//     changing it would change the arithmetic under test; and a state name is not
//     an identifier — tens of thousands of businesses operate in it.
//
// Rerun with:  node supabase/functions/_selftest/make-fixture.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Sheet, SheetCell } from "../process-bill-upload/_shared/xlsx.ts";
import { writeXlsx } from "./write-xlsx.ts";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");
const OUT = resolve(REPO, "test-bills-sanitized.xlsx");

/* ── The fake business ──────────────────────────────────────────────────
   Obviously not real: the GSTIN keeps the legal 15-character shape so the
   parser's label handling is genuinely exercised, but the digits are invented. */
const SELLER = "EXAMPLE ENGINEERING WORKS";
const PARTY = "M/s. Sample Traders Ltd.,";

/** date serials are Excel's; the three distinct dates keep that structure */
const D_INVOICE = 46293;
const D_CHALLAN = 46293;
const D_PARTY_CHALLAN = 46289;
const D_ORDER = 46292;

type Cell = [row: number, col: number, value: string | number];

const ROWS: Cell[] = [
  // ── header ────────────────────────────────────────────────────────────
  [1, 1, "ORIGINAL"],
  [2, 1, "TAX INVOICE"],
  [3, 1, SELLER],
  [4, 1, "Manufacturing Traders of Machinery,Precision Job Works & Industrial Products"],
  [5, 1, "GST No.27AAAPE1234F1Z9  MSME NO.UDYAM-MH-00-0000001"],
  [6, 1, "Office Address: Unit No.1,GalaNo.2 & 3,NearExample Circle,Road No.28,Example Nagar,Example Estate,Example City - 000 001,State- Maharashtra"],
  [7, 1, "Email (1):example1@example.com Email(2): example2@example.com Mob.9000000001 & 9000000002"],

  /* The copy marker row, and the sentence that must NOT be read as two more
     copies. Both are part of the template's shape, not customer data. */
  [8, 1, "Details of Receipient (Billed To)"],
  [8, 3, "Original Copy of Invoice for Receipt                                            Duplicate & Triplicate Supplier or Transporter"],

  // ── recipient (Billed To) ──────────────────────────────────────────────
  [9, 1, PARTY],
  [10, 1, 'C-21,22 "U" Road,'],
  [11, 1, "Example Industrial Estate,"],
  [12, 1, "Example City - 000 001."],

  // ── right-hand reference block ─────────────────────────────────────────
  [9, 3, "INVOICE NO.:"],
  [9, 5, "TEST/001/2026-27"],
  [9, 6, "Date: "],
  [9, 7, D_INVOICE],

  [10, 3, "Our Challan No.:"],
  [10, 5, "TEST/001/2026-27"],
  [10, 6, "Date: "],
  [10, 7, D_CHALLAN],

  /* A present-but-blank challan row: the reference block keeps the row and
     records a null value, which is the case the invoice has to print. */
  [11, 3, "Your Challan No.:"],
  [11, 5, "TEST/OGC/TR/2600001"],
  [11, 6, "Date: "],
  [11, 7, D_PARTY_CHALLAN],

  [12, 3, "Service Order No.:"],
  [12, 5, "TEST/SO/2600001"],
  [12, 6, "Date: "],
  [12, 7, D_ORDER],

  [13, 1, "                                                                          "],
  [13, 3, "Eway Bill No.:"],
  [13, 5, "                                                                     "],
  [13, 6, "Date: "],

  [14, 1, "State: Maharashtra       State Code:27"],
  [14, 3, "PLACE OF SUPPLY"],
  /* The place of supply is a real city in the original. It is padded to 31
     characters to line the printed box up, and the replacement is padded to the
     same width so the layout is unchanged. */
  [14, 5, "EXAMPLE CITY" + " ".repeat(19)],
  [14, 6, "STATE CODE:27"],

  [15, 1, "Party's GST No.27BBBCG5678N2Z4"],
  [15, 3, "Transporter Mode"],
  /* "VEHICLE NO." with its trailing spaces: the parser normalises this to
     "VEHICLE", so the shape matters even though the vehicle number is fake. */
  [15, 5, "VEHICLE NO.  "],
  [15, 6, "MH 01 AB 1234"],

  // ── the line-item table ────────────────────────────────────────────────
  [17, 1, "SR.NO."],
  [17, 2, "D E S C R I P T I O N"],
  [17, 3, "HSN CODE"],
  [17, 4, "UOM"],
  [17, 5, "Quantity"],
  [17, 6, "Rate"],
  [17, 7, "Amount"],

  [18, 1, 1],
  [18, 2, "STD SS BODY BOTTOM FLATTENING TOOL-TOOL FOR HARD"],
  [18, 3, 82073000],
  [18, 4, "NOS"],
  [18, 5, 1],
  [18, 6, 9000],
  [18, 7, 9000],
  /* The description continues on its own row, as the real invoice does — a
     multi-line description is a case the parser has to join. */
  [19, 2, "CNC TR &amp POL"],

  // ── totals + job type ──────────────────────────────────────────────────
  [32, 1, "LABOUR JOB"],
  [32, 3, "Total Quantity"],
  [32, 5, 1],

  [33, 5, "Total Amount Before Tax"],
  [33, 7, 9000],

  /* The rates are written as FRACTIONS beside "ADD: CGST", exactly as the
     template does, so the fraction-to-percent conversion is still exercised. */
  [34, 1, "Bank Details:"],
  [34, 5, "ADD:  CGST"],
  [34, 6, 0.09],
  [34, 7, 810],

  [35, 1, "Bank Name: EXAMPLE BANK LTD"],
  [35, 5, "ADD:  SGST"],
  [35, 6, 0.09],
  [35, 7, 810],

  [36, 1, "ACCOUNT NUMBER:00000000000"],
  [36, 5, "ADD:  IGST"],
  [36, 6, 0.18],
  [36, 7, "-"],

  [37, 1, "BRANCH: SAMPLE BRANCH"],
  [37, 5, "Total Amount :GST"],
  [37, 7, 1620],

  [38, 1, "IFSC CODE:EXAM0000001"],
  [38, 5, "Total Amount After Tax"],
  [38, 7, 10620],

  [39, 5, "GST Payable on reverse"],

  [40, 1, "Total Invoice Amount in Words:- TEN  THOUSAND SIX HUNDRED AND TWENTY ONLY"],
  [40, 5, "Round Off"],

  // ── footer ─────────────────────────────────────────────────────────────
  /* " E & O.E" keeps its leading space: it is what the invoice prints. */
  [42, 1, " E & O.E"],
  [42, 4, "Certified that the particulars given above are true and correct"],

  [43, 1, "Terms & Conditions:"],
  [43, 4, `For ${SELLER}`],
  [44, 1, "1.Payment requested within 40 DAYS"],
  [45, 1, "2. Payment requested by crossed PAYEES A/C.CHEQUE/NEFT/RTGS only."],
  [46, 1, "3.Goods supplied to order will not be return back"],

  [48, 1, "(Receivers Signature)"],
  [48, 7, "(Proprietor)"],
];

const cells = new Map<string, SheetCell>();
for (const [row, col, value] of ROWS) {
  cells.set(`${row}:${col}`, {
    row,
    col,
    type: typeof value === "number" ? "number" : "inline",
    value,
  });
}

/* 49 rows x 8 columns (0-based 48 x 7), matching the real sheet's extent. */
const sheet: Sheet = { name: "Sheet1", cells, maxRow: 48, maxCol: 7 };

writeFileSync(OUT, writeXlsx([sheet]));
console.log(`wrote ${OUT}`);
console.log(`  ${ROWS.length} cells, ${sheet.maxRow + 1} rows x ${sheet.maxCol + 1} columns`);
console.log("  ONE copy marker only (ORIGINAL) — no DUPLICATE, no TRIPLICATE");