// Metalworker_desktop/src/services/creatorForm.ts
//
// THE PART OF THE BILL CREATOR THAT IS THE BROWSER'S, NOT THE SERVER'S.
//
// WHY A MODULE AND NOT A COMPONENT
//
// Everything here is pure: it takes the values a form is holding and returns the patch
// the `create-bill` function should receive, the totals to print beside the line items,
// and the fields to draw attention to. No network, no React, no Supabase client.
//
// That split is deliberate, because it is the only way two questions can be answered
// honestly:
//
//   * "would this bill produce the same PDF as the imported one?" is decided by the
//     server, and this module must not be able to influence it;
//   * "what does the admin see while they type?" is decided by the browser, and it has
//     to agree with the server or the preview lies.
//
// Putting the form's arithmetic in a pure module lets `_selftest/test-bill-creator.ts`
// compare it against the canonical functions directly, with no DOM and no stub. A
// component could only be tested by rendering it, and the arithmetic inside it would be
// invisible to a test that only checked the rendered numbers.
//
// IT IS A MIRROR, NOT A SECOND IMPLEMENTATION
//
// The desktop app (Electron/Vite) and this Expo admin app cannot import from a Deno edge
// function directory through their bundlers, and duplicating this logic into two apps
// would be exactly the "second implementation" this feature is supposed to avoid.
//
// So this file is copied verbatim to `Metalworker_desktop/src/services/creatorForm.ts`,
// and the copy is byte-identical from line 2 onwards. `test-bill-creator.ts` asserts that
// with a byte comparison AND runs both modules over the same inputs, because a byte
// comparison alone would be satisfied by two files that differ only in a comment while
// the behaviour check is what actually matters. To change it, change it here and re-run:
//
//   powershell -File scripts/sync-bill-creator-mirrors.ps1
//
// A field added to the shared patch and forgotten in either client then fails a test
// rather than silently dropping the admin's typing on one platform and not the other.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not decide validity. `validateForFinalize` on the server is the authority, and
// this file deliberately has no opinion about whether an invoice number is present —
// because a form that blocks a save the server would allow is a form that cannot be
// filled in at all, and a form that allows one the server refuses is worse. Errors come
// back from the server with the field they belong to, and that is where they are shown.

/**
 * `BankDetails`, as the stored shape. Restated rather than imported: this file is copied
 * verbatim into both clients, and an import of the edge function's own modules would make
 * that copy unbuildable. `test-bill-creator.ts` compares every client copy against this
 * one, so a change here that is not carried across fails a test rather than producing two
 * different forms.
 */
export interface BankPart {
  label: string;
  value: string;
}
export interface BankDetails {
  bank_name?: BankPart;
  account_number?: BankPart;
  branch?: BankPart;
  ifsc_code?: BankPart;
}

/** The label/value split of one printed bank line, in the order this template prints. */
const BANK_LABELS: { key: keyof BankDetails; re: RegExp }[] = [
  { key: "bank_name", re: /bank\s*name/i },
  { key: "account_number", re: /account\s*(no|number)/i },
  { key: "branch", re: /branch/i },
  { key: "ifsc_code", re: /ifsc/i },
];

/**
 * The order the Bank Details section shows its four fields in, and the order a block
 * built from the profile is printed in.
 *
 * Deliberately the PROFILE's order — branch, name, IFSC, account — rather than the
 * alphabetical or declaration order, because that is the order `mergeBankLines` writes
 * them in on the server. A bill whose bank came from the profile therefore shows its
 * four boxes in exactly the order the invoice will print them, which is the only way an
 * admin can check the document against the form by eye.
 *
 * A block the WORKBOOK supplied keeps the workbook's own order, because that order is
 * the printed document's and re-sorting it would be a second, silent change to an
 * invoice that already exists.
 */
const BANK_FIELD_ORDER: readonly (keyof BankDetails)[] = [
  "branch",
  "bank_name",
  "ifsc_code",
  "account_number",
];

/**
 * The same four, with the label each section shows above them.
 *
 * One list rather than a constant next to a form that spells them out, because the form
 * iterates this and a field added here but not there is a bank line nobody can type.
 * Deliberately NOT the printed label — "Bank Name:" with its colon belongs to the
 * document, while "Bank name" is a form label, and conflating them is how a form ends up
 * typing a colon into a field.
 */
export const BANK_FIELD_ORDER_LABEL: readonly { key: keyof BankDetails; label: string }[] = [
  { key: "branch", label: "Branch" },
  { key: "bank_name", label: "Bank name" },
  { key: "ifsc_code", label: "IFSC code" },
  { key: "account_number", label: "Account number" },
];

/**
 * This template's label for a bank part, WITHOUT a separator.
 *
 * No trailing space, and the workbook's own capitalisation. Both are load-bearing:
 * `parseBankLines` puts the gap after the colon INSIDE the label, so a label is only
 * correct for a part being built from nothing, and the profile's own merge adds its own
 * space (`profileBankLabel`). The strings are the server's `defaultBankLabel` exactly —
 * a different capitalisation here would print "Bank Name:" on a new bill and "BANK
 * NAME:" on a profile merge of the same data, which is the kind of difference nobody
 * reports and everybody sees.
 */
function defaultBankLabel(key: keyof BankDetails): string {
  switch (key) {
    case "bank_name":
      return "Bank Name:";
    case "account_number":
      return "ACCOUNT NUMBER:";
    case "branch":
      return "BRANCH:";
    default:
      return "IFSC CODE:";
  }
}

/**
 * Printed bank lines into their label/value parts, so a form can show them as fields.
 *
 * The label keeps the whole gap between itself and its value — including the space after
 * the colon — because `label + value` has to rebuild the workbook's line exactly. That is
 * the rule the server's `parseBankLines` follows and the reason `test-bill-creator.ts`
 * also pins the byte-for-byte round trip: trimming here would make an edited bank print
 * `Bank Name:EXAMPLE BANK`.
 */
export function parseBankLines(lines: readonly string[]): BankDetails {
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

/** A bank block back to the lines the invoice prints. */
export function bankLinesOf(details: BankDetails | string[] | string | null | undefined): string[] {
  if (details === null || details === undefined) return [];
  if (Array.isArray(details)) return details.map((l) => String(l));
  if (typeof details === "string") {
    return details
      .split(/\r\n?|\n/)
      .filter((line) => line.trim() !== "");
  }
  return Object.values(details)
    .filter((p): p is BankPart => !!p && typeof p === "object")
    .map((p) => `${p.label ?? ""}${p.value ?? ""}`.trim())
    .filter((l) => l !== "");
}

/** Money to two decimals, the way the invoice prints it. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Quantities to three decimals, the column's own precision. */
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** One printed line item, in the shape the server stores. */
export interface BillLineItem {
  srNo: number | null;
  description: string;
  hsnCode: string | null;
  uom: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
}

/** A line item as `applyPatch` accepts it. */
export interface LineItemPatch {
  sr_no?: number | string | null;
  description?: string | null;
  hsn_code?: string | null;
  uom?: string | null;
  quantity?: number | string | null;
  rate?: number | string | null;
  amount?: number | string | null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Terms and Conditions
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The placeholders a stored term or footer line may contain.
 *
 * The server's list, restated so the form can show an admin which of their typing is a
 * variable rather than literal text. `PAYMENT_DAYS` is the one that matters: it is how a
 * payment window travels from the Business Profile onto a bill that did not decide one
 * itself, and the creator offers it rather than asking somebody to remember the syntax.
 *
 * Two, deliberately. A third variable would be a third thing the server, both clients and
 * every profile screen have to agree about, and the requirement is that the placeholder
 * set stays what the existing renderer already understands — not that this form invents
 * more of them.
 */
export const TEMPLATE_VARIABLES: readonly string[] = ["PAYMENT_DAYS", "COMPANY_NAME"];

/** Substitute the supported variables in one line. */
export function fillTemplate(text: string, values: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{([A-Z_]+)\}/g, (whole, name: string) => {
    if (!TEMPLATE_VARIABLES.includes(name)) return whole;
    const value = values[name];
    if (value === null || value === undefined || value === "") return whole;
    return String(value);
  });
}

/** The stored terms as the three lines the Terms & Conditions section edits. */
export function readTerms(value: string | string[] | null | undefined): [string, string, string] {
  const lines = Array.isArray(value)
    ? value.map((line) => String(line))
    : String(value ?? "")
        .split(/\r\n?|\n/)
        .filter((line) => line.trim() !== "");
  return [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
}

/**
 * The three term lines as one `terms` value, or null when all three are empty.
 *
 * Null rather than an empty string, because an empty string would be written to the
 * column and then read back as a real value that the profile can no longer fill — the
 * "blank means empty" rule the rest of the invoice follows.
 */
export function termsToPatch(terms: readonly [string, string, string]): string[] | null {
  const lines = terms.map((line) => line.trim()).filter((line) => line !== "");
  return lines.length === 0 ? null : lines;
}

/**
 * How many payment days a bill's own terms ask for.
 *
 * The point of this is to tell "this invoice says 30 days" apart from "this invoice says
 * nothing, so today's profile decides". The two look identical once rendered and mean
 * completely different things, and a form that showed one number for both would be
 * claiming the bill promised a window it never did.
 */
export function paymentDaysFromTerms(value: string | string[] | null | undefined): number | null {
  for (const line of readTerms(value)) {
    const hit = /within\s+(\d+)\s+days?/i.exec(line);
    if (hit) {
      const days = Number(hit[1]);
      if (Number.isFinite(days)) return days;
    }
  }
  return null;
}

/** Whether a bill's terms still carry the unresolved `{PAYMENT_DAYS}` variable. */
export function usesPaymentDaysVariable(value: string | string[] | null | undefined): boolean {
  return readTerms(value).some((line) => line.includes("{PAYMENT_DAYS}"));
}

/* ═══════════════════════════════════════════════════════════════════════════
   The form's state
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the form holds, as strings.
 *
 * All strings, deliberately, including the numbers. An HTML input's value is a string
 * and typing `1.` or `-` or a trailing comma is a legitimate intermediate state; a
 * numeric field would have to round-trip through `Number()` on every keystroke, and the
 * one that drops the decimal point while somebody is typing `12.` is a form that
 * silently edits what the admin entered. So the form keeps text and converts at the
 * edge, in one place, with the server doing it again independently.
 */
export interface CreatorFormValues {
  [field: string]: string;
}

export interface CreatorLineDraft {
  /** A stable identity for the row, so React does not reuse one row's DOM for another. */
  key: string;
  srNo: string;
  description: string;
  hsnCode: string;
  uom: string;
  quantity: string;
  rate: string;
  /** Read-only: the amount is quantity x rate, and the server recomputes it anyway. */
  amount: string;
}

/** An empty form. Two ways in, and nothing else. */
export function emptyCreatorForm(): CreatorFormValues {
  return {};
}

export function blankCreatorLine(key: string, index: number): CreatorLineDraft {
  return {
    key,
    srNo: String(index + 1),
    description: "",
    hsnCode: "",
    uom: "",
    quantity: "",
    rate: "",
    amount: "",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Reading the form
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A number as a number, from whatever the input holds.
 *
 * `""` is null rather than 0, and that distinction is the whole point. A blank quantity
 * is a field nobody filled in; a quantity of zero is a real figure a real invoice
 * carries. Converting `""` to 0 would turn "not entered" into "no charge" and, in a
 * total, into a line that quietly contributes nothing.
 *
 * `1,234.50` is accepted because Indian invoice work is full of comma-grouped figures
 * copied out of a previous bill, and refusing them helps nobody. Unparseable text is
 * null rather than `NaN`, so a typo cannot turn a total into `NaN` and print that.
 */
export function readNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/,/g, "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** A date as `YYYY-MM-DD`, or null. `<input type="date">` already produces this. */
export function readDate(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  return text === "" ? null : text;
}

/** Multi-line text as lines, or null when the admin cleared it. */
export function readLines(raw: string | null | undefined): string[] | null {
  const text = String(raw ?? "");
  const lines = text
    .split(/\r\n?|\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  return lines.length === 0 ? null : lines;
}

/**
 * A stored bank block, in whichever of the two shapes the database holds.
 *
 * `bills.bank_details` is an array of printed lines on every bill imported before 0008
 * and a label/value object on everything after it, and both are legitimate. Rather than
 * making the form care which it has — and being wrong for half the bills in the list —
 * a line form is parsed into parts, and a parts form is kept. Both come out the same
 * shape, which is what the Bank Details section binds its fields to.
 */
export function readBank(value: BankDetails | string[] | string | null | undefined): BankDetails | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const parsed = parseBankLines(value.map((line) => String(line)));
    return Object.keys(parsed).length > 0 ? parsed : null;
  }
  if (typeof value === "string") {
    const parsed = parseBankLines(value.split(/\r\n?|\n/));
    return Object.keys(parsed).length > 0 ? parsed : null;
  }
  return Object.keys(value).length > 0 ? value : null;
}

/** The bank's printed lines, for the read-only preview in the Bank Details section. */
export function readBankLines(value: BankDetails | string[] | string | null | undefined): string[] {
  return bankLinesOf(value ?? null);
}

/**
 * The four fields the Bank Details section shows, in the order the invoice prints.
 *
 * Values only. The labels are NOT returned, because they are not the admin's to change:
 * they are part of the printed line, and a stored block keeps the ones its own document
 * already had. `blankBank` is where new labels come from.
 */
export function bankPartValues(details: BankDetails | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BANK_FIELD_ORDER) {
    out[key] = details?.[key]?.value ?? "";
  }
  return out;
}

/**
 * A bank block to start typing into, with this template's own labels.
 *
 * The label plus ONE space, which is what the server's `profileBankLabel` supplies for a
 * part built from nothing. `defaultBankLabel` deliberately returns no space of its own,
 * because for a part the WORKBOOK printed the spacing belongs to the label and must be
 * reproduced exactly — "IFSC CODE:EXAM0000001" keeps printing without one. There is no
 * original spacing for a part being invented, so concatenating a bare label onto a value
 * would print "BRANCH:MUMBAI" and the separator has to come from somewhere.
 *
 * A stored block keeps its OWN labels, which is the whole reason they are stored. Seeding
 * these defaults over a real bill would retype every bank line on every copy.
 */
export function blankBank(): BankDetails {
  const out: BankDetails = {};
  for (const key of BANK_FIELD_ORDER) {
    out[key] = { label: `${defaultBankLabel(key)} `, value: "" };
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   The patch the server receives
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The line rows as the server's own shape.
 *
 * `sr_no` is sent even when the admin did not type it, because the server renumbers from
 * its own index if the value is missing — and after a delete in the middle, the server's
 * index and the admin's visible number are the same thing anyway. Sending what is on
 * screen keeps the two from disagreeing.
 *
 * Amounts are NOT sent. `cleanLineItems` computes every amount as quantity x rate and
 * ignores whatever the client sent, which is exactly right: two numbers that disagree on
 * a printed line are how an invoice adds up to the wrong total. The form shows the
 * computed amount and says nothing is sent, so there is no moment where the two could
 * diverge.
 */
export function linesToPatch(lines: readonly CreatorLineDraft[]): LineItemPatch[] {
  return lines.map((line, index) => ({
    sr_no: readNumber(line.srNo) ?? index + 1,
    description: line.description.trim() === "" ? null : line.description,
    hsn_code: line.hsnCode.trim() === "" ? null : line.hsnCode,
    uom: line.uom.trim() === "" ? null : line.uom,
    quantity: readNumber(line.quantity),
    rate: readNumber(line.rate),
    /* Present and null on purpose: the key's presence is what asks the server to
       recompute. Omitting the key would ask it to keep whatever the row had. */
    amount: null,
  }));
}

/** The line rows as the server's own items, for the running total. */
export function linesToItems(lines: readonly CreatorLineDraft[]): BillLineItem[] {
  return lines.map((line, index) => {
    const quantity = readNumber(line.quantity);
    const rate = readNumber(line.rate);
    return {
      srNo: readNumber(line.srNo) ?? index + 1,
      description: line.description,
      hsnCode: line.hsnCode === "" ? null : line.hsnCode,
      uom: line.uom === "" ? null : line.uom,
      quantity,
      rate,
      /* Same rule as the server: quantity x rate where both exist, otherwise nothing.
         Not `?? readNumber(line.amount)` — a row the admin typed an amount into with no
         quantity is a row they have not finished, and treating the half-filled amount as
         final is how a total comes to include a line that is still being typed. */
      amount: quantity !== null && rate !== null ? round2(quantity * rate) : null,
    };
  });
}

/**
 * The text fields, as the server's own shape.
 *
 * Built by walking a list of field names rather than by listing every key, because a
 * hand-written object is a second inventory of the invoice that has to be updated by hand
 * whenever a field is added — and forgetting it is silent. A field absent from `values`
 * simply is not sent, and the server leaves the stored value alone, which is the correct
 * behaviour for a form that has not touched it.
 *
 * `amount_in_words` is the exception and the only field with a three-case contract:
 *
 *   key absent from values  -> the server keeps whatever is stored
 *   amountInWords = ""      -> the admin cleared it, so regenerate from the total
 *   amountInWords = "SAYING" -> use exactly this
 *
 * Sending `null` for a cleared field would be ambiguous with "keep the stored value", and
 * the server would keep words that no longer match the money — the one inconsistency on
 * a tax invoice that a customer is entitled to reject.
 */
const TEXT_FIELDS: readonly string[] = [
  "invoice_no",
  "our_challan_no",
  "your_challan_no",
  "order_no",
  "order_no_label",
  "eway_bill_no",
  "recipient_label",
  "recipient_note",
  "party_name",
  "party_address",
  "party_gst_no",
  "place_of_supply",
  "state",
  "state_code",
  "transporter_mode",
  "vehicle_number",
  "seller_name",
  "seller_descriptor",
  "seller_tax_line",
  "seller_address",
  "seller_contact",
  "certification",
  "on_behalf_of",
  "signature_designation",
  "receiver_signature",
  "notes_extra",
  "job_kind",
];

const DATE_FIELDS: readonly string[] = [
  "invoice_date",
  "our_challan_date",
  "your_challan_date",
  "order_date",
  "eway_bill_date",
];

const RATE_FIELDS: readonly string[] = ["cgst_rate", "sgst_rate", "igst_rate"];

export interface BuildPatchOptions {
  values: CreatorFormValues;
  lines?: readonly CreatorLineDraft[];
  /** Omitted to leave the stored words alone; `""` to regenerate. */
  amountInWords?: string;
  /** Omitted to leave the stored rates alone. */
  reverseChargeGst?: string | null;
  roundOff?: string | null;
}

export function buildPatch(options: BuildPatchOptions): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const { values } = options;

  for (const field of TEXT_FIELDS) {
    const raw = values[field];
    if (raw === undefined) continue;
    patch[field] = raw.trim() === "" ? null : raw.trim();
  }
  for (const field of DATE_FIELDS) {
    const raw = values[field];
    if (raw === undefined) continue;
    patch[field] = readDate(raw);
  }
  for (const field of RATE_FIELDS) {
    const raw = values[field];
    if (raw === undefined) continue;
    patch[field] = readNumber(raw);
  }
  /* `reverse_charge_gst` and `round_off` are decisions, not derivations: 9 of the 20
     reference invoices round, and the rounded figure is the one that was billed. Left out
     of the patch when absent, so a form that never touches them cannot change what a
     customer owes. */
  if (options.roundOff !== undefined) patch.round_off = readNumber(options.roundOff);
  if (options.reverseChargeGst !== undefined) {
    patch.reverse_charge_gst = readNumber(options.reverseChargeGst);
  }
  if (options.amountInWords !== undefined) {
    patch.amount_in_words =
      options.amountInWords.trim() === "" ? null : options.amountInWords.trim();
  }
  if (options.lines !== undefined) {
    patch.line_items = linesToPatch(options.lines);
  }
  return patch;
}

/* ═══════════════════════════════════════════════════════════════════════════
   What the form shows while you type
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CreatorTotals {
  totalQuantity: number | null;
  amountBeforeTax: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  amountAfterTax: number;
}

/**
 * The running total beside the line items.
 *
 * Deliberately WITHOUT the tax: `computeTotals` decides which of the three taxes applies
 * from the amounts a bill already charges, and a form has no stored amounts to read. A
 * client-side reimplementation of that rule would be a second copy of the exact decision
 * the requirement says must not be duplicated — and it would be wrong for the bill the
 * creator copies, which does have amounts.
 *
 * So the form shows the base, and the three tax amounts come back from the server's own
 * `save` response — which is also what the preview renders. That is one extra round trip
 * on a debounced autosave, and it is the price of not having two answers to "what does
 * this invoice total?". `test-bill-creator.ts` asserts this function equals
 * `computeTotals` on the base, so the shared part cannot drift.
 */
export function creatorTotals(lines: readonly CreatorLineDraft[]): CreatorTotals {
  const items = linesToItems(lines);
  let amountBeforeTax = 0;
  let totalQuantity: number | null = null;

  for (const item of items) {
    const amount =
      item.quantity !== null && item.rate !== null
        ? round2(item.quantity * item.rate)
        : (item.amount ?? 0);
    amountBeforeTax = round2(amountBeforeTax + (amount ?? 0));
    if (item.quantity !== null) {
      totalQuantity = round3((totalQuantity ?? 0) + item.quantity);
    }
  }

  return {
    totalQuantity,
    amountBeforeTax,
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalGst: 0,
    amountAfterTax: amountBeforeTax,
  };
}

/** The amount column for a row, matching what the server will compute and store. */
export function lineAmount(line: CreatorLineDraft): number | null {
  const quantity = readNumber(line.quantity);
  const rate = readNumber(line.rate);
  return quantity !== null && rate !== null ? round2(quantity * rate) : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   A copy: what to keep, what to point at
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The fields a copy highlights for review.
 *
 * The alternative — clearing them and letting the admin refill them — was rejected
 * because a bill is mostly the same bill: 40 fields carry over and only these handful
 * change. Clearing them turns "review this bill" into "rebuild this bill", and every
 * field the admin does NOT refill silently reverts to blank, which on an invoice means
 * the customer, the address and the tax treatment disappear. A highlighted field that is
 * left alone is the correct bill; a cleared field that is left alone is a broken one.
 *
 * So the values are kept AND the fields are marked. Line items are preserved and not
 * marked, because they are the part of a copy that is usually still correct, and
 * highlighting a whole table for a routine copy is noise.
 */
export const LIKELY_TO_CHANGE_FIELDS: readonly string[] = [
  "invoice_no",
  "invoice_date",
  "our_challan_no",
  "our_challan_date",
  "your_challan_no",
  "your_challan_date",
  "order_no",
  "order_date",
  "eway_bill_no",
  "eway_bill_date",
  "party_name",
];

export const LIKELY_TO_CHANGE_SET: ReadonlySet<string> = new Set(LIKELY_TO_CHANGE_FIELDS);

/** Whether a field should be marked for review on a copied bill. */
export function isLikelyToChange(field: string): boolean {
  return LIKELY_TO_CHANGE_SET.has(field);
}

/**
 * Fields that must never travel from one bill to another, named for the migration and
 * the audit log rather than for the form. Present here so the clients and the server all
 * carry the same list; `test-bill-creator.ts` checks it against the migrations.
 */
export const NEVER_COPIED_FIELDS: readonly string[] = [
  "id",
  "bill_upload_id",
  "sheet_name",
  "original_pdf_path",
  "duplicate_pdf_path",
  "triplicate_pdf_path",
  "pdf_version",
  "logo_rendered_logo_id",
  "created_at",
  "updated_at",
  "updated_by",
  "created_by",
  "finalized_at",
  "copied_from_bill_id",
  "creator_draft_key",
  "status",
  "origin",
  "business_profile_snapshot",
  /* Derived from the line items on every write. Seeding them would let a copy carry a
     stale total that its own line items contradict. */
  "amount_before_tax",
  "cgst",
  "sgst",
  "igst",
  "total_gst",
  "amount_after_tax",
  "total_quantity",
];

export const NEVER_COPIED_SET: ReadonlySet<string> = new Set(NEVER_COPIED_FIELDS);

/* ═══════════════════════════════════════════════════════════════════════════
   Seeding the form
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A stored row, read structurally.
 *
 * `Record<string, unknown>` rather than the app's `Bill`, for two reasons. It is what a
 * Supabase `.select("*")` actually returns before anyone has checked it, so typing it as
 * `Bill` would be asserting a shape the value does not have. And this file is copied
 * verbatim into both clients, so importing either app's types would make the copy
 * unbuildable — which is the failure mode the mirroring exists to avoid.
 */
export type SourceRow = Readonly<Record<string, unknown>>;

/** A value as the form shows it: null and arrays become text, numbers keep their digits. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}

/**
 * One stored column as a form value, or `undefined` when the column is not there at all.
 *
 * The distinction is the whole point. `undefined` means "this row has no opinion", so the
 * field is left out of `values` and `buildPatch` does not send it and the server does not
 * touch it. `""` means the column is there and is blank, so the field is sent as null and
 * the stored value is cleared. Collapsing those two is how a half-built row wipes a
 * customer's address.
 */
function seedField(row: SourceRow, field: string): string | undefined {
  return field in row ? asText(row[field]) : undefined;
}

/**
 * What the three entry modes hand the form.
 *
 * One shape for all three — a new bill, a new bill with the profile preloaded, and a copy
 * — because they differ only in where the values come from. If each mode built its own
 * state there would be three ways for a form to disagree with the server, and only one of
 * them would be exercised.
 */
export interface CreatorSeed {
  values: CreatorFormValues;
  lines: CreatorLineDraft[];
  bank: BankDetails;
  terms: readonly [string, string, string];
  /**
   * The stored wording, shown so it can be checked — and NOT necessarily what gets sent.
   * See `amountInWordsForPatch`.
   */
  amountInWords: string;
  /** null until the admin decides, which is different from deciding "no round off". */
  roundOff: string | null;
  reverseChargeGst: string | null;
}

/**
 * What to put in the patch for the amount in words.
 *
 * `undefined` unless the admin actually edited the field. The consequence is the right
 * one in both directions, and it is why this is a function rather than a value:
 *
 *   * untouched -> absent from the patch -> a copy keeps the source's wording while its
 *     total is unchanged, and a new bill's words are generated from its total. Both of
 *     those already exist on the server and are correct by construction.
 *   * edited -> sent as typed, and `""` becomes null, which asks for regeneration.
 *
 * Sending the seeded text on every save would quietly defeat that: a copy whose total the
 * admin raised would keep the words for the old total, and the one inconsistency on a tax
 * invoice a customer can reject would be introduced by the form that was meant to prevent
 * it.
 */
export function amountInWordsForPatch(text: string, touched: boolean): string | undefined {
  return touched ? text : undefined;
}

/**
 * A bill's stored line items as form rows.
 *
 * `sr_no` is not regenerated here: the numbers a workbook gave are part of the printed
 * document, and a copy that renumbered its rows from 1 would print a different invoice
 * from the one it was copied from. A NEW bill starts from `blankCreatorLine`, which
 * numbers itself.
 */
export function linesFromRecord(
  items: readonly SourceRow[],
  keyPrefix: string
): CreatorLineDraft[] {
  return items.map((item, index) => ({
    key: `${keyPrefix}-${index}`,
    srNo: seedField(item, "sr_no") ?? "",
    description: asText(item.description),
    hsnCode: asText(item.hsn_code),
    uom: asText(item.uom),
    quantity: asText(item.quantity),
    rate: asText(item.rate),
    amount: asText(item.amount),
  }));
}

/** One blank row for a bill that has no items yet, so there is somewhere to type. */
export function firstBlankLine(keyPrefix: string): CreatorLineDraft[] {
  return [blankCreatorLine(`${keyPrefix}-0`, 0)];
}

/**
 * The form's state, seeded from a stored bill — the "Copy as Draft" path.
 *
 * Line items, bank labels and terms are copied verbatim, including the parts the invoice
 * prints that no field is named after. What is NOT copied is named in `NEVER_COPIED_FIELDS`
 * and simply never read here: no id, no paths, no timestamps, no upload, and no derived
 * totals. The bill this seeds becomes a NEW row with its own identity; the original is
 * never opened for writing.
 */
export function seedFromRecord(
  record: SourceRow,
  items: readonly SourceRow[],
  keyPrefix: string
): CreatorSeed {
  const values: CreatorFormValues = {};
  for (const field of TEXT_FIELDS) {
    const seeded = seedField(record, field);
    if (seeded !== undefined) values[field] = seeded;
  }
  for (const field of DATE_FIELDS) {
    const seeded = seedField(record, field);
    if (seeded !== undefined) values[field] = seeded;
  }
  for (const field of RATE_FIELDS) {
    const seeded = seedField(record, field);
    if (seeded !== undefined) values[field] = seeded;
  }

  return {
    values,
    lines: linesFromRecord(items, keyPrefix),
    /* The bill's OWN labels, gap and all. A bank block parsed from a workbook is stored as
       label/value parts precisely so it can be retyped exactly; rebuilding it from
       defaults here would turn every "IFSC CODE:X" into "IFSC CODE: X" on every copy. */
    bank: readBank(record.bank_details as BankDetails | null) ?? blankBank(),
    terms: readTerms(record.terms as string | string[] | null),
    amountInWords: asText(record.amount_in_words),
    roundOff: "round_off" in record ? asText(record.round_off) : null,
    reverseChargeGst: "reverse_charge_gst" in record ? asText(record.reverse_charge_gst) : null,
  };
}

/**
 * The profile's own field name for each invoice field it fills.
 *
 * Written out rather than derived, because the two sets are named differently on purpose:
 * the profile is a settings screen written once, the invoice is a document template. A
 * rule that mapped them positionally would be a second thing to keep true.
 *
 * Each entry is [invoice field, profile column]. Missing pairs are simply absent — the
 * server's merge treats a null as "nothing to add", and so does this.
 */
const PROFILE_FIELDS: readonly (readonly [string, string])[] = [
  ["seller_name", "company_name"],
  ["seller_descriptor", "business_description"],
  ["seller_address", "office_address"],
  ["certification", "certification_text"],
  ["on_behalf_of", "authorized_signatory_text"],
  ["signature_designation", "authorized_signatory_designation"],
  ["receiver_signature", "receiver_signature_label"],
];

/**
 * The profile's four bank values, as invoice parts.
 *
 * The profile's `bank_branch` becomes the part this template calls `branch`, and
 * `bank_ifsc` the part it calls `ifsc_code`: the invoice's keys are the printed line's,
 * the profile's are the settings screen's, and the pairing is named here once.
 */
const PROFILE_BANK: readonly (readonly [keyof BankDetails, string])[] = [
  ["branch", "bank_branch"],
  ["bank_name", "bank_name"],
  ["ifsc_code", "bank_ifsc"],
  ["account_number", "bank_account_number"],
];

/**
 * The form's state, seeded from the current Business Profile — the "New Bill + Profile"
 * path, and the "Use current Invoice Business Profile" box on a copy.
 *
 * The formats are the server's, character for character: `GST No.<gst> MSME NO.<msme>` on
 * one line, the emails then the mobiles joined with a comma and a space, the bank's own
 * labels with a single space. Restating them is unavoidable — the client cannot import the
 * edge function's merge — and so the reason to do it exactly rather than approximately is
 * that this is the only place the two can disagree. A space too many here and the admin
 * previews one tax line and the PDF prints another.
 *
 * The profile's TERMS are seeded as stored, `{PAYMENT_DAYS}` and all. They are not
 * resolved here: the substitution belongs to `applyBusinessProfile`, which knows the
 * resolved company name, and doing it in the form would mean the form had an opinion
 * about the profile it is meant to be showing. The section says so.
 */
export function seedFromProfile(profile: SourceRow, keyPrefix: string): CreatorSeed {
  const values: CreatorFormValues = {};

  /* Every profile-backed field is set, INCLUDING to "" when the profile has nothing to
     say. That is not the same as leaving it out of the patch, and the difference matters:
     an absent key means "keep the stored value", which is right for a field the form has
     not touched and wrong for a field the profile is the authority on. A company whose
     profile carries no certification must produce an invoice with none, so ticking "use
     the current Invoice Business Profile" on a copy whose source had one clears it
     rather than quietly leaving the old wording in place.

     `profileToSnapshot` omits null keys rather than writing them, so reading a missing
     column as "" here is what makes the two agree. */
  for (const [field, column] of PROFILE_FIELDS) {
    values[field] = asText(profile[column]);
  }

  /* The tax line cannot go through that loop: it is one column holding TWO registration
     numbers, joined by the server's own rule. */
  const taxParts: string[] = [];
  const gst = asText(profile.gst_number);
  const msme = asText(profile.msme_number);
  if (gst !== "") taxParts.push(`GST No.${gst}`);
  if (msme !== "") taxParts.push(`MSME NO.${msme}`);
  values.seller_tax_line = taxParts.join(" ");

  /* One wrapped paragraph, so a newline between the emails would be collapsed away by
     the header's wrapper and print two values run together. A comma survives wrapping. */
  const contacts: string[] = [];
  for (const column of ["email_1", "email_2", "mobile_1", "mobile_2"]) {
    const value = asText(profile[column]);
    if (value !== "") contacts.push(value);
  }
  values.seller_contact = contacts.join(", ");

  const bank = blankBank();
  for (const [key, column] of PROFILE_BANK) {
    const value = asText(profile[column]);
    if (value !== "") bank[key] = { label: bank[key]!.label, value };
  }

  return {
    values,
    lines: firstBlankLine(keyPrefix),
    bank,
    terms: [
      asText(profile.term_1),
      asText(profile.term_2),
      asText(profile.term_3),
    ],
    /* Empty, and `amountInWordsForPatch` keeps it out of the patch entirely: words for a
       bill with no total yet cannot be written, and the server generates them from the
       total on every save. */
    amountInWords: "",
    roundOff: null,
    reverseChargeGst: null,
  };
}

/**
 * An empty bill — the "Create New Bill" path, where nothing is preloaded at all.
 *
 * Not the same as `seedFromProfile` with an empty profile: it is passed no profile
 * object, so no seller default can reach the form and every one of those fields is
 * genuinely blank. That is the difference between the two buttons on the entry screen,
 * and it is a difference in what is READ, not in what the form does afterwards.
 */
export function seedEmpty(keyPrefix: string): CreatorSeed {
  return {
    values: {},
    lines: firstBlankLine(keyPrefix),
    bank: blankBank(),
    terms: ["", "", ""],
    amountInWords: "",
    roundOff: null,
    reverseChargeGst: null,
  };
}