// _shared/billCreator.ts
//
// THE BILL CREATOR, AS PURE FUNCTIONS.
//
// WHY THIS FILE EXISTS
// The creator is a form that fills in a bill. The two things that could go wrong are
// both decidable without a database and without a network:
//
//   1. WHICH FIELDS A COPY CARRIES, and which it must not. This is a data-mapping
//      decision, and getting it wrong silently clones a bill's identity, its storage
//      paths or its job links onto a new invoice.
//   2. WHETHER A BILL MAY BE FINALIZED. "You may not generate this yet, and here is
//      the field that is wrong" has to be the same answer on the server as it is in
//      the form, or the form will let somebody press a button that fails.
//
// So both live here, are called by the edge function, and are exercised by
// `_selftest/test-bill-creator.ts` under plain Node with no credentials.
//
// WHAT IS DELIBERATELY NOT HERE
// No rendering, no storage, no HTTP, and — most importantly — no invoice maths.
// Every figure this feature produces comes out of `computeBillValues`, the same
// function `update-bill` uses to re-print an edited bill. A creator with its own
// arithmetic would produce a total that disagreed with the PDF by a rounding step,
// which is precisely the failure the existing bridge exists to prevent.

import {
  type BankDetails,
  type BankPart,
  type BillRecord,
  amountInWords,
  applicableFromAmounts,
  bankLinesOf,
  parseBankLines,
  round2,
  round3,
  supplyTypeOf,
} from "./billDocument.ts";
import { LIMITS, type BillPatch, type LineItemPatch } from "./billEdit.ts";
import type { BillLineItem, CopyKind } from "./parseBill.ts";

/**
 * A stored multi-line value as its lines.
 *
 * Local rather than imported: `billDocument.ts` has a private `lines()` of exactly
 * this shape, and reaching into it would mean exporting a helper purely for the
 * creator's convenience. Three lines of the same trivial normalising is the cheaper
 * trade than widening another module's surface.
 */
function toLines(value: string | string[] | null | undefined): string[] {
  if (value === null || value === undefined) return [];
  const raw = Array.isArray(value) ? value : String(value).split(/\r\n?|\n/);
  return raw.map((line) => String(line)).filter((line) => line.trim() !== "");
}

/* ──────────────────────────────────────────────
   The one canonical field list
   ────────────────────────────────────────────── */

/**
 * The `BillPatch` keys a copy carries from its source, in the order the form shows
 * them.
 *
 * This is deliberately NOT derived from `applyPatch`'s private `EDITABLE` set, and
 * the reason is that the two answer different questions. `EDITABLE` is the set of
 * columns a client may *write*; this is the set that describes an *invoice*. They
 * happen to coincide today, and `test-bill-creator.ts` fails if that ever stops being
 * true in either direction — an invented field here would be a field no bill has,
 * and a missing one would be a field a copy silently drops.
 *
 * Every entry is a real `bills` column. Nothing was added because the creator felt
 * it needed somewhere to put something.
 */
export const COPYABLE_PATCH_KEYS = [
  "job_kind",

  "invoice_no",
  "invoice_date",
  "our_challan_no",
  "our_challan_date",
  "your_challan_no",
  "your_challan_date",
  "order_no",
  "order_no_label",
  "order_date",
  "eway_bill_no",
  "eway_bill_date",

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

  "cgst_rate",
  "sgst_rate",
  "igst_rate",
  "reverse_charge_gst",
  "round_off",

  "bank_details",
  "terms",

  "certification",
  "on_behalf_of",
  "signature_designation",
  "receiver_signature",
  "notes_extra",

  "amount_in_words",
] as const satisfies readonly (keyof BillPatch)[];

export type CopyablePatchKey = (typeof COPYABLE_PATCH_KEYS)[number];

/**
 * The fields that are NOT copied, named rather than merely omitted.
 *
 * A list of what is copied does not tell a reader what is deliberately left behind,
 * and the omissions here are the ones a "duplicate this bill" feature is most likely
 * to get wrong:
 *
 *   identity        `id`, `bill_upload_id`, `sheet_name`, `creator_draft_key`
 *   storage         `original_pdf_path`, `duplicate_pdf_path`,
 *                   `triplicate_pdf_path`, `pdf_version`, `logo_rendered_logo_id`
 *   provenance      `created_at`, `created_by`, `updated_at`, `updated_by`
 *   relationships   `copied_from_bill_id` (replaced by the NEW bill's source), and
 *                   every `bill_job_connections` row
 *   money that is   `amount_before_tax`, `cgst`, `sgst`, `igst`, `total_gst`,
 *   re-derived       `amount_after_tax`, `total_quantity`, `reverse_charge_gst`
 *
 * The financial columns are listed as "not copied" but in practice they ARE carried:
 * they are re-derived by `computeBillValues` from the copied line items and rates, so
 * a copy that changes one quantity cannot keep the old total. They are excluded from
 * the seed patch because a seed that set them would be overwritten anyway, and a
 * seed that set them *and* was not overwritten would be an invoice whose printed
 * total does not match its lines.
 *
 * `logo_id` is copied — the letterhead is part of the invoice — but the image itself
 * is not. One logo is one row in `invoice_logos` and one object in the private
 * bucket; a copy references it by id, exactly as the original does.
 */
export const NEVER_COPIED_FIELDS = [
  "id",
  "bill_upload_id",
  "sheet_name",
  "creator_draft_key",
  "original_pdf_path",
  "duplicate_pdf_path",
  "triplicate_pdf_path",
  "pdf_version",
  "logo_rendered_logo_id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "copied_from_bill_id",
  "amount_before_tax",
  "cgst",
  "sgst",
  "igst",
  "total_gst",
  "amount_after_tax",
  "total_quantity",
] as const;

/**
 * The fields the creator highlights after a copy, because they are the ones a new
 * invoice is most likely to have to change.
 *
 * They are HIGHLIGHTED, not cleared. Silently blanking an invoice number would leave
 * an admin looking at a form with no way to tell which values came from the bill
 * they just copied, and clearing a customer field would throw away the part of a
 * copy that is usually still correct. The user sees the old value, knows it is old,
 * and decides.
 */
export const LIKELY_TO_CHANGE_FIELDS = [
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
] as const satisfies readonly (keyof BillPatch)[];

export type LikelyToChangeField = (typeof LIKELY_TO_CHANGE_FIELDS)[number];

/** The set form of {@link LIKELY_TO_CHANGE_FIELDS}, for membership tests. */
export const LIKELY_TO_CHANGE_SET: ReadonlySet<string> = new Set(LIKELY_TO_CHANGE_FIELDS);

/** The set form of {@link NEVER_COPIED_FIELDS}, for membership tests. */
export const NEVER_COPIED_SET: ReadonlySet<string> = new Set(NEVER_COPIED_FIELDS);

/* ──────────────────────────────────────────────
   Reading a stored bill back into a form
   ────────────────────────────────────────────── */

/**
 * `bank_details` as a form can hold it.
 *
 * 0008 stores label/value parts; a row from before 0008 stores an array of printed
 * lines. Both are legitimate, and `parseBankLines` already reads an array into parts
 * exactly as the workbook wrote them, so an old row and a new row come out of the
 * creator identically instead of one of them losing its bank block.
 */
export function bankFromRecord(value: BankDetails | string[] | string | null | undefined): BankDetails | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const parsed = parseBankLines(value.map((line) => String(line)));
    return Object.keys(parsed).length > 0 ? parsed : null;
  }
  if (typeof value === "string") {
    const parsed = parseBankLines(value.split(/\r\n?|\n/));
    return Object.keys(parsed).length > 0 ? parsed : null;
  }
  const out: BankDetails = {};
  for (const [key, part] of Object.entries(value)) {
    const p = part as Partial<BankPart>;
    out[key] = { label: String(p.label ?? ""), value: String(p.value ?? "") };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** A number as a number, whatever shape PostgREST or an input handed us. */
export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Text as trimmed text, or null. The same blank-means-empty rule as `applyPatch`. */
function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * The seed patch for a new bill, from either a blank slate or an existing record.
 *
 * Reading the record field by field, rather than projecting the row and deleting the
 * forbidden keys, is what makes "the copy carries the invoice and nothing else" a
 * property of this function instead of a property of a denylist someone has to
 * remember to extend. A column added to `bills` tomorrow is not copied until someone
 * writes it here, and `test-bill-creator.ts` fails until they do.
 */
export function patchFromRecord(record: BillRecord | null): BillPatch {
  const patch: Record<string, unknown> = {};
  if (!record) return patch as BillPatch;

  const r = record as unknown as Record<string, unknown>;
  const set = (key: CopyablePatchKey, value: unknown) => {
    patch[key] = value;
  };

  set("job_kind", textOrNull(r.job_kind));

  set("invoice_no", textOrNull(r.invoice_no));
  set("invoice_date", textOrNull(r.invoice_date));
  set("our_challan_no", textOrNull(r.our_challan_no));
  set("our_challan_date", textOrNull(r.our_challan_date));
  set("your_challan_no", textOrNull(r.your_challan_no));
  set("your_challan_date", textOrNull(r.your_challan_date));
  set("order_no", textOrNull(r.order_no));
  set("order_no_label", textOrNull(r.order_no_label));
  set("order_date", textOrNull(r.order_date));
  set("eway_bill_no", textOrNull(r.eway_bill_no));
  set("eway_bill_date", textOrNull(r.eway_bill_date));

  set("recipient_label", textOrNull(r.recipient_label));
  set("recipient_note", textOrNull(r.recipient_note));
  set("party_name", textOrNull(r.party_name));
  set("party_address", textOrNull(r.party_address));
  set("party_gst_no", textOrNull(r.party_gst_no));
  set("place_of_supply", textOrNull(r.place_of_supply));
  set("state", textOrNull(r.state));
  set("state_code", textOrNull(r.state_code));

  set("transporter_mode", textOrNull(r.transporter_mode));
  set("vehicle_number", textOrNull(r.vehicle_number));

  set("seller_name", textOrNull(r.seller_name));
  set("seller_descriptor", textOrNull(r.seller_descriptor));
  set("seller_tax_line", textOrNull(r.seller_tax_line));
  set("seller_address", textOrNull(r.seller_address));
  set("seller_contact", textOrNull(r.seller_contact));

  set("cgst_rate", numberOrNull(r.cgst_rate));
  set("sgst_rate", numberOrNull(r.sgst_rate));
  set("igst_rate", numberOrNull(r.igst_rate));
  set("reverse_charge_gst", numberOrNull(r.reverse_charge_gst));
  set("round_off", numberOrNull(r.round_off));

  set("bank_details", bankFromRecord(record.bank_details));
  set("terms", textOrNull(r.terms));

  set("certification", textOrNull(r.certification));
  set("on_behalf_of", textOrNull(r.on_behalf_of));
  set("signature_designation", textOrNull(r.signature_designation));
  set("receiver_signature", textOrNull(r.receiver_signature));
  set("notes_extra", textOrNull(r.notes_extra));

  /* The words are copied verbatim, NOT regenerated from the new total. Regenerating
     would be wrong the moment the copy differs at all, and the three-way contract in
     `applyPatch` is what makes this expressible: an explicit string means "keep
     exactly this", while `null` means "recompute". A creator whose total changes
     because a quantity changed wants the words to follow, so the creator sends
     `amount_in_words: null` in that case; a pure copy keeps the string. The edge
     function resolves which of the two applies. */
  set("amount_in_words", textOrNull(r.amount_in_words));

  return patch as BillPatch;
}

/** Stored line-item rows as the editor's shape. */
export function lineItemsFromRows(rows: unknown): BillLineItem[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return {
      srNo: numberOrNull(r.sr_no) ?? index + 1,
      description: String(r.description ?? ""),
      hsnCode: textOrNull(r.hsn_code),
      uom: textOrNull(r.uom),
      quantity: numberOrNull(r.quantity),
      rate: numberOrNull(r.rate),
      amount: numberOrNull(r.amount),
    };
  });
}

/** The editor's line items as `line_items` patch entries. */
export function lineItemsToPatch(items: readonly BillLineItem[]): LineItemPatch[] {
  return items.map((item, index) => ({
    sr_no: item.srNo ?? index + 1,
    description: item.description ?? null,
    hsn_code: item.hsnCode ?? null,
    uom: item.uom ?? null,
    quantity: item.quantity ?? null,
    rate: item.rate ?? null,
    amount: item.amount ?? null,
  }));
}

/* ──────────────────────────────────────────────
   A blank bill
   ────────────────────────────────────────────── */

/**
 * A `BillRecord` with nothing in it, used as the base to compute a brand-new bill's
 * figures from.
 *
 * `applicableFromAmounts(null, null, null)` returns "all three apply", which is the
 * documented behaviour for a bill that has never charged anything: every rate the
 * user typed is a rate they meant. It is worth being explicit that this means a user
 * who types all three reference rates (9 / 9 / 18) charges all three — the creator
 * shows the three computed amounts live for exactly that reason, and clearing IGST is
 * one keystroke. Changing it here would mean changing the meaning of the existing
 * editor too, which is out of scope for a feature that promises to reuse the existing
 * calculation semantics.
 */
export function emptyBillRecord(copy: CopyKind = "original"): BillRecord {
  return {
    id: "",
    sheet_name: "",
    copy,

    job_kind: null,

    invoice_no: null,
    invoice_date: null,
    our_challan_no: null,
    our_challan_date: null,
    your_challan_no: null,
    your_challan_date: null,
    order_no: null,
    order_no_label: null,
    order_date: null,
    eway_bill_no: null,
    eway_bill_date: null,

    recipient_label: null,
    recipient_note: null,
    party_name: null,
    party_address: null,
    party_gst_no: null,
    place_of_supply: null,
    state: null,
    state_code: null,

    transporter_mode: null,
    vehicle_number: null,

    seller_name: null,
    seller_descriptor: null,
    seller_tax_line: null,
    seller_address: null,
    seller_contact: null,

    total_quantity: null,
    amount_before_tax: null,
    cgst: null,
    cgst_rate: null,
    sgst: null,
    sgst_rate: null,
    igst: null,
    igst_rate: null,
    total_gst: null,
    amount_after_tax: null,
    reverse_charge_gst: null,
    round_off: null,
    amount_in_words: null,

    bank_details: null,
    terms: null,
    certification: null,
    on_behalf_of: null,
    signature_designation: null,
    receiver_signature: null,
    notes_extra: null,
  };
}

/** A blank line item, for the creator's "add row" button. */
export function blankLineItem(index: number): BillLineItem {
  return {
    srNo: index + 1,
    description: "",
    hsnCode: null,
    uom: null,
    quantity: null,
    rate: null,
    amount: null,
  };
}

/**
 * The base record a COPY is computed against.
 *
 * ── WHY THIS IS NOT JUST `emptyBillRecord()` ──
 * This is the one genuine trap in seeding a copy, and it is worth setting out in full
 * because the fix looks like it does nothing.
 *
 * Every workbook sheet in this business prints all three slab rates (9 / 9 / 18) as a
 * reference table. `patchFromRecord` faithfully copies those three rates, which is
 * right. But `computeBillValues` decides WHICH of them the bill actually charges from
 * `applicableFromAmounts(existing.cgst, existing.sgst, existing.igst)` — the amounts
 * the bill is already charging, never the rates, because the rates are a reference
 * table rather than an instruction. That distinction exists precisely so an intra-state
 * invoice does not silently become an inter-state one.
 *
 * A copy is a NEW bill, so it has no amounts yet. Computed against a blank record every
 * rate looks like one somebody meant, and the copy charges CGST + SGST + IGST: a 77,290
 * bill comes out at 89,080. Not a rendering artefact and not fixable in the form — the
 * arithmetic is right, the APPLICABILITY is wrong, and it has to be told.
 *
 * So the copy's base carries the source's three tax AMOUNTS. They are not copied into
 * the bill and they do not seed any total: `computeBillValues` recomputes all three on
 * every write, and they are overwritten before anything is stored. They exist purely as
 * the signal `applicableFromAmounts` reads, and they are the same signal an imported
 * intra-state bill carries — so a copy of an intra-state bill is intra-state, and a
 * copy of an inter-state bill is inter-state.
 *
 * What this deliberately does NOT do is invent applicability for a bill that charges no
 * tax at all (an exempt supply): with all three amounts at zero, `applicableFromAmounts`
 * still reports all three applicable, exactly as it does for the imported version of
 * that same bill. Copying a bill must not change what kind of bill it is, and the
 * creator does not get to decide that a zero-tax invoice should behave differently from
 * its source.
 *
 * For a NEW bill the base stays `emptyBillRecord()`: there is no source, so nothing is
 * inherited and every rate the user typed is charged. The form shows all three computed
 * amounts live for that reason.
 */
export function copyBaseRecord(source: BillRecord | null): BillRecord {
  const base = emptyBillRecord();
  if (!source) return base;
  return {
    ...base,
    cgst: numberOrNull((source as unknown as Record<string, unknown>).cgst),
    sgst: numberOrNull((source as unknown as Record<string, unknown>).sgst),
    igst: numberOrNull((source as unknown as Record<string, unknown>).igst),
  };
}

/**
 * Which of the three taxes a bill charges, for the creator to label in the form.
 *
 * Reported, never decided — the answer is `applicableFromAmounts` read off the amounts
 * the bill already holds, and `supplyTypeOf` read off that. The extra `UNSET` case is
 * not a second opinion: `supplyTypeOf` would call a bill with nothing charged
 * "INTRA_STATE", because all three of its rates look applicable, and printing that
 * beside a fresh invoice's tax box would be a confident wrong answer to "what kind of
 * supply is this?" A bill that has not been taxed yet genuinely is not decided, so it
 * says so.
 *
 * On a copy or an imported bill the answer is inherited from the source, which is the
 * only case where the label is about the invoice rather than about the form.
 */
export function chargeDescription(record: BillRecord | null): "INTER_STATE" | "INTRA_STATE" | "UNSET" {
  const r = (record ?? null) as Record<string, unknown> | null;
  const cgst = numberOrNull(r?.cgst);
  const sgst = numberOrNull(r?.sgst);
  const igst = numberOrNull(r?.igst);
  if ((cgst ?? 0) === 0 && (sgst ?? 0) === 0 && (igst ?? 0) === 0) return "UNSET";
  return supplyTypeOf(applicableFromAmounts(cgst, sgst, igst));
}

/* ──────────────────────────────────────────────
   Validation before finalization
   ────────────────────────────────────────────── */

/** A field-keyed problem, shaped like `applyPatch`'s `EditError` so one UI reads both. */
export interface CreatorFieldError {
  field: string;
  message: string;
}

export interface FinalizeInput {
  patch: BillPatch;
  lineItems: readonly BillLineItem[];
  /** What `computeBillValues` derived, so the check reads the real figures. */
  totals: {
    amountBeforeTax: number;
    totalGst: number;
    amountAfterTax: number;
  };
}

/**
 * Everything that must hold before a bill may be generated.
 *
 * The standard here is deliberately narrow: block what would produce a WRONG or
 * UNUSABLE invoice, and refuse nothing that is merely unusual.
 *
 * Blocked: no invoice number (it is the filename, the footer and the folder label);
 * no invoice date (a tax invoice without one is not an invoice); no line items (the
 * renderer prints a table, and a bill whose body is empty has no meaning); a line
 * with neither a quantity nor a rate nor an amount (it contributes nothing and is
 * almost always a half-finished row); negative money.
 *
 * NOT blocked: a missing GST number (legitimate for an unregistered buyer, or a
 * B2C sale), a missing state code (an unregistered place of supply), a zero tax rate
 * (an exempt or zero-rated supply), a blank bank block (the profile may supply one),
 * a blank logo, and any number of decimal places the business actually uses. A
 * validation rule that fires on legitimate data teaches people to ignore it.
 */
export function validateForFinalize(input: FinalizeInput): CreatorFieldError[] {
  const errors: CreatorFieldError[] = [];
  const { patch, lineItems, totals } = input;

  const add = (field: string, message: string) => errors.push({ field, message });

  if (textOrNull(patch.invoice_no) === null) {
    add("invoice_no", "The invoice number is required.");
  }
  if (textOrNull(patch.invoice_date) === null) {
    add("invoice_date", "The invoice date is required.");
  }

  if (lineItems.length === 0) {
    add("line_items", "Add at least one line item before generating the invoice.");
  }

  lineItems.forEach((item, index) => {
    const where = `line_items.${index}`;
    const hasDescription = textOrNull(item.description) !== null;
    const qty = numberOrNull(item.quantity);
    const rate = numberOrNull(item.rate);
    const amount = numberOrNull(item.amount);

    if (!hasDescription && qty === null && rate === null && amount === null) {
      add(where, `Line ${index + 1} is empty. Fill it in or delete it.`);
      return;
    }
    if (qty !== null && qty < 0) {
      add(where, `Line ${index + 1}: quantity cannot be negative.`);
    }
    if (rate !== null && rate < 0) {
      add(where, `Line ${index + 1}: rate cannot be negative.`);
    }
    if (amount !== null && amount < 0) {
      add(where, `Line ${index + 1}: amount cannot be negative.`);
    }
    /* A line with a quantity and a rate but nothing computed from them would print a
       row of zeroes and a total that does not include it. `computeTotals` already
       derives the amount for such a line, so this only fires when both sides are
       absent — which is the half-typed row the check above already names. */
    const derived = qty !== null && rate !== null ? round2(qty * rate) : amount;
    if (derived !== null && derived === 0 && (qty === null || rate === null)) {
      add(where, `Line ${index + 1}: give it a quantity and a rate, or an amount.`);
    }
  });

  if (numberOrNull(patch.reverse_charge_gst) !== null && (numberOrNull(patch.reverse_charge_gst) as number) < 0) {
    add("reverse_charge_gst", "Reverse charge GST cannot be negative.");
  }
  /* A round-off larger than the bill itself is a typo, and it is the one figure whose
     cause is a single stray keystroke.

     The comparison is against the total BEFORE the round-off, which is
     `before + total GST` — not against the amount before tax. Comparing against the
     pre-tax figure would flag every single taxable invoice in the business, because
     adding 18% to any bill makes it larger than itself, and a rule that fires on all
     twenty real invoices is a rule nobody reads. The margin is generous for the same
     reason: real round-offs are half a rupee or less, and a legitimate invoice is never
     wrong by more than a rounding step, so a large discrepancy really is a mistake.

     Negative round-offs are ordinary and allowed — 11 of the 20 reference bills have one
     — and this check is about magnitude, so both directions are caught. */
  const unrounded = Math.abs(totals.amountBeforeTax) + Math.abs(totals.totalGst);
  if (Math.abs(totals.amountAfterTax) - unrounded > LIMITS.address) {
    add("round_off", "The round off is larger than the invoice. Check it.");
  }

  return errors;
}

/** The largest single mistake in that list, for a one-line summary. */
export function firstFinalizeError(errors: readonly CreatorFieldError[]): CreatorFieldError | null {
  return errors.length > 0 ? errors[0] : null;
}

/* ──────────────────────────────────────────────
   Duplicate invoice numbers
   ────────────────────────────────────────────── */

export interface DuplicateMatch {
  bill_id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  sheet_name: string | null;
  party_name: string | null;
  status: string | null;
}

/**
 * Other bills already using this invoice number.
 *
 * A WARNING, not a block, and the choice is deliberate. A tax invoice number is not
 * unique in the way a primary key is: a re-issued bill, a cancelled-and-reissued
 * pair, and a business numbering across several financial years all legitimately
 * produce the same number twice. Refusing to generate would make the creator
 * unusable for those cases; allowing it silently would let somebody overwrite a real
 * invoice by typing its number.
 *
 * So the creator shows exactly which bills already carry the number, with their dates
 * and parties, and the admin confirms. The server refuses a duplicate it was not told
 * to accept, and it never writes over an existing bill: the new bill is always a new
 * row with a new id.
 *
 * Matching is on the trimmed, case-folded number, because that is how somebody
 * recognises a duplicate by eye. An exact-match index would miss "sew/401" against
 * "SEW/401".
 */
export function findDuplicateInvoiceNos(
  candidate: unknown,
  existing: readonly DuplicateMatch[],
  excludeBillId?: string | null
): DuplicateMatch[] {
  const wanted = (candidate ?? "").toString().trim().toLowerCase();
  if (wanted === "") return [];
  return existing.filter(
    (row) =>
      (row.invoice_no ?? "").toString().trim().toLowerCase() === wanted &&
      (excludeBillId ? row.bill_id !== excludeBillId : true)
  );
}

/* ──────────────────────────────────────────────
   The words
   ────────────────────────────────────────────── */

/**
 * Should the amount in words be regenerated, or kept as the copy's own wording?
 *
 * `applyPatch` has three cases for `amount_in_words`: a string means "keep exactly
 * this", `null` means "regenerate from the new total", and omitting the key means
 * "leave the stored words alone". A copy has to decide which of the three it is, and
 * the answer is "regenerate only if the money moved":
 *
 *   a pure copy        the total is identical, so the words are still true — keeping
 *                      the business's own phrasing is better than a regenerated one
 *   a copy that changed keep the numbers consistent with each other, which is what
 *   a quantity or rate     makes the two WORDS right and the numbers wrong
 *   changed
 *
 * Comparing the amounts is how "the money moved" is decided. Comparing the line items
 * would flag a description-only edit, where the words are still perfectly correct.
 */
export function wordsAfterCopy(
  sourceTotal: number | null,
  copiedTotal: number,
  sourceWords: string | null
): string | null | undefined {
  if (sourceTotal === null || round2(sourceTotal) === round2(copiedTotal)) {
    return sourceWords === null ? undefined : sourceWords;
  }
  return amountInWords(copiedTotal);
}

/* ──────────────────────────────────────────────
   Small helpers the form needs and can be tested for
   ────────────────────────────────────────────── */

/** The live figures the form shows while it is being filled in. */
export function creatorTotals(lineItems: readonly BillLineItem[]): {
  totalQuantity: number | null;
  amountBeforeTax: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  amountAfterTax: number;
} {
  const amounts = lineItems.map((item) => {
    const qty = numberOrNull(item.quantity);
    const rate = numberOrNull(item.rate);
    return qty !== null && rate !== null ? round2(qty * rate) : numberOrNull(item.amount);
  });
  const present = amounts.filter((a): a is number => a !== null);
  const amountBeforeTax = round2(present.reduce((sum, a) => sum + a, 0));
  const quantities = lineItems
    .map((i) => numberOrNull(i.quantity))
    .filter((q): q is number => q !== null);
  return {
    totalQuantity: quantities.length > 0 ? round3(quantities.reduce((a, b) => a + b, 0)) : null,
    amountBeforeTax,
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalGst: 0,
    amountAfterTax: amountBeforeTax,
  };
}

/** The text of the bank's lines, for a form that shows them read-only. */
export function bankPreview(details: BankDetails | null | undefined): string[] {
  return bankLinesOf(details ?? null);
}

/** A record's footer phrases, for the creator's Terms & Conditions section. */
export function termsLinesOf(record: BillRecord): string[] {
  return toLines(record.terms);
}

/**
 * The payment window a bill's terms print, and where it came from.
 *
 * Returned as a pair rather than a number because the two cases are genuinely different
 * and the form has to show which one it is. A bill with its own `{PAYMENT_DAYS}` resolved
 * prints a number that was decided when the invoice was written; a bill with none prints
 * whatever the profile says today, which is not a fact about this invoice at all. Showing
 * "30 days" beside the second one without saying so would be a claim the document does
 * not support.
 */
export function paymentDaysOf(record: BillRecord): { days: number | null; own: boolean } {
  const terms = toLines(record.terms);
  /* The placeholder, unresolved, is what a bill with no payment window of its own looks
     like: the template carries the token and the profile fills it at render time. */
  const placeholder = terms.some((line) => line.includes("{PAYMENT_DAYS}"));
  const written = terms.find((line) => /\bwithin\s+\d+\s+days?\b/i.test(line));
  if (written) {
    const days = Number(/within\s+(\d+)\s+days?/i.exec(written)?.[1] ?? NaN);
    return { days: Number.isFinite(days) ? days : null, own: true };
  }
  return { days: null, own: !placeholder };
}

/** A record's bank block, for the same purpose. */
export function bankLinesOfRecord(record: BillRecord): string[] {
  return bankLinesOf(record.bank_details);
}