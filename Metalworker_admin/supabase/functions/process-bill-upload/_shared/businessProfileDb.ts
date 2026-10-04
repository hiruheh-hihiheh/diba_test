// _shared/businessProfileDb.ts
//
// FETCHING THE INVOICE BUSINESS PROFILE, SERVER-SIDE.
//
// ONE FUNCTION. This is the only place in the billing system that asks the database
// for a profile, so the upload, the edit re-print and the logo re-print all read the
// same values the same way and cannot drift apart.
//
// WHY IT IS SEPARATE FROM businessProfile.ts
// That file is pure: merging a profile into a bill, substituting a template variable,
// and deciding whether a bill prints its own snapshot or today's profile are all
// decidable with no database and no network, which is why the self-test suite can
// prove every one of them in a plain Node process. This file needs a real client, so
// it lives alone and stays small enough that the split costs nothing.
//
// WHO IS ALREADY AUTHORISED BY THE TIME THIS RUNS
// Each caller has resolved the request's user and confirmed an active admin before
// reaching here (see the role / is_active checks at the top of each edge function).
// That is what makes a service-role read of the profile correct rather than an
// escalation: the profile table's own RLS gate is already satisfied by the person
// making the request, and the service role is only being used to read it on their
// behalf.
//
// WHICH PROFILE A BILL USES IS NOT DECIDED HERE
// It is not this file's business - a bill with a recorded snapshot renders from that
// snapshot even when the profile has since changed, and `profileForBill` in
// `businessProfile.ts` is where that rule lives, because it is pure.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { profileFromRow, type BusinessProfile } from "./businessProfile.ts";

/**
 * The service-role client every caller already holds.
 *
 * `invoiceLogo.ts` types its client the same way, and the two edge functions that
 * create theirs from a different module specifier still produce a client this accepts
 * — `ReturnType<typeof createClient>` is the supabase-js `SupabaseClient` either way,
 * which a hand-written structural interface is not.
 */
type Client = ReturnType<typeof createClient>;

/**
 * The profile currently in force, or an empty one.
 *
 * Returns an EMPTY profile rather than throwing when the table has no row: a
 * deployment that has not run migration 0012, and an admin who has never opened the
 * settings screen, both mean "there are no company defaults" — and the renderer
 * already treats that as "print exactly what the bill says". Failing the upload
 * instead would let a missing optional setting break invoice generation.
 *
 * A genuine database error still throws. Treating "the query failed" as "there are no
 * defaults" would print a whole workbook of invoices with no company address on them
 * and report success, which is the failure mode worth being loud about. The callers
 * unwind through their normal rollback when this throws.
 */
export async function loadActiveBusinessProfile(client: Client): Promise<BusinessProfile> {
  const { data, error } = await client
    .from("invoice_business_profiles")
    .select("*")
    .eq("is_active", true)
    .limit(1);

  if (error) throw new Error(`Could not read the invoice business profile: ${error.message}`);

  // `.limit(1)` returns an array. Taking the first element rather than assuming a
  // single row also means this cannot throw if the partial unique index is ever
  // dropped and two rows somehow exist: the render would proceed with one of them
  // rather than fail an upload over a shape change.
  const row = Array.isArray(data) ? data[0] : data;
  return profileFromRow((row ?? null) as Record<string, unknown> | null);
}