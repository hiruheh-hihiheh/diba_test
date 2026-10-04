// src/types/invoiceBusinessProfile.ts
//
// The Invoice Business Profile: one company's standing invoice defaults.
//
// A DEFAULT, never an override. A bill's own values always win; the profile is
// consulted only where a bill said nothing. That rule is enforced on the server, in
// `supabase/functions/process-bill-upload/_shared/businessProfile.ts`, because that
// is where the PDF is actually drawn - and this file deliberately contains NO merge
// logic, so there is no second, drifting copy of the precedence rule in a client.
//
// The two apps each carry their own copy of these types and of the service, rather
// than sharing a package. They are separate builds with separate tsconfigs and
// separate dependency trees, and the fields they describe are the database's column
// names - which is the one thing both must agree on, and which the migration's RPC
// signatures enforce.
//
// The column names are snake_case for the same reason they are in the admin app: they
// are the database's, and the form, the service and the migration all refer to the
// same names.

/** The fields an admin can edit, in display order. `as const` for key checking. */
export const PROFILE_FIELD_KEYS = [
  "company_name",
  "business_description",
  "gst_number",
  "msme_number",
  "office_address",
  "email_1",
  "email_2",
  "mobile_1",
  "mobile_2",
  "bank_name",
  "bank_branch",
  "bank_ifsc",
  "bank_account_number",
  "payment_days",
  "term_1",
  "term_2",
  "term_3",
  "certification_text",
  "authorized_signatory_text",
  "authorized_signatory_designation",
  "receiver_signature_label",
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

/**
 * The editable values. Nullable rather than `""`, because the renderer already reads
 * a blank invoice field as NULL - and null is a legitimate answer: a company with no
 * MSME number, no second email, or no payment window in its standard terms.
 *
 * `payment_days` is the one number. It is a number rather than part of term 1's text
 * precisely so that changing it does not mean re-typing a sentence - and it is the
 * one field where a non-number could not be allowed through, because it is
 * substituted into a sentence and would print as a gap.
 */
export type InvoiceBusinessProfileFields = {
  [K in ProfileFieldKey]: K extends "payment_days" ? number | null : string | null;
};

/** The `invoice_business_profiles` row, as read. */
export interface InvoiceBusinessProfile extends InvoiceBusinessProfileFields {
  id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
}

/**
 * What the form holds while it is being edited.
 *
 * Every field is a plain string, including `payment_days`. The alternative -
 * `number | null` straight from an input - means every keystroke is a parse that can
 * fail, and a partially-typed "4" of "45" cannot be represented at all. The string
 * is converted once, at save, after validation has had a chance to reject a
 * non-number with a message the admin can act on.
 */
export type InvoiceBusinessProfileForm = Record<ProfileFieldKey, string>;

/** A profile with every field blank - the form's starting state. */
export function emptyProfileForm(): InvoiceBusinessProfileForm {
  const form = {} as InvoiceBusinessProfileForm;
  for (const key of PROFILE_FIELD_KEYS) form[key] = "";
  return form;
}

/** The form's state as the stored values. */
export function formFromProfile(
  profile: InvoiceBusinessProfileFields | null | undefined
): InvoiceBusinessProfileForm {
  const form = emptyProfileForm();
  if (!profile) return form;
  for (const key of PROFILE_FIELD_KEYS) {
    const value = profile[key];
    // A number arrives as a number from PostgREST and as a string from a jsonb
    // snapshot, so both are handled here rather than at each call site.
    form[key] = value === null || value === undefined ? "" : String(value);
  }
  return form;
}

/** Per-field validation messages. Absent key means the field is fine. */
export type ProfileFieldErrors = Partial<Record<ProfileFieldKey, string>>;

/**
 * Check a form before it is saved.
 *
 * Only ONE rule is enforced, and it is the one that would otherwise fail silently and
 * invisibly: `payment_days` has to be a whole number of days. Everything else is free
 * text.
 *
 * That is a deliberate choice against "helpful" validation. A GST-number shape check,
 * a phone regex, a required company name - each would reject a real customer's data
 * for a reason that is a house style rather than a fact. Those values are printed on
 * tax invoices in many formats, and a database that refuses one of them makes the
 * admin work around the software instead of using it.
 *
 * `payment_days` is different in kind: it is substituted into a sentence, so a
 * non-number does not fail loudly, it produces "Payment requested within  DAYS" on a
 * real invoice. Refusing to save is the only place that can be caught.
 */
export function validateProfileForm(form: InvoiceBusinessProfileForm): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  const raw = form.payment_days.trim();

  if (raw !== "") {
    if (!/^\d+$/.test(raw)) {
      errors.payment_days = "Enter the payment window as whole days, e.g. 40.";
    } else if (Number(raw) <= 0) {
      errors.payment_days = "The payment window must be at least 1 day.";
    }
  }

  return errors;
}

/** True when nothing needs correcting. */
export function profileFormIsValid(errors: ProfileFieldErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * The form as the values to store: trimmed, with blanks becoming null.
 *
 * Trimming is the one normalisation applied on save. A trailing space in a bank
 * account number is invisible in the input and prints as a gap in the PDF, and an
 * all-whitespace value is an accident rather than an answer - so it is stored as null,
 * which means "not configured", exactly like leaving the field empty.
 *
 * `payment_days` becomes a number or null, and never a string, so the column's
 * integer type is honoured rather than fighting it.
 */
export function fieldsFromForm(form: InvoiceBusinessProfileForm): InvoiceBusinessProfileFields {
  const fields = {} as Record<ProfileFieldKey, string | number | null>;
  for (const key of PROFILE_FIELD_KEYS) {
    const trimmed = form[key].trim();
    if (trimmed === "") {
      fields[key] = null;
    } else if (key === "payment_days") {
      fields[key] = Number(trimmed);
    } else {
      fields[key] = trimmed;
    }
  }
  return fields as InvoiceBusinessProfileFields;
}

/**
 * The field names whose value differs between two profiles.
 *
 * Used for the audit entry, so "who changed the payment window, and when" is
 * answerable later. The names only - never the values - because this detail column is
 * read by anyone who can read the audit log, and a bank's account number and a
 * company's email addresses do not belong there.
 */
export function changedProfileFields(
  before: InvoiceBusinessProfileFields | null,
  after: InvoiceBusinessProfileFields
): ProfileFieldKey[] {
  return PROFILE_FIELD_KEYS.filter((key) => (before?.[key] ?? null) !== (after[key] ?? null));
}