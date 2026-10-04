// src/services/invoiceBusinessProfile.ts
//
// Reading and saving the one invoice business profile.
//
// TWO FUNCTIONS, NOT FIVE. The profile is a singleton: exactly one row is in
// force at a time, enforced by the partial unique index in migration 0012. So
// there is nothing to create, delete, list or activate - there is a profile, and
// it is saved. The earlier shape of this file offered `createBusinessProfile`,
// `updateBusinessProfile`, `setActiveBusinessProfile` and a list, and every one of
// them was a way for two settings screens to disagree about which profile is in
// force.
//
// WHY BOTH CALLS GO THROUGH RPCs RATHER THAN THE TABLE
// Writing the table directly would need the client to "SELECT, then INSERT or
// UPDATE", which is a race: two admins saving at once would both see no row and
// both try to insert, and the loser would get a raw unique-violation error on a
// field they were not even looking at. `upsert_invoice_business_profile` decides
// that where the current state is visible, and reports a real failure reason.
//
// Reading goes through a function for the matching reason from the other side: "the
// active one" is a predicate a client-held filter expresses awkwardly, and the
// function carries the admin gate so the two apps ask for the profile identically.
//
// NEITHER FUNCTION REVEALS THE PROFILE TO A NON-ADMIN. The read function filters on
// the caller's admin status and the write function raises 42501, so this screen
// cannot become a way to read a company's bank details with a worker's token.

import { supabase } from "./supabase";
import { logAudit } from "./auditLog";
import {
  changedProfileFields,
  type InvoiceBusinessProfile,
  type InvoiceBusinessProfileFields,
} from "../types/invoiceBusinessProfile";

/**
 * The profile in force, or null when none has been configured.
 *
 * Null and "an empty profile" are the same thing to the renderer, so this returns
 * null rather than fabricating an empty row: it lets the screen show "nothing
 * configured yet" instead of a form full of blanks that looks like real data.
 *
 * A real error is thrown, never swallowed. The alternative - treating a failed
 * read as "no profile" - would show an admin an empty settings form and invite
 * them to save it, which is a full-save and would overwrite the configured
 * profile with whatever the screen happened to contain.
 */
export async function fetchInvoiceBusinessProfile(): Promise<InvoiceBusinessProfile | null> {
  const { data, error } = await supabase.rpc("read_invoice_business_profile");

  if (error) {
    // The most likely cause by far is migration 0012 not having been applied yet.
    // Saying so is more use to an admin than the raw PostgREST text, which names
    // a function that does not exist and reads like a fault in the app.
    throw new Error(
      /does not exist/i.test(error.message)
        ? "The invoice business profile is not available yet. Its database setup has not been applied."
        : error.message
    );
  }

  // The function returns SETOF, so PostgREST hands back an array - empty when no
  // profile has been saved. Guarding on the array shape also means a future
  // change to a scalar return cannot crash the screen with `data[0]` on null.
  const row = Array.isArray(data) ? data[0] : data;
  return (row as InvoiceBusinessProfile | null) ?? null;
}

/**
 * Save the profile, creating it on the first save and replacing it after that.
 *
 * A FULL save: every field is written from `fields`, so a field that was cleared
 * in the form is cleared in the profile. That is the behaviour a settings screen
 * needs, and it is why the migration's function assigns from EXCLUDED rather than
 * merging with what is stored - a merge could never remove a value.
 *
 * The audit entry records WHICH fields changed, never their values. This profile
 * holds bank account numbers and contact details, and the audit log is readable
 * by anyone who can read it; a diff of field NAMES is enough to answer "who
 * changed the payment window" without copying the account number into a second
 * table. The write is best-effort and cannot fail the save.
 */
export async function saveInvoiceBusinessProfile(
  fields: InvoiceBusinessProfileFields,
  previous: InvoiceBusinessProfile | null
): Promise<InvoiceBusinessProfile> {
  const { data, error } = await supabase.rpc("upsert_invoice_business_profile", {
    p_fields: fields,
  });

  if (error) {
    throw new Error(
      /not authorized|42501|administrator/i.test(error.message)
        ? "Only an active administrator can change the invoice business profile."
        : error.message
    );
  }

  const changed = changedProfileFields(previous, fields);
  void logAudit({
    action: previous ? "invoice_profile.updated" : "invoice_profile.created",
    targetType: "invoice_business_profile",
    targetId: (data as InvoiceBusinessProfile | null)?.id ?? previous?.id ?? null,
    detail: {
      changed_fields: changed,
      // Whether the payment window moved is called out on its own because it is the
      // one change that alters what an already-issued invoice WOULD say if it were
      // re-printed, which is exactly the question someone reads this log to ask.
      payment_days_changed: changed.includes("payment_days"),
    },
  });

  return data as InvoiceBusinessProfile;
}