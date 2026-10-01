// _shared/billEdit.ts
//
// What an edit means, in one testable place.
//
// WHY THIS IS SEPARATE FROM THE EDGE FUNCTION
// `update-bill/index.ts` is mostly plumbing: authenticate, read, write, upload,
// audit. The part that can be WRONG is the part that decides what a bill now says —
// which fields a client is allowed to change, what a valid value looks like, and
// which figures are recalculated. That logic lives here so it can be tested with
// `node` against no database and no Deno runtime, and so the same rules apply to
// both clients instead of being reimplemented per app.
//
// EDITABLE SOURCE vs CALCULATED
// The distinction the editor shows the user is the same one enforced here:
//
//   EDITABLE SOURCE   what the workbook said and a human may correct: the
//                     identifiers, the recipient, the transport, the bank details,
//                     the terms, the footer wording, the tax RATES, and round-off
//   CALCULATED        derived from the above: every line amount, every total, the
//                     tax amounts, and (unless overridden) the amount in words
//
// `round_off` is editable and NOT calculated, and that is the decision that matters
// most: 9 of the 20 production invoices round, and the rounded figure is the one
// that was billed. Recomputing it would silently change what a customer owes.

import type { BillLineItem } from "./parseBill.ts";
import {
  amountInWords,
  applicableFromAmounts,
  bankLinesOf,
  computeTotals,
  defaultBankLabel,
  parseBankLines,
  round2,
  round3,
  type BankDetails,
  type BankPart,
  type BillRecord,
} from "./billDocument.ts";

/* ──────────────────────────────────────────────
   Limits
   ────────────────────────────────────────────── */

/**
 * Length ceilings, applied to every free-text field.
 *
 * A `text` column is unbounded in Postgres, so without these a single request could
 * write a megabyte into `invoice_no` and produce an invoice that cannot be laid out
 * on A4. A value over the ceiling is REJECTED, not truncated: silently shortening a
 * company name or a vehicle number produces a bill that is wrong in a way nobody
 * notices, and it fails later at render time — after the row was already saved,
 * which is the worst moment to discover it.
 */
export const LIMITS = {
  short: 200,
  address: 2000,
  text: 4000,
  lines: 200,
  lineDescription: 2000,
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GST_NO = /^[0-9A-Za-z]{15}$/;
const STATE_CODE = /^\d{1,4}$/;

/* ──────────────────────────────────────────────
   The patch
   ────────────────────────────────────────────── */

/* `BankPart` and `BankDetails` live in `billDocument.ts`, beside the record shape
   they belong to, so the stored form and the printed form cannot be described twice
   and drift. Re-exported here because a patch is written in terms of them. */
export type { BankPart, BankDetails } from "./billDocument.ts";

/** The fields a client may change. Anything not listed here is server-owned. */
export interface BillPatch {
  job_kind?: string | null;

  invoice_no?: string | null;
  invoice_date?: string | null;
  our_challan_no?: string | null;
  our_challan_date?: string | null;
  your_challan_no?: string | null;
  your_challan_date?: string | null;
  order_no?: string | null;
  order_no_label?: string | null;
  order_date?: string | null;
  eway_bill_no?: string | null;
  eway_bill_date?: string | null;

  recipient_label?: string | null;
  recipient_note?: string | null;
  party_name?: string | null;
  /** Multiline, newlines preserved. One source address line per entry. */
  party_address?: string | null;
  party_gst_no?: string | null;
  place_of_supply?: string | null;
  state?: string | null;
  state_code?: string | null;

  transporter_mode?: string | null;
  vehicle_number?: string | null;

  seller_name?: string | null;
  seller_descriptor?: string | null;
  seller_tax_line?: string | null;
  seller_address?: string | null;
  seller_contact?: string | null;

  /** Tax rates, as PERCENTAGES. A source field, not a derived one. */
  cgst_rate?: number | string | null;
  sgst_rate?: number | string | null;
  igst_rate?: number | string | null;
  /** Source field: what the business charged on a reverse-charge invoice. */
  reverse_charge_gst?: number | string | null;
  /** Source field: a human's rounding decision. Never recalculated. */
  round_off?: number | string | null;

  bank_details?: BankDetails | string[] | null;
  terms?: string | null;
  certification?: string | null;
  on_behalf_of?: string | null;
  signature_designation?: string | null;
  receiver_signature?: string | null;
  notes_extra?: string | null;

  /**
   * `null` means "regenerate from the new total"; a string means "keep exactly
   * this"; OMITTING the key means "leave the stored words alone".
   *
   * Three cases rather than two because the stored words are usually the
   * business's own phrasing — "EIGHTY THOUSAND EIGHT HUNDRED AND FIFTY ONLY" — and
   * silently regenerating them on every unrelated save would alter the printed
   * invoice for no reason the user asked for.
   */
  amount_in_words?: string | null;

  line_items?: LineItemPatch[];
}

export interface LineItemPatch {
  sr_no?: number | string | null;
  description?: string | null;
  hsn_code?: string | null;
  uom?: string | null;
  quantity?: number | string | null;
  rate?: number | string | null;
  /** Accepted and recomputed from quantity x rate; see `computeTotals`. */
  amount?: number | string | null;
}

/* ──────────────────────────────────────────────
   Coercion
   ────────────────────────────────────────────── */

/**
 * Trimmed text, or null. Blank means "this field is empty", never "".
 *
 * Over-long values are rejected rather than shortened; see `LIMITS`. `label` is the
 * name to put in the message, passed explicitly because two limits share a numeric
 * value and deriving the name from the number would be ambiguous.
 */
function clean(value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;
  if (s.length > max) {
    throw new EditError(
      `${label} is ${s.length} characters; the limit is ${max}. Shorten it before saving.`,
      label
    );
  }
  return s;
}

/**
 * A date, or null.
 *
 * `YYYY-MM-DD` only, because that is what a Postgres `date` column accepts and
 * what the renderer formats. A free-text date that is not a date would be stored as
 * a `text` value the column rejects, turning a typo into a 500.
 */
function cleanDate(value: unknown): string | null {
  const s = clean(value, 10, "a date");
  if (s === null) return null;
  if (!ISO_DATE.test(s)) throw new EditError(`"${s}" is not a date. Use YYYY-MM-DD, e.g. 2026-09-28.`);
  return s;
}

/** A finite number, or null. Rejects anything a `numeric` column would refuse. */
function cleanNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) throw new EditError(`${label} must be a number.`);
  return n;
}

/** Raised for anything the client got wrong. Carries a message worth showing. */
export class EditError extends Error {
  readonly field: string | null;
  constructor(message: string, field: string | null = null) {
    super(message);
    this.name = "EditError";
    this.field = field;
  }
}

/* ──────────────────────────────────────────────
   Bank details
   ────────────────────────────────────────────── */

/**
 * The four bank parts this template writes.
 *
 * The label/value model and the split of a printed line into parts both live in
 * `billDocument.ts`, beside the record shape they belong to, so the stored form and
 * the printed form cannot be described in two places and drift.
 */
const BANK_PART_KEYS = new Set(["bank_name", "account_number", "branch", "ifsc_code"]);

/** Validate a bank block, keeping the order the workbook used. */
function cleanBank(value: unknown): BankDetails | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return parseBankLines(value.map((l) => String(l)));

  const out: BankDetails = {};
  const raw = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(raw)) {
    // An unrecognised key is ignored rather than rejected: a client built against a
    // newer editor may send a part this build does not know, and refusing the whole
    // save over it would be worse than not offering the field.
    if (!BANK_PART_KEYS.has(key)) continue;
    if (entry === null || entry === undefined) continue;
    if (typeof entry === "string") {
      out[key] = { label: defaultBankLabel(key), value: clean(entry, LIMITS.short, "a bank value") ?? "" };
      continue;
    }
    const part = entry as Partial<BankPart>;
    out[key] = {
      label: clean(part.label, 60, "a bank label") ?? defaultBankLabel(key),
      value: clean(part.value, LIMITS.short, "a bank value") ?? "",
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/* ──────────────────────────────────────────────
   Line items
   ────────────────────────────────────────────── */

function cleanLineItems(value: unknown): BillLineItem[] {
  if (!Array.isArray(value)) throw new EditError("Line items must be a list.", "line_items");
  if (value.length > LIMITS.lines) {
    throw new EditError(`An invoice cannot have more than ${LIMITS.lines} line items.`, "line_items");
  }

  const out: BillLineItem[] = [];
  for (const [index, entry] of value.entries()) {
    const item = (entry ?? {}) as LineItemPatch;
    const where = `Line ${index + 1}`;

    const description = clean(item.description, LIMITS.lineDescription, "a line description");
    // A row with no description is not a line item, it is a blank row the editor
    // left behind. Dropping it is friendlier than rejecting the save, and it is
    // what the user meant by clearing the text.
    if (description === null) continue;

    const srRaw = cleanNumber(item.sr_no, `${where} number`);
    if (srRaw !== null && (!Number.isInteger(srRaw) || srRaw < 1)) {
      throw new EditError(`${where} number must be a whole number of 1 or more.`, "line_items");
    }

    const quantity = cleanNumber(item.quantity, `${where} quantity`);
    if (quantity !== null && quantity < 0) {
      throw new EditError(`${where} quantity cannot be negative.`, "line_items");
    }

    const rate = cleanNumber(item.rate, `${where} rate`);
    if (rate !== null && rate < 0) {
      throw new EditError(`${where} rate cannot be negative.`, "line_items");
    }

    out.push({
      srNo: srRaw ?? index + 1,
      description,
      hsnCode: clean(item.hsn_code, 32, "an HSN code"),
      uom: clean(item.uom, 16, "a unit"),
      quantity: quantity === null ? null : round3(quantity),
      rate: rate === null ? null : round2(rate),
      // The amount is CALCULATED. Whatever the client sent is ignored, because the
      // invoice's line amounts are quantity x rate everywhere in this template and
      // two numbers that disagree are how an invoice adds up to the wrong total.
      amount: quantity !== null && rate !== null ? round2(quantity * rate) : null,
    });
  }
  return out;
}

/* ──────────────────────────────────────────────
   The patch, cleaned
   ────────────────────────────────────────────── */

/** A patch with every field normalised, and every derived figure recomputed. */
export interface CleanedBill {
  /** Only the keys the client actually sent, so an absent key cannot null a value. */
  values: Record<string, unknown>;
  lineItems: BillLineItem[] | null;
  /** Set when the client asked for the words to be regenerated. */
  regenerateWords: boolean;
  /** Present when the client sent explicit words. */
  explicitWords: string | null;
}

/** The keys `applyPatch` may write. Anything else in the request is ignored. */
const EDITABLE = new Set<keyof BillPatch>([
  "job_kind",
  "invoice_no", "invoice_date",
  "our_challan_no", "our_challan_date",
  "your_challan_no", "your_challan_date",
  "order_no", "order_no_label", "order_date",
  "eway_bill_no", "eway_bill_date",
  "recipient_label", "recipient_note",
  "party_name", "party_address", "party_gst_no",
  "place_of_supply", "state", "state_code",
  "transporter_mode", "vehicle_number",
  "seller_name", "seller_descriptor", "seller_tax_line", "seller_address", "seller_contact",
  "cgst_rate", "sgst_rate", "igst_rate", "reverse_charge_gst", "round_off",
  "bank_details", "terms",
  "certification", "on_behalf_of", "signature_designation", "receiver_signature", "notes_extra",
  "amount_in_words",
]);

/**
 * Normalise a client patch.
 *
 * Throws `EditError` with a message meant for the admin who typed the value. Every
 * check here is one that would otherwise fail LATER and less clearly: a bad date is
 * a 500 from Postgres, a negative quantity is an invoice nobody can bill, and an
 * unknown column is a silently ignored edit.
 *
 * Only keys the client actually sent appear in the result. That is what makes a
 * partial save safe: a client that sends only `party_address` must not blank the
 * vehicle number, which is what a full-object write would do.
 */
export function applyPatch(patch: BillPatch): CleanedBill {
  const values: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(patch)) {
    if (rawKey === "line_items" || rawKey === "amount_in_words") continue;
    if (!EDITABLE.has(rawKey as keyof BillPatch)) continue;
    const key = rawKey as keyof BillPatch;

    switch (key) {
      /* identifiers and dates */
      case "invoice_no":
      case "our_challan_no":
      case "your_challan_no":
      case "order_no":
      case "eway_bill_no":
      case "order_no_label":
      case "vehicle_number":
        values[key] = clean(rawValue, LIMITS.short, "an identifier");
        break;
      case "invoice_date":
      case "our_challan_date":
      case "your_challan_date":
      case "order_date":
      case "eway_bill_date":
        values[key] = cleanDate(rawValue);
        break;

      /* names and free text */
      case "job_kind":
      case "recipient_label":
      case "recipient_note":
      case "transporter_mode":
      case "place_of_supply":
      case "state":
      case "seller_name":
      case "certification":
      case "on_behalf_of":
      case "signature_designation":
      case "receiver_signature":
        values[key] = clean(rawValue, LIMITS.text, "this text");
        break;
      case "state_code":
        values[key] = cleanStateCode(rawValue);
        break;
      case "party_name":
      case "party_gst_no":
        values[key] = key === "party_gst_no" ? cleanGst(rawValue) : clean(rawValue, LIMITS.short, "an identifier");
        break;
      case "party_address":
        // Newlines are the structure here, so they survive; a value that is only
        // whitespace is empty.
        values[key] = cleanMultiline(rawValue, LIMITS.address, "the billed-to address");
        break;
      case "seller_descriptor":
      case "seller_tax_line":
      case "seller_contact":
        values[key] = clean(rawValue, LIMITS.text, "this text");
        break;
      case "seller_address":
        values[key] = cleanMultiline(rawValue, LIMITS.address, "the billed-to address");
        break;
      case "terms":
      case "notes_extra":
        values[key] = cleanMultiline(rawValue, LIMITS.text, "this text");
        break;

      /* money */
      case "cgst_rate":
      case "sgst_rate":
      case "igst_rate":
        values[key] = cleanRate(rawValue, key);
        break;
      case "reverse_charge_gst":
        values[key] = cleanNumber(rawValue, "Reverse charge GST") === null
          ? null
          : round2(cleanNumber(rawValue, "Reverse charge GST")!);
        break;
      case "round_off":
        // Negative round-off is normal and correct: it is how a total rounds DOWN.
        values[key] = cleanNumber(rawValue, "Round off") === null
          ? null
          : round2(cleanNumber(rawValue, "Round off")!);
        break;

      case "bank_details":
        values[key] = cleanBank(rawValue);
        break;
    }
  }

  /* The invoice number is the bill's identity — it is the file name, the footer
     and the folder label — so an empty one is rejected rather than accepted and
     printed as a blank. Every other identifier is optional because a template may
     legitimately leave it out. */
  if ("invoice_no" in values && values.invoice_no === null) {
    throw new EditError("The invoice number is required.", "invoice_no");
  }

  const lineItems = "line_items" in patch ? cleanLineItems(patch.line_items) : null;

  return {
    values,
    lineItems,
    regenerateWords: "amount_in_words" in patch && patch.amount_in_words === null,
    explicitWords: "amount_in_words" in patch && patch.amount_in_words !== null
      ? clean(patch.amount_in_words, LIMITS.text, "the amount in words")
      : null,
  };
}

function cleanStateCode(value: unknown): string | null {
  const s = clean(value, 8, "the state code");
  if (s === null) return null;
  if (!STATE_CODE.test(s)) {
    throw new EditError(`State code "${s}" must be the number printed on the invoice, e.g. 27.`, "state_code");
  }
  return s;
}

function cleanGst(value: unknown): string | null {
  const s = clean(value, 20, "the GST number");
  if (s === null) return null;
  const up = s.toUpperCase();
  if (!GST_NO.test(up)) {
    throw new EditError(
      `A GST number is 15 letters and digits, e.g. 27AAACH1784M1Z9. "${s}" is not.`,
      "party_gst_no"
    );
  }
  return up;
}

/**
 * A tax RATE, as a percentage.
 *
 * Both 9 and 0.09 are accepted, because a user copying the figure off the old
 * invoice's `0.09` cell and typing it into an editor labelled "CGST %" is the
 * obvious thing to do and refusing it helps nobody. Anything above 100 is a
 * decimal fraction typed in the wrong column, not a tax rate, and is rejected.
 */
function cleanRate(value: unknown, label: string): number | null {
  const n = cleanNumber(value, label);
  if (n === null) return null;
  const percent = n > 0 && n < 1 ? n * 100 : n;
  if (percent < 0 || percent > 100) {
    throw new EditError(`${label.replace(/_/g, " ")} must be between 0 and 100.`, label);
  }
  return round2(percent);
}

/** Multiline text: newlines kept, trailing blank lines dropped. */
function cleanMultiline(value: unknown, max: number, label: string): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
  const trimmed = s.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max) {
    throw new EditError(
      `${label} is ${trimmed.length} characters; the limit is ${max}. Shorten it before saving.`,
      label
    );
  }
  return trimmed;
}

/* ──────────────────────────────────────────────
   The result
   ────────────────────────────────────────────── */

/**
 * The full set of values to write: the patch, plus every derived figure.
 *
 * The totals are computed from the POST-EDIT line items, so they follow a quantity
 * or rate change immediately. `round_off` is passed through as the stored value
 * because it is a decision, not a derivation.
 *
 * `existingLineItems` is passed explicitly rather than read off the record: line
 * items live in their own table, and a patch that omits them means "leave the lines
 * alone", which is different from "there are no lines".
 */
export function computeBillValues(
  existing: BillRecord,
  existingLineItems: BillLineItem[],
  patch: BillPatch
): {
  values: Record<string, unknown>;
  lineItems: BillLineItem[];
  totals: ReturnType<typeof computeTotals>;
} {
  const cleaned = applyPatch(patch);
  const lineItems = cleaned.lineItems ?? existingLineItems;

  const merged = { ...existing, ...cleaned.values } as BillRecord;
  const totals = computeTotals({
    lineItems,
    cgstRate: numberOrNull(merged.cgst_rate),
    sgstRate: numberOrNull(merged.sgst_rate),
    igstRate: numberOrNull(merged.igst_rate),
    /* Read from the amounts the bill ALREADY charges, never from the patch: the
       patch's tax amounts are derived and are about to be overwritten. An
       intra-state bill that charges CGST and SGST keeps charging those and keeps
       IGST at zero, whatever the IGST rate cell says. */
    applies: applicableFromAmounts(
      numberOrNull(existing.cgst),
      numberOrNull(existing.sgst),
      numberOrNull(existing.igst)
    ),
    roundOff: numberOrNull(merged.round_off),
  });

  const values: Record<string, unknown> = {
    ...cleaned.values,
    // Derived. Written on every save so the row and its PDF can never disagree.
    total_quantity: totals.totalQuantity,
    amount_before_tax: totals.amountBeforeTax,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    total_gst: totals.totalGst,
    amount_after_tax: totals.amountAfterTax,
    amount_in_words: cleaned.explicitWords
      ?? (cleaned.regenerateWords
        ? amountInWords(totals.amountAfterTax)
        : (existing.amount_in_words ?? null)),
  };

  return { values, lineItems, totals };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}