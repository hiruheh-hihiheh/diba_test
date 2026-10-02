// _shared/billDocument.ts
//
// ONE bridge between the database and the PDF renderer.
//
// WHY THIS FILE EXISTS
// The renderer draws a `BillCopy`, which is a rich model: a recipient address as
// separate lines, a reference block as ordered rows, bank and terms as line
// arrays, the footer's four phrases named. The `bills` table is a RELATIONAL
// summary. Something has to turn the second into the first.
//
// Before this file, the only such conversion happened implicitly: the workbook was
// parsed and rendered in the same request, so the model existed only in memory and
// was discarded. A bill could therefore never be corrected without re-uploading the
// workbook, which re-created every sibling invoice.
//
// Now a bill is edited and re-printed, so the conversion has to be a real,
// testable function that runs on stored data alone. Keeping it in one place is what
// makes "the PDF is generated from the database" true rather than aspirational: the
// upload path and the edit path both go through `billFromRecord`, so a bill printed
// now and the same bill printed after a save are produced by the same code from the
// same fields.
//
// WHAT IS DERIVED AND WHAT IS STORED
// Derived, deliberately, because storing a second copy would let the two disagree:
//
//   referenceRows   from the flat invoice/challan/order/eway columns, plus
//                   `order_no_label` for whether it reads "Service" or "Purchase"
//   line amounts    quantity x rate
//   totals          from the lines and the stored rates
//
// Stored, because a human decides them and re-deriving them would overwrite a
// decision:
//
//   round_off       9 of the 20 production invoices round, and the rounded figure
//                   is the one that was billed
//   amount_in_words overridable, though `amountInWords()` will regenerate it
//   tax rates       editable, and the point of storing them is that IGST is 0.00 on
//                   every intra-state invoice, so a rate derived from the amount
//                   would vanish exactly when 18% is most worth showing

import type { BillCopy, BillLineItem, CopyKind, ReferenceRow } from "./parseBill.ts";

/* ──────────────────────────────────────────────
   The stored shape
   ────────────────────────────────────────────── */

/**
 * A `bills` row, plus its `bill_line_items`, as the editor and the renderer see it.
 *
 * Deliberately a structural type rather than a database type: the same object
 * arrives from PostgREST (where every `numeric` is a string and every `date` is
 * `YYYY-MM-DD`) and from the editor (where a number the user typed may still be a
 * string). Normalising happens once, in `num()` and `text()`, so no consumer has to
 * remember that `cgst` might be `"675.00"` or `"675"`.
 */
export interface BillRecord {
  id: string;
  sheet_name: string;
  /** Which copy's document is being produced. The three copies differ ONLY here. */
  copy: CopyKind;

  job_kind: string | null;

  invoice_no: string | null;
  invoice_date: string | null;
  our_challan_no: string | null;
  our_challan_date: string | null;
  your_challan_no: string | null;
  your_challan_date: string | null;
  order_no: string | null;
  order_no_label: string | null;
  order_date: string | null;
  eway_bill_no: string | null;
  eway_bill_date: string | null;

  recipient_label: string | null;
  recipient_note: string | null;
  party_name: string | null;
  party_address: string | null;
  party_gst_no: string | null;
  place_of_supply: string | null;
  state: string | null;
  state_code: string | null;

  transporter_mode: string | null;
  vehicle_number: string | null;

  seller_name: string | null;
  seller_descriptor: string | null;
  seller_tax_line: string | null;
  seller_address: string | null;
  seller_contact: string | null;

  total_quantity: number | string | null;
  amount_before_tax: number | string | null;
  cgst: number | string | null;
  cgst_rate: number | string | null;
  sgst: number | string | null;
  sgst_rate: number | string | null;
  igst: number | string | null;
  igst_rate: number | string | null;
  total_gst: number | string | null;
  amount_after_tax: number | string | null;
  reverse_charge_gst: number | string | null;
  round_off: number | string | null;
  amount_in_words: string | null;

  /** Parts object since 0008, a plain array of lines on a pre-0008 row. */
  bank_details: BankDetails | string[] | string | null;
  terms: string | null;
  certification: string | null;
  on_behalf_of: string | null;
  signature_designation: string | null;
  receiver_signature: string | null;
  notes_extra: string | null;
}

/* ──────────────────────────────────────────────
   Bank details
   ────────────────────────────────────────────── */

/**
 * The bank block, stored as label/value parts rather than as a flat array of
 * strings.
 *
 * Each part keeps the LABEL THE WORKBOOK USED, whitespace and punctuation included,
 * so `label + value` reproduces the printed line exactly. The template is not
 * consistent about the gap: "Bank Name: EXAMPLE BANK LTD" has a space after the
 * colon and "IFSC CODE:EXAM0000001" does not. Trimming the label loses that
 * distinction and prints every bank line one space tighter than the original on
 * every re-print.
 *
 * The alternative — a fixed `bank_name` / `account_number` / `branch` / `ifsc_code`
 * set of columns — cannot hold a fifth line, which some templates add (a SWIFT code,
 * a beneficiary name), so this is an object keyed by part rather than four columns.
 */
export interface BankPart {
  label: string;
  value: string;
}

export type BankDetails = Record<string, BankPart>;

/** The four parts this template writes, matched loosely and case-insensitively. */
const BANK_LABELS: { key: string; re: RegExp }[] = [
  { key: "bank_name", re: /bank\s*name/i },
  { key: "account_number", re: /account\s*(no|number)/i },
  { key: "branch", re: /branch/i },
  { key: "ifsc_code", re: /ifsc/i },
];

/** A sensible label for a part the client sent as a bare value. */
export function defaultBankLabel(key: string): string {
  switch (key) {
    case "bank_name":
      return "Bank Name:";
    case "account_number":
      return "ACCOUNT NUMBER:";
    case "branch":
      return "BRANCH:";
    case "ifsc_code":
      return "IFSC CODE:";
    default:
      return `${key}:`;
  }
}

/**
 * Read the workbook's bank lines into label/value parts.
 *
 * The label is everything up to the first character of the value, so
 * `label + value` rebuilds the line byte for byte. A line with no separator at all —
 * "IFSC CODE EXAM0000001" — splits at the first run of whitespace, which is the only
 * place the value can begin. A line that is a label with no value contributes
 * nothing: there is no part to make, and inventing an empty one would add a
 * bank line that the workbook never printed.
 */
export function parseBankLines(lines: string[]): BankDetails {
  const out: BankDetails = {};
  for (const line of lines) {
    const match = BANK_LABELS.find((b) => b.re.test(line));
    if (!match) continue;
    const hit = match.re.exec(line)!;
    const afterLabel = line.slice(hit.index + hit[0].length);

    const colon = afterLabel.indexOf(":");
    const gapStart = colon >= 0 ? colon + 1 : 0;
    const valueStart = afterLabel.slice(gapStart).search(/\S/);
    if (valueStart < 0) continue;

    out[match.key] = {
      label: line.slice(0, hit.index + hit[0].length + gapStart + valueStart),
      value: afterLabel.slice(gapStart + valueStart).trim(),
    };
  }
  return out;
}

/**
 * Rebuild the printed bank lines from their parts, exactly.
 *
 * Accepts the parts object, a legacy array of strings, or null, because all three
 * appear in the database: 0005 wrote an array, 0008 writes parts, and an array is
 * already printable.
 */
export function bankLinesOf(details: BankDetails | string[] | string | null | undefined): string[] {
  if (details === null || details === undefined) return [];
  if (Array.isArray(details)) return details.map((l) => String(l));
  if (typeof details === "string") return lines(details);
  return Object.values(details)
    .filter((p): p is BankPart => !!p && typeof p === "object")
    .map((p) => `${p.label ?? ""}${p.value ?? ""}`.trim())
    .filter((l) => l !== "");
}

/* ──────────────────────────────────────────────
   Normalisation
   ────────────────────────────────────────────── */

/** A trimmed string, or null. An empty invoice field is a BLANK FIELD, not "". */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * A finite number, or null.
 *
 * PostgREST returns `numeric` as a STRING, so "675.00" and 675 must both work.
 * Anything unparseable becomes null rather than NaN: a NaN that reached the PDF
 * would print "NaN" on a tax invoice, and a null prints an empty cell, which is at
 * least visibly a missing figure rather than a wrong one.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** A text field that may legitimately hold several lines. */
function lines(value: string | string[] | null | undefined): string[] {
  if (value === null || value === undefined) return [];
  const arr = Array.isArray(value) ? value : String(value).split(/\r?\n/);
  return arr.map((l) => String(l).trim()).filter((l) => l !== "");
}

/* ──────────────────────────────────────────────
   Money
   ────────────────────────────────────────────── */

/** Two decimal places, the precision every money column is declared with. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Three decimal places, the precision a quantity is declared with. */
export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/* ──────────────────────────────────────────────
   Amount in words
   ────────────────────────────────────────────── */

const ONES = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
  "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
  "EIGHTEEN", "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

/** 0..999 in words, no scale word. */
function underThousand(n: number): string {
  if (n <= 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const o = n % 10;
    return o ? `${t} ${ONES[o]}` : t;
  }
  const hundreds = `${ONES[Math.floor(n / 100)]} HUNDRED`;
  const rest = n % 100;
  if (rest === 0) return hundreds;
  // "AND" before a trailing two-digit group, which is the convention on this
  // template: the workbook writes "EIGHTY THOUSAND EIGHT HUNDRED AND FIFTY ONLY"
  // for 88,500, not "EIGHTY THOUSAND EIGHT HUNDRED FIFTY ONLY".
  return rest < 100 ? `${hundreds} AND ${underThousand(rest)}` : `${hundreds} ${underThousand(rest)}`;
}

/**
 * A rupee amount in the words an Indian invoice uses.
 *
 * Built by consuming the amount one scale at a time (crore, lakh, thousand, then the
 * remainder under a thousand), so 12,34,567 reads as "TWELVE LAKH THIRTY FOUR
 * THOUSAND FIVE HUNDRED AND SIXTY SEVEN", which is both how the amount is said and
 * how the workbook writes it.
 *
 * It regenerates the words only when the user asks for it. An imported bill keeps
 * the business's own phrasing in `amount_in_words`, because replacing that silently
 * on every save would alter the printed invoice for no reason anyone asked for.
 */
export function amountInWords(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const negative = value < 0;
  const abs = Math.abs(round2(value));
  const whole = Math.floor(abs);
  const paise = Math.round((abs - whole) * 100);

  if (whole === 0 && paise === 0) return "ZERO ONLY";

  const parts: string[] = [];
  const scales: [number, string][] = [
    [1e7, "CRORE"],
    [1e5, "LAKH"],
    [1e3, "THOUSAND"],
  ];
  let rest = whole;
  for (const [size, word] of scales) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${underThousand(n)} ${word}`);
      rest -= n * size;
    }
  }
  if (rest > 0) {
    // "AND" before a trailing group of fewer than a hundred, once anything has
    // gone before it: THIRTY THREE THOUSAND AND FORTY, not THIRTY THREE THOUSAND
    // FORTY. `underThousand` handles the same convention inside a hundreds group.
    parts.push(parts.length > 0 && rest < 100 ? `AND ${underThousand(rest)}` : underThousand(rest));
  }
  if (paise > 0) {
    parts.push(whole > 0 ? `AND ${underThousand(paise)} PAISE` : `${underThousand(paise)} PAISE`);
  }

  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return `${negative ? "MINUS " : ""}${text} ONLY`;
}

/* ──────────────────────────────────────────────
   The reference block
   ────────────────────────────────────────────── */

/**
 * Rebuild the invoice's reference block from the flat columns.
 *
 * The block is a fixed part of the template — five rows, each with a `Date:`
 * sub-cell, in this order — and every row is emitted whether or not it has a
 * value. That is the whole point: "Your Challan No." and "Eway Bill No." are blank
 * on most production sheets, and they are still ROWS of the invoice. A renderer
 * that only received non-empty values would have to guess whether a gap means
 * "this template has no such field" (drop the row) or "this invoice left it blank"
 * (keep the row), and only the second is true.
 *
 * The labels reproduce the parser's own exactly, including the order row's missing
 * full stop, so a bill printed from the database is laid out identically to the
 * same bill printed from the workbook.
 */
export function referenceRowsFromFields(record: BillRecord): ReferenceRow[] {
  const date = (value: string | null): string | null => {
    // A `date` column arrives as YYYY-MM-DD; anything else is kept verbatim so an
    // unparseable value is visible on the invoice rather than silently dropped.
    return value && value.trim() !== "" ? value.trim() : null;
  };

  // "Service Order No.:" / "Purchase Order No.:" — the client uses both on the same
  // template, and the invoice has to name the one that was actually filled in.
  const orderLabel = (record.order_no_label ?? "Order No.")
    .replace(/[:.\s]+$/, "")
    .trim();

  return [
    { label: "Invoice No.", value: text(record.invoice_no), date: date(record.invoice_date), hasDateCell: true },
    { label: "Our Challan No.", value: text(record.our_challan_no), date: date(record.our_challan_date), hasDateCell: true },
    { label: "Your Challan No.", value: text(record.your_challan_no), date: date(record.your_challan_date), hasDateCell: true },
    { label: orderLabel, value: text(record.order_no), date: date(record.order_date), hasDateCell: true },
    { label: "Eway Bill No.", value: text(record.eway_bill_no), date: date(record.eway_bill_date), hasDateCell: true },
  ];
}

/* ──────────────────────────────────────────────
   Totals
   ────────────────────────────────────────────── */

/** The totals the editor recalculates and the renderer prints. */
export interface ComputedTotals {
  totalQuantity: number | null;
  amountBeforeTax: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  amountAfterTax: number;
}

export interface TotalsInput {
  lineItems: BillLineItem[];
  cgstRate: number | null;
  sgstRate: number | null;
  igstRate: number | null;
  /**
   * Which of the three taxes this bill actually charges.
   *
   * Not derivable from the rates. Every sheet in the production workbook prints all
   * three slab rates (9 / 9 / 18) as a reference table, but an intra-state supply
   * charges CGST and SGST and shows IGST 0.00, while an inter-state one does the
   * opposite. Charging every rated tax would turn a 77,290.00 bill into an 89,080.00
   * bill, so applicability is a property of the supply and is carried explicitly.
   *
   * `applicableFromAmounts` derives it from what the bill already charges.
   */
  applies?: TaxApplicability;
  /** Kept, not recomputed: it is the rounding a human applied. */
  roundOff: number | null;
}

export interface TaxApplicability {
  cgst: boolean;
  sgst: boolean;
  igst: boolean;
}

/**
 * Which taxes a bill charges, from the amounts it already charges.
 *
 * With no amounts at all — a bill created by hand rather than imported — every rated
 * tax is treated as applicable, because there is nothing to inherit and a rate the
 * user typed is a rate they meant to use.
 */
export function applicableFromAmounts(
  cgst: number | null,
  sgst: number | null,
  igst: number | null
): TaxApplicability {
  const charged = (cgst ?? 0) !== 0 || (sgst ?? 0) !== 0 || (igst ?? 0) !== 0;
  if (!charged) return { cgst: true, sgst: true, igst: true };
  return {
    cgst: (cgst ?? 0) !== 0,
    sgst: (sgst ?? 0) !== 0,
    igst: (igst ?? 0) !== 0,
  };
}

/** A one-word description of the supply, for the editor to show. */
export function supplyTypeOf(applies: TaxApplicability): "INTER_STATE" | "INTRA_STATE" {
  return applies.igst && !applies.cgst && !applies.sgst ? "INTER_STATE" : "INTRA_STATE";
}

/**
 * The line amount, and the totals, exactly as the workbook computes them.
 *
 * Verified against all 20 production invoices:
 *
 *     line amount       = quantity x rate
 *     amount_before_tax = SUM(line amount)
 *     tax               = base x rate / 100, for the taxes that apply
 *     amount_after_tax  = before + total_gst + round_off
 *
 * The last line is why `roundOff` is a parameter and not a step. On 8 of the 20
 * sheets the pre-rounding total and the printed total differ by up to 0.50 - 302
 * ends at 19,800.40 and prints 19,800.00 - and the difference IS the round off. A
 * "total = before + gst" rule would print 19,800.40 on an invoice that was billed
 * 19,800.00.
 *
 * A line with a quantity and a rate but no stored amount is computed; a line with
 * only an amount (a fixed charge the workbook wrote as a figure) keeps it. Both
 * cases occur and neither is a guess.
 */
export function computeTotals(input: TotalsInput): ComputedTotals {
  const items = input.lineItems.map((item) => {
    const amount =
      item.quantity !== null && item.rate !== null ? round2(item.quantity * item.rate) : item.amount;
    return { ...item, amount };
  });

  const withAmounts = items.filter((i) => i.amount !== null);
  const amountBeforeTax = round2(withAmounts.reduce((sum, i) => sum + (i.amount ?? 0), 0));
  const quantities = items.map((i) => i.quantity).filter((q): q is number => q !== null);

  const applies = input.applies ?? { cgst: true, sgst: true, igst: true };
  const tax = (rate: number | null, applicable: boolean): number =>
    !applicable || rate === null || rate === 0 ? 0 : round2((amountBeforeTax * rate) / 100);

  const cgst = tax(input.cgstRate, applies.cgst);
  const sgst = tax(input.sgstRate, applies.sgst);
  const igst = tax(input.igstRate, applies.igst);
  const totalGst = round2(cgst + sgst + igst);

  return {
    totalQuantity: quantities.length > 0 ? round3(quantities.reduce((a, b) => a + b, 0)) : null,
    amountBeforeTax,
    cgst,
    sgst,
    igst,
    totalGst,
    amountAfterTax: round2(amountBeforeTax + totalGst + (input.roundOff ?? 0)),
  };
}

/* ──────────────────────────────────────────────
   Parse -> record
   ────────────────────────────────────────────── */

/**
 * The `bills` row for a worksheet.
 *
 * Values come from the ORIGINAL copy, and that is a deliberate choice: the three
 * blocks are three physical copies of ONE invoice, and ORIGINAL is the one an auditor
 * treats as the record. It is also the copy all three printed documents are rendered
 * from, so the row, the original, the duplicate and the triplicate can never disagree
 * with each other.
 *
 * The copies are not always identical in the source — `copyDisagreements` finds and
 * reports those — so this is a resolution, not a proof. It is recorded in the audit
 * log rather than applied silently, because deciding which of two values is correct
 * is a business decision and not one to make on the user's behalf.
 *
 * Every field the editor exposes is written HERE, at import, not left to be filled in
 * later. A bill that imported without its address, its tax rates or its footer
 * wording would open in the editor showing blanks for data the workbook actually
 * contained, which is how "the editor lost my address" happens.
 *
 * It lives here rather than in `process-bill-upload/index.ts` so the self-test can
 * run the real upload mapping, and a field added to the parser but forgotten in the
 * insert fails a test instead of silently producing a bill that cannot be edited.
 */
export function toBillRecord(
  parsed: { sheetName: string; original: BillCopy },
  uploadId: string
): Record<string, unknown> {
  const o = parsed.original;
  return {
    bill_upload_id: uploadId,
    sheet_name: parsed.sheetName,
    invoice_no: o.invoiceNo,
    invoice_date: o.invoiceDate,
    our_challan_no: o.ourChallanNo,
    our_challan_date: o.ourChallanDate,
    your_challan_no: o.yourChallanNo,
    your_challan_date: o.yourChallanDate,
    order_no: o.orderNo,
    order_no_label: o.orderNoLabel,
    order_date: o.orderDate,
    eway_bill_no: o.ewayBillNo,
    eway_bill_date: o.ewayBillDate,
    place_of_supply: o.placeOfSupply,
    state: o.state,
    state_code: o.stateCode,
    transporter_mode: o.transporterMode,
    vehicle_number: o.vehicleNumber,
    party_gst_no: o.partyGstNo,
    party_name: o.partyName,
    // One source line per row, newlines intact, so the invoice prints the address
    // with the line breaks the workbook gave it.
    party_address: o.partyAddress.length > 0 ? o.partyAddress.join("\n") : null,
    recipient_label: o.recipientHeading,
    recipient_note: o.recipientNote,
    total_quantity: o.totalQuantity,
    amount_before_tax: o.amountBeforeTax,
    cgst: o.cgst,
    cgst_rate: o.cgstRate,
    sgst: o.sgst,
    sgst_rate: o.sgstRate,
    igst: o.igst,
    igst_rate: o.igstRate,
    total_gst: o.totalGst,
    amount_after_tax: o.amountAfterTax,
    reverse_charge_gst: o.reverseChargeGst,
    round_off: o.roundOff,
    amount_in_words: o.amountInWords,
    job_kind: o.jobKind,
    seller_name: o.sellerName,
    seller_descriptor: o.sellerDescriptor,
    seller_tax_line: o.sellerTaxLine,
    seller_contact: o.sellerContact,
    // Also kept as the joined display string, because 0005 rows and the bill detail
    // screen read it and splitting it would be a silent change for them.
    seller_address: [o.sellerTaxLine, o.sellerAddress, o.sellerContact]
      .filter((part): part is string => !!part)
      .join("\n") || null,
    // Label/value parts rather than a flat array, so the editor can offer a field per
    // part; each part keeps the label the workbook used, so `label + value`
    // reproduces the printed line exactly.
    bank_details: o.bankLines.length > 0 ? parseBankLines(o.bankLines) : null,
    terms: o.termsLines.length > 0 ? o.termsLines.join("\n") : null,
    certification: o.certification,
    on_behalf_of: o.onBehalfOf,
    signature_designation: o.signatureDesignation,
    receiver_signature: o.receiverSignature,
    notes_extra: o.notesExtra.length > 0 ? o.notesExtra.join("\n") : null,
  };
}

/* ──────────────────────────────────────────────
   Record -> renderer model
   ────────────────────────────────────────────── */

/**
 * Turn a stored bill into the model the renderer draws.
 *
 * The seller block needs one fallback that is worth calling out: 0005 packed the
 * seller's descriptor, tax line and contact into `seller_address`, joined by
 * newlines, because that column was only ever displayed. Migration 0008 stores the
 * three separately. A row that predates 0008 is therefore split back out of the
 * joined string, and a row that has neither is left empty rather than being given a
 * made-up company.
 */
export function billFromRecord(
  record: BillRecord,
  lineItems: BillLineItem[],
  copyLabel: string
): BillCopy {
  /* The seller's four header lines.
     `seller_address` is the JOINED display string that 0005 wrote — [tax line,
     address, contact], joined by newlines, skipping any that was null — and
     `toBillRecord` still writes it that way for the detail screen.

     For a row that also has the split columns (0008 onwards) the address is
     recovered by SET DIFFERENCE rather than by position: the joined string is
     exactly the non-null subset of the three, so whatever is left once the tax line
     and the contact are removed is the address. Positional indexing cannot do this,
     because the positions shift with which fields are present — and getting it wrong
     prints the GST line where the address should be, which is what happened when the
     three lines were read back as [taxLine, address, contact] with a column
     mismatch.

     A pre-0008 row has only the joined string, so the positions are used as a
     best-effort split. That is a real limitation and is why 0008 exists: the
     descriptor was never stored at all, so it cannot be recovered for an old row and
     is left empty rather than invented. */
  const sellerLegacy = lines(record.seller_address);
  const hasSplitSeller =
    text(record.seller_descriptor) !== null ||
    text(record.seller_tax_line) !== null ||
    text(record.seller_contact) !== null;

  let descriptor: string | null;
  let taxLine: string | null;
  let contact: string | null;
  let address: string | null;

  if (hasSplitSeller) {
    descriptor = text(record.seller_descriptor);
    taxLine = text(record.seller_tax_line);
    contact = text(record.seller_contact);
    const known = new Set([taxLine, contact].filter((s): s is string => s !== null));
    const rest = sellerLegacy.filter((l) => !known.has(l));
    address = rest.length > 0 ? rest.join("\n") : null;
  } else {
    descriptor = null;
    taxLine = sellerLegacy[0] ?? null;
    address = sellerLegacy[1] ?? null;
    contact = sellerLegacy[2] ?? null;
  }

  // The stored figures are the record of what was billed. `computeTotals` is what
  // the EDITOR recalculates from a change; a re-print of an untouched bill must
  // print the stored figures, not a re-derivation that could drift by a rounding
  // step from what the customer was charged.
  const totalQuantity = num(record.total_quantity);
  const amountBeforeTax = num(record.amount_before_tax);
  const cgst = num(record.cgst);
  const sgst = num(record.sgst);
  const igst = num(record.igst);
  const totalGst = num(record.total_gst);
  const amountAfterTax = num(record.amount_after_tax);

  return {
    kind: record.copy,
    label: copyLabel,
    // Diagnostics only; there is no source row once the bill lives in the database.
    firstRow: 0,
    lastRow: 0,

    sellerName: text(record.seller_name),
    sellerDescriptor: descriptor,
    sellerTaxLine: taxLine,
    sellerAddress: address,
    sellerContact: contact,

    recipientHeading: text(record.recipient_label),
    recipientNote: text(record.recipient_note),
    partyName: text(record.party_name),
    partyAddress: lines(record.party_address),
    partyGstNo: text(record.party_gst_no),

    invoiceNo: text(record.invoice_no),
    invoiceDate: text(record.invoice_date),
    ourChallanNo: text(record.our_challan_no),
    ourChallanDate: text(record.our_challan_date),
    yourChallanNo: text(record.your_challan_no),
    yourChallanDate: text(record.your_challan_date),
    orderNo: text(record.order_no),
    orderNoLabel: text(record.order_no_label),
    orderDate: text(record.order_date),
    ewayBillNo: text(record.eway_bill_no),
    ewayBillDate: text(record.eway_bill_date),
    referenceRows: referenceRowsFromFields(record),
    placeOfSupply: text(record.place_of_supply),
    state: text(record.state),
    stateCode: text(record.state_code),
    transporterMode: text(record.transporter_mode),
    vehicleNumber: text(record.vehicle_number),

    lineItems: lineItems.map((item, index) => ({
      srNo: item.srNo ?? index + 1,
      description: item.description ?? "",
      hsnCode: item.hsnCode,
      uom: item.uom,
      quantity: item.quantity,
      rate: item.rate,
      amount: item.amount,
    })),
    totalQuantity,
    amountBeforeTax,
    cgst,
    sgst,
    igst,
    totalGst,
    amountAfterTax,
    reverseChargeGst: num(record.reverse_charge_gst),
    roundOff: num(record.round_off),
    amountInWords: text(record.amount_in_words),
    jobKind: text(record.job_kind),

    cgstRate: num(record.cgst_rate),
    sgstRate: num(record.sgst_rate),
    igstRate: num(record.igst_rate),

    bankLines: bankLinesOf(record.bank_details),
    termsLines: lines(record.terms),

    // Rebuilt from the four named phrases rather than kept as one blob, so each is
    // separately editable and the signature block lands in the right column. The
    // receiver's caption is the only signature line, so the supplier's block is
    // rebuilt from `notes` by the renderer's own `splitFooter`.
    signatureLines: [text(record.receiver_signature) ?? "(Receivers Signature)"],
    notes: [text(record.certification), text(record.on_behalf_of), text(record.signature_designation)]
      .filter((l): l is string => l !== null)
      .concat(lines(record.notes_extra)),

    certification: text(record.certification),
    onBehalfOf: text(record.on_behalf_of),
    signatureDesignation: text(record.signature_designation),
    receiverSignature: text(record.receiver_signature),
    notesExtra: lines(record.notes_extra),
  };
}
