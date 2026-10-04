// _shared/businessProfile.ts
//
// THE INVOICE BUSINESS PROFILE, AS THE RENDERER SEES IT.
//
// WHAT THIS FILE IS
// The Invoice Business Profile is a set of company-level DEFAULTS: the company
// name, the bank block, the terms, the footer wording — everything an invoice
// repeats that does not change invoice to invoice. This module is the single
// place those defaults meet an invoice, and it does three things and nothing else:
//
//   1. fillTemplate()   substitute {PAYMENT_DAYS} / {COMPANY_NAME} in stored text
//   2. resolveProfile() the profile as a plain, fully-populated-or-null record
//   3. applyBusinessProfile()  fold a profile into a BillCopy, field by field
//
// WHY IT IS HERE AND NOT IN THE CLIENT
// A PDF is produced on the server, by `renderBillDocument`, from a `BillCopy`. If
// the defaults were resolved in either admin app, then the upload path and the
// edit path could each resolve them differently, and neither would be the code
// that actually draws the invoice. One module, called by the renderer, means the
// uploaded invoice and the re-printed one are folded the same way.
//
// THE RULE, AND IT IS ONE RULE
// For every field: the bill wins, then the profile, then blank.
//
//   bill has a value  -> use it, unchanged, whatever the profile says
//   bill has none     -> use the profile's value
//   neither has one   -> print nothing
//
// The first case is the reason this feature cannot break existing invoices. A
// workbook that supplies its own bank name keeps it; the profile is only ever
// consulted where the workbook said nothing.
//
// WHY "NO VALUE" MEANS NULL AND NOT ""
// `parseBill` and `billDocument` already agree on this: an invoice field that is
// empty is a NULL, not an empty string (see `text()` in billDocument.ts). So the
// test for "did the bill supply this?" is `!== null`, and a workbook that leaves a
// cell blank is treated as having supplied nothing — which is the same thing to
// an invoice, and is what lets a profile default appear at all. Nothing here
// reinterprets the parser; it reads the parser's own convention.
//
// NOTHING HERE QUERIES ANYTHING
// The renderer receives an already-resolved profile. Fetching it is the edge
// function's job. That keeps this file pure, which is what lets the self-test
// suite exercise every rule above without a database.

import type { BillCopy } from "./parseBill.ts";
import {
  bankLinesOf,
  defaultBankLabel,
  parseBankLines,
  type BankDetails,
} from "./billDocument.ts";

/* ═══════════════════════════════════════════════════════════════════════════
   The profile record
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One row of `invoice_business_profiles`, as far as the renderer is concerned.
 *
 * Every field is nullable and there is no `id`: exactly one profile is active at
 * a time, so an identifier would be a second thing that can disagree about which
 * profile is in force. The renderer only ever needs the VALUES.
 */
export interface BusinessProfile {
  companyName: string | null;
  businessDescription: string | null;
  gstNumber: string | null;
  msmeNumber: string | null;
  officeAddress: string | null;
  email1: string | null;
  email2: string | null;
  mobile1: string | null;
  mobile2: string | null;

  bankName: string | null;
  bankBranch: string | null;
  bankIfsc: string | null;
  bankAccountNumber: string | null;

  paymentDays: number | null;
  term1: string | null;
  term2: string | null;
  term3: string | null;

  certificationText: string | null;
  authorizedSignatoryText: string | null;
  authorizedSignatoryDesignation: string | null;
  receiverSignatureLabel: string | null;
}

/** A profile with nothing in it — what a caller passes when none is configured. */
export const NO_PROFILE: BusinessProfile = {
  companyName: null,
  businessDescription: null,
  gstNumber: null,
  msmeNumber: null,
  officeAddress: null,
  email1: null,
  email2: null,
  mobile1: null,
  mobile2: null,
  bankName: null,
  bankBranch: null,
  bankIfsc: null,
  bankAccountNumber: null,
  paymentDays: null,
  term1: null,
  term2: null,
  term3: null,
  certificationText: null,
  authorizedSignatoryText: null,
  authorizedSignatoryDesignation: null,
  receiverSignatureLabel: null,
};

/**
 * The database row as snake_case columns, which is what both clients receive and
 * what a `bills.business_profile_snapshot` jsonb column stores.
 *
 * One conversion, in one place, for all three callers: the upload path, the edit
 * path and the client. Anything else that maps these columns would be a third
 * spelling of the same record.
 */
export function profileFromRow(row: Record<string, unknown> | null | undefined): BusinessProfile {
  if (!row) return NO_PROFILE;
  const text = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
  // PostgREST returns `numeric`/`integer` as a number, but a jsonb snapshot read
  // back can hand it over as a string, so both have to work.
  const days = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };

  return {
    companyName: text(row.company_name),
    businessDescription: text(row.business_description),
    gstNumber: text(row.gst_number),
    msmeNumber: text(row.msme_number),
    officeAddress: text(row.office_address),
    email1: text(row.email_1),
    email2: text(row.email_2),
    mobile1: text(row.mobile_1),
    mobile2: text(row.mobile_2),
    bankName: text(row.bank_name),
    bankBranch: text(row.bank_branch),
    bankIfsc: text(row.bank_ifsc),
    bankAccountNumber: text(row.bank_account_number),
    paymentDays: days(row.payment_days),
    term1: text(row.term_1),
    term2: text(row.term_2),
    term3: text(row.term_3),
    certificationText: text(row.certification_text),
    authorizedSignatoryText: text(row.authorized_signatory_text),
    authorizedSignatoryDesignation: text(row.authorized_signatory_designation),
    receiverSignatureLabel: text(row.receiver_signature_label),
  };
}

/** True when the profile carries no value at all — so folding it in is a no-op. */
export function isEmptyProfile(profile: BusinessProfile | null | undefined): boolean {
  if (!profile) return true;
  return Object.values(profile).every((v) => v === null);
}

/**
 * The profile as the plain object a `business_profile_snapshot` column holds.
 *
 * Snapshotting means a bill records WHICH defaults produced its documents, so a
 * later edit to the profile cannot reach back and change an invoice that has
 * already been finalised. Only values that were actually in force are written:
 * a null field is stored as absent rather than as an explicit null, so a snapshot
 * of a half-configured profile is small and a change to an unrelated field shows
 * up as the one key that differs.
 */
export function profileToSnapshot(
  profile: BusinessProfile | null | undefined
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!profile) return out;
  const src: Record<string, string | number | null> = {
    company_name: profile.companyName,
    business_description: profile.businessDescription,
    gst_number: profile.gstNumber,
    msme_number: profile.msmeNumber,
    office_address: profile.officeAddress,
    email_1: profile.email1,
    email_2: profile.email2,
    mobile_1: profile.mobile1,
    mobile_2: profile.mobile2,
    bank_name: profile.bankName,
    bank_branch: profile.bankBranch,
    bank_ifsc: profile.bankIfsc,
    bank_account_number: profile.bankAccountNumber,
    payment_days: profile.paymentDays,
    term_1: profile.term1,
    term_2: profile.term2,
    term_3: profile.term3,
    certification_text: profile.certificationText,
    authorized_signatory_text: profile.authorizedSignatoryText,
    authorized_signatory_designation: profile.authorizedSignatoryDesignation,
    receiver_signature_label: profile.receiverSignatureLabel,
  };
  for (const [key, value] of Object.entries(src)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Which defaults a bill prints
   ═══════════════════════════════════════════════════════════════════════════ */

/** What a bill should render from, and what to record against it. */
export interface BillProfile {
  /** The values to fold into the bill. Empty means "change nothing". */
  profile: BusinessProfile;
  /** The snapshot to persist, or null when there is nothing worth recording. */
  snapshot: Record<string, string | number> | null;
}

/**
 * Decide which defaults a bill prints, given whatever it recorded last time.
 *
 * This is the entire historical-safety rule, and it is pure: it queries nothing, so the
 * self-test suite can prove it without a database. Fetching the current profile is the
 * edge function's job - see `businessProfileDb.ts`.
 *
 *   the bill has a snapshot  -> render from the snapshot, whatever the profile says
 *                              today. This is what makes a re-print of an old invoice
 *                              reproduce the invoice rather than quietly restate it.
 *   the bill has none         -> take the current profile and snapshot it, because
 *                              this is its first print with one configured, or it
 *                              predates the feature and has not been re-printed since.
 *
 * A bill finalised before any profile existed stores NULL, and NULL means "no profile
 * was in force" - the same outcome as an empty profile, so it needs no special case.
 */
export function profileForBill(current: BusinessProfile, storedSnapshot: unknown): BillProfile {
  // A snapshot is an OBJECT of plain values. Anything else - a string, a number, an
  // array - is not one this code wrote, and trusting it would mean rendering a
  // financial document from a value nobody can account for.
  if (isPlainObject(storedSnapshot) && Object.keys(storedSnapshot).length > 0) {
    const recorded = profileFromRow(storedSnapshot);
    return { profile: recorded, snapshot: profileToSnapshot(recorded) };
  }

  if (isEmptyProfile(current)) return { profile: NO_PROFILE, snapshot: null };
  return { profile: current, snapshot: profileToSnapshot(current) };
}

/** A snapshot candidate that is a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Template variables
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The variables a stored string may use. Two, deliberately.
 *
 * A template engine is a thing that can be got wrong, and the only reason for one
 * here is that an admin should not have to re-type "40" in five places when they
 * change the payment window. Two variables cover that completely. Anything wider
 * would be a language nobody asked for, and every extra token is another way for
 * a financial document to print something unintended.
 */
export const TEMPLATE_VARIABLES = ["PAYMENT_DAYS", "COMPANY_NAME"] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

/** `{PAYMENT_DAYS}` -> 40, `{COMPANY_NAME}` -> the company, once both are known. */
export type TemplateValues = Partial<Record<TemplateVariable, string | number | null>>;

const PLACEHOLDER_RE = /\{([A-Z_]+)\}/g;

/**
 * Substitute the supported variables in one string.
 *
 * A variable this function does not support is LEFT ALONE, and so is a supported
 * variable whose value is missing. Both are the same decision, and both matter:
 *
 *   - An unknown `{FOO}` reaching a financial document is a configuration mistake.
 *     Printing it verbatim makes it visible on the page; silently deleting it
 *     makes a sentence quietly lose a clause.
 *   - `{PAYMENT_DAYS}` with no payment window set would otherwise render
 *     "Payment requested within  DAYS", which is not a sentence anyone can pay by.
 *
 * So nothing is ever replaced by an empty string, and nothing throws. An unknown
 * variable cannot crash a render, which is the guarantee the tests pin.
 */
export function fillTemplate(text: string | null | undefined, values: TemplateValues): string | null {
  if (text === null || text === undefined) return text ?? null;
  return text.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) return whole;
    const value = (values as Record<string, string | number | null | undefined>)[name];
    if (value === null || value === undefined || value === "") return whole;
    return String(value);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   Folding a profile into a bill
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The bill's value if it has one, else the profile's, else nothing.
 *
 * An empty string counts as no value in BOTH arguments, which matches how the
 * parser and `billDocument.ts` already treat a blank invoice field: `null`, never
 * `""`. Reading an empty string as a real value would make the profile unreachable
 * for any workbook that writes an empty cell rather than leaving it out.
 */
function pick(explicit: string | null, fallback: string | null): string | null {
  if (explicit !== null && explicit !== "") return explicit;
  return fallback !== null && fallback !== "" ? fallback : null;
}

/**
 * The four bank parts, in the order the reference invoice prints them.
 *
 * Only ever used for parts the PROFILE supplied. The bill's own order is kept for
 * the bill's own parts, so a workbook that prints its bank block in some other
 * sequence still renders in that sequence — the profile fills gaps, it does not
 * reorder what the workbook wrote.
 */
const PROFILE_BANK_ORDER: { key: keyof BankDetails; value: (p: BusinessProfile) => string | null }[] = [
  { key: "branch", value: (p) => p.bankBranch },
  { key: "bank_name", value: (p) => p.bankName },
  { key: "ifsc_code", value: (p) => p.bankIfsc },
  { key: "account_number", value: (p) => p.bankAccountNumber },
];

/**
 * Merge the profile's bank parts into the bill's, one part at a time.
 *
 * The bill's bank block is not a blob of text here: `parseBankLines` has already
 * turned it into label/value parts, which is what makes a per-field merge
 * possible at all. Merging the raw lines instead would mean "Bank Name: ABC" from
 * the workbook and "Bank Name: XYZ" from the profile producing two contradictory
 * bank lines rather than one resolved one.
 *
 * A part the workbook printed keeps its own label and its own position, so its
 * line is rebuilt byte for byte. A part only the profile has is appended with the
 * conventional label for that key.
 *
 * Returns the ORIGINAL array when the profile adds nothing, so a bill whose
 * workbook already supplied every bank part renders exactly as it always has.
 */
function mergeBankLines(bankLines: string[], profile: BusinessProfile): string[] {
  const fromProfile = PROFILE_BANK_ORDER.filter((part) => part.value(profile) !== null);
  if (fromProfile.length === 0) return bankLines;

  const own = parseBankLines(bankLines);
  const merged: BankDetails = { ...own };
  let added = false;
  for (const part of fromProfile) {
    const value = part.value(profile);
    if (value === null) continue;
    if (own[part.key] !== undefined) continue; // the bill's own value wins
    merged[part.key] = { label: profileBankLabel(part.key), value };
    added = true;
  }
  if (!added) return bankLines;
  return bankLinesOf(merged);
}

/**
 * The label for a bank part that came from the profile, with its separator.
 *
 * `defaultBankLabel` deliberately returns no trailing space, because for a line the
 * WORKBOOK supplied the spacing is part of the line and must be reproduced exactly -
 * `Bank Name:X` stays `Bank Name:X`. There is no original spacing for a part being
 * built from nothing, though, and concatenating a bare label onto a value would print
 * "BRANCH:MUMBAI". So the separator is supplied here, once, rather than by editing the
 * shared helper and changing how every parsed line is rebuilt.
 */
function profileBankLabel(key: string): string {
  return `${defaultBankLabel(key)} `;
}

/**
 * The contact line: the emails and mobiles, in that order, skipping the blanks.
 *
 * The header draws `sellerContact` as ONE wrapped paragraph, so a newline between
 * them would be collapsed away by the wrapper and produce two values run together
 * with no separator. A comma and a space survives wrapping and reads correctly
 * whether the block fits on one line or wraps.
 */
function mergeContact(explicit: string | null, profile: BusinessProfile): string | null {
  if (explicit !== null) return explicit;
  const parts = [profile.email1, profile.email2, profile.mobile1, profile.mobile2].filter(
    (v): v is string => v !== null && v !== ""
  );
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * The single tax line the header prints.
 *
 * `sellerTaxLine` is one string, not two fields - an invoice prints both registration
 * numbers side by side on a single line, GST first and then MSME. So the merge is
 * whole-line: a bill that printed a tax line keeps it untouched, and the profile's GST
 * and MSME are only ever combined into a line of their own when the workbook printed
 * none. Half-joining them would mean parsing somebody's tax line to work out which
 * half was missing, which is a guess.
 */
function mergeTaxLine(explicit: string | null, profile: BusinessProfile): string | null {
  if (explicit !== null) return explicit;
  const parts: string[] = [];
  if (profile.gstNumber !== null) parts.push(`GST No.${profile.gstNumber}`);
  if (profile.msmeNumber !== null) parts.push(`MSME NO.${profile.msmeNumber}`);
  return parts.length === 0 ? null : parts.join(" ");
}

/**
 * The terms block, and where it came from.
 *
 * `termsLines` is free text — the parser has already classified every line under
 * "Terms & Conditions" as either a term or a signature line. There is no reliable
 * line-by-line correspondence with `term_1..term_3`, and inventing one would mean
 * deciding that a workbook's second term is "term 2", which is not a fact anyone
 * can rely on.
 *
 * So the merge is at the level the data actually has: a bill that printed any
 * terms keeps exactly those, and a bill that printed none takes the profile's
 * three, in order.
 *
 * `fromProfile` is the part that matters. The payment window lives inside the terms
 * TEXT as a number rather than as a field of its own, so substituting
 * `{PAYMENT_DAYS}` into a bill's own terms would be the profile overwriting an
 * explicit value by a side door — a workbook that says "30 DAYS" must keep saying
 * 30 DAYS even after an admin sets 60. Only text the profile supplied may be
 * templated, which is exactly what this flag decides.
 */
function mergeTerms(
  termsLines: string[],
  profile: BusinessProfile
): { lines: string[]; fromProfile: boolean } {
  if (termsLines.length > 0) return { lines: termsLines, fromProfile: false };

  const stored = [profile.term1, profile.term2, profile.term3].filter(
    (v): v is string => v !== null && v.trim() !== ""
  );
  if (stored.length === 0) return { lines: termsLines, fromProfile: false };

  /* A stored term may be several source lines — term 2 in the reference invoice is
     "Payment requested by crossed PAYEES" / "A/C.CHEQUE/NEFT/RTGS only." — and the
     line break is part of the configured wording, so it is kept rather than
     collapsed. Templating happens in `applyBusinessProfile`, once the resolved
     company name is known. */
  const lines = stored.flatMap((term) =>
    term
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
  );
  return { lines, fromProfile: true };
}

/**
 * Fold a profile into a bill, field by field, and return the bill to render.
 *
 * Returns THE SAME OBJECT when the profile contributes nothing, not a copy. That
 * is deliberate and it is what protects every invoice printed without a profile
 * configured: there is no code path in which a null profile can alter a single
 * coordinate, because the renderer receives back the very object it was given.
 *
 * The bill's own values are never modified in place — `BillCopy` is shared between
 * the three print copies and between the upload and re-print paths, so a mutation
 * here would leak from one invoice into another.
 */
export function applyBusinessProfile(
  bill: BillCopy,
  profile: BusinessProfile | null | undefined
): BillCopy {
  if (isEmptyProfile(profile)) return bill;
  const p = profile as BusinessProfile;

  const bankLines = mergeBankLines(bill.bankLines, p);
  const terms = mergeTerms(bill.termsLines, p);

  /* The values a template may reference, taken from the RESOLVED bill wherever the
     bill supplies the field. `{COMPANY_NAME}` therefore prints the invoice's own
     company name rather than the profile's whenever the two differ, which is the
     only reading consistent with "the bill wins". */
  const companyName = pick(bill.sellerName, p.companyName);
  const values: TemplateValues = { COMPANY_NAME: companyName, PAYMENT_DAYS: p.paymentDays };

  const onBehalfOf = pick(bill.onBehalfOf, p.authorizedSignatoryText);
  const certification = pick(bill.certification, p.certificationText);

  return {
    ...bill,
    sellerName: companyName,
    sellerDescriptor: pick(bill.sellerDescriptor, p.businessDescription),
    sellerTaxLine: mergeTaxLine(bill.sellerTaxLine, p),
    sellerAddress: pick(bill.sellerAddress, p.officeAddress),
    sellerContact: mergeContact(bill.sellerContact, p),
    bankLines,
    // Only the PROFILE's terms are templated. A bill's own terms already carry the
    // payment window its workbook specified, and rewriting that number here would
    // be the profile winning a field the bill explicitly supplied.
    termsLines: terms.fromProfile
      ? terms.lines.map((line) => fillTemplate(line, values) ?? line)
      : terms.lines,
    certification: certification === null ? null : fillTemplate(certification, values),
    onBehalfOf: onBehalfOf === null ? null : fillTemplate(onBehalfOf, values),
    signatureDesignation: pick(bill.signatureDesignation, p.authorizedSignatoryDesignation),
    receiverSignature: pick(bill.receiverSignature, p.receiverSignatureLabel),
  };
}