-- Migration: Invoice Business Profile — reusable company-level invoice defaults.
--
-- WHAT THIS ADDS
--   invoice_business_profiles   one row: the company's standing invoice defaults
--                                (header identity, bank block, terms, footer wording)
--   bills.business_profile_snapshot
--                                the defaults that were actually in force when this
--                                bill's PDFs were finalised
--   two small functions: read the profile, and save it
--
-- WHAT IT IS NOT
-- It is not a second copy of the invoice. A bill's own data still wins everywhere:
-- an Excel that supplies its own bank name keeps it, and this profile is consulted
-- only where the bill said nothing. That precedence is enforced in
-- `_shared/businessProfile.ts`, not here — the database cannot know whether a
-- workbook left a cell empty or filled it.
--
-- WHY A SEPARATE TABLE AND NOT COLUMNS ON BILLS
-- The same twenty-odd strings would otherwise be copied onto every `bills` row —
-- hundreds of rows holding one company's address and bank details — and "the admin
-- corrected the IFSC" would become a mass UPDATE with no way to see which invoices
-- had already been printed with the old one. One row, referenced by every render,
-- is what makes it a setting rather than data.
--
-- WHY A SNAPSHOT ON THE BILL
-- A PDF in storage is an artifact, not a view: editing the profile cannot reach
-- back and change a document that was already produced. But the other half of that
-- promise is that RE-PRINTING an old bill must not silently adopt today's settings
-- either — a re-print is "print this same invoice again", and if it came out with
-- a 60-day payment window where the original said 40, the invoice would be a
-- different document wearing the same number. So the values that were actually used
-- are recorded on the bill, and a re-print reads them back. New bills take the
-- current profile and snapshot it.
--
-- This is the same shape as `bills.logo_rendered_logo_id` from 0011: a fact about
-- an artifact, allowed to disagree with the live configuration, and that
-- disagreement is the signal.
--
-- NOTHING HERE IS SEEDED
-- There is deliberately no INSERT of sample company data. A profile row is created
-- the first time an admin saves the settings screen, from whatever that admin typed.
-- Shipping a migration that inserts a fictitious company name into a financial
-- system is how a real invoice ends up addressed to nobody at all.
--
-- NOTHING HERE MODIFIES AN EXISTING POLICY
-- `bills` keeps the access rules it has; a new column on a table is covered by that
-- table's own policies. No policy, grant, bucket or function from 0001–0011 is
-- changed. 0010 remains a separate, still-unapplied forward migration.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) invoice_business_profiles — the defaults
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every field is nullable. That is not sloppiness: it is what makes "blank" a
-- representable answer, and blank is a legitimate state for half a profile — a
-- company that has not been given an MSME number, or that has no second email.
-- NOT NULL plus '' would mean the same thing to this system, and would make
-- "the admin deliberately cleared this" indistinguishable from "never filled in".
CREATE TABLE IF NOT EXISTS public.invoice_business_profiles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Company / header
    company_name           text,
    business_description   text,
    gst_number             text,
    msme_number            text,
    office_address         text,
    email_1                text,
    email_2                text,
    mobile_1               text,
    mobile_2               text,

    -- Bank details. Deliberately free text: IFSC and account formats vary by bank
    -- and country, and a CHECK that encodes one bank's layout would reject a real
    -- customer's details at the database rather than at the point of use.
    bank_name              text,
    bank_branch            text,
    bank_ifsc              text,
    bank_account_number    text,

    -- Terms & conditions
    --
    -- The payment window is a NUMBER, not part of term_1's text, precisely so that
    -- changing it does not mean re-typing a sentence. `term_1` normally reads
    -- "Payment requested within {PAYMENT_DAYS} DAYS"; the number is substituted at
    -- render time and never written into the stored term.
    --
    -- `> 0` rather than `>= 1`: a zero- or negative-day payment term is not a
    -- shortened deadline, it is a mistake, and it would print "within 0 DAYS".
    -- There is deliberately no upper bound — some contracts genuinely run longer
    -- than a year, and an upper limit would be a business opinion, not a check.
    payment_days           integer CHECK (payment_days IS NULL OR payment_days > 0),
    term_1                 text,
    term_2                 text,
    term_3                 text,

    -- Footer / certification
    certification_text                 text,
    authorized_signatory_text          text,
    authorized_signatory_designation   text,
    receiver_signature_label           text,

    -- Exactly one row is in force. See the partial unique index below.
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.invoice_business_profiles IS
    'Company-level invoice defaults. A DEFAULT, never an override: a value supplied by the workbook or stored on the bill always wins. See _shared/businessProfile.ts.';

COMMENT ON COLUMN public.invoice_business_profiles.payment_days IS
    'The payment window in days. Substituted for {PAYMENT_DAYS} in term_1 and any other profile-supplied text. Never applied to terms the workbook supplied itself.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) At most one active profile, enforced rather than assumed
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Two invoices must never be able to disagree about which company details are in
-- force, so "one active" has to be a property of the DATABASE, not a convention
-- every future caller has to remember.
--
-- A partial UNIQUE index on the constant `true` is the smallest expression of
-- that: it can hold any number of rows, but at most one of them with
-- `is_active = true`. It is preferred over a CHECK on a singleton table because it
-- stays true if the table later grows to hold draft or historical profiles — the
-- column can be added to, and rows can be deactivated, without touching the
-- constraint.
--
-- It also costs nothing while unused: an index over zero rows is empty.
CREATE UNIQUE INDEX IF NOT EXISTS invoice_business_profiles_one_active
    ON public.invoice_business_profiles ((true))
    WHERE is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) bills.business_profile_snapshot — the defaults a bill was finalised with
-- ─────────────────────────────────────────────────────────────────────────────
--
-- jsonb, not twenty-odd more columns, for the same reason `bank_details` is jsonb
-- in 0005: this is a read-only record of what produced an artifact, not something
-- to query across bills or edit by hand. It grows with the profile without a
-- migration, and a bill that was finalised before any profile existed has no row
-- here at all — which is exactly the right answer for it.
--
-- Nullable, and left NULL for every existing bill. There is no backfill, and
-- writing one would be wrong: a bill printed months ago was printed from its
-- workbook, not from a profile that did not exist yet.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS business_profile_snapshot jsonb;

COMMENT ON COLUMN public.bills.business_profile_snapshot IS
    'The invoice_business_profiles values in force when this bill''s PDFs were finalised. Read back on re-print so a later profile edit cannot change an invoice that already exists. NULL means the bill was finalised without one.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) updated_at
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Declared here rather than in a trigger, so it follows the project's own
-- convention of a column plus a `BEFORE UPDATE` trigger written inline.
CREATE OR REPLACE FUNCTION public.touch_invoice_business_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_business_profiles_touch ON public.invoice_business_profiles;
CREATE TRIGGER invoice_business_profiles_touch
    BEFORE UPDATE ON public.invoice_business_profiles
    FOR EACH ROW EXECUTE FUNCTION public.touch_invoice_business_profile();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RLS — the same active-admin gate as the rest of billing
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A business profile is the company's bank account details, its GST registration
-- and its email addresses, printed on every invoice it issues. It is not public
-- information and it is not worker-facing: a processor correcting a line item has
-- no reason to read or change it, and no reason to be able to.
ALTER TABLE public.invoice_business_profiles ENABLE ROW LEVEL SECURITY;

-- TABLE-LEVEL GRANTS, NOT JUST POLICIES. On a Supabase project a new table in
-- `public` inherits the project's default privileges, so `anon` is handed SELECT,
-- INSERT, UPDATE and DELETE the moment it is created — and creating policies does
-- not take those grants back. Revoking at the ACL layer is what actually removes
-- the privilege; the policy then says the same thing a second time. Neither alone
-- is sufficient, which is why both are here.
REVOKE ALL ON TABLE public.invoice_business_profiles FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.invoice_business_profiles
    TO authenticated;

DROP POLICY IF EXISTS "invoice_business_profiles_no_anon_access"
    ON public.invoice_business_profiles;
CREATE POLICY "invoice_business_profiles_no_anon_access"
    ON public.invoice_business_profiles
    FOR ALL TO anon
    USING (false) WITH CHECK (false);

-- An authenticated ACTIVE ADMIN reads and manages the profile. Identical in shape
-- to `invoice_logos_admin_all` in 0011 and `bills_admin_all` in 0005, so all three
-- read the same way at a glance.
DROP POLICY IF EXISTS "invoice_business_profiles_admin_all"
    ON public.invoice_business_profiles;
CREATE POLICY "invoice_business_profiles_admin_all"
    ON public.invoice_business_profiles
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Read the profile in force
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One row, or nothing. A function rather than a bare SELECT because "the active
-- one" is a predicate PostgREST cannot express against a client-held filter, and
-- because the two admin apps then ask for the same thing in the same way instead
-- of each writing its own `eq('is_active', true)` and hoping.
--
-- The gate is inside the WHERE clause, as in 0011, so an unauthorised caller gets
-- zero rows rather than an error: from the outside, an inactive admin cannot even
-- learn that a profile exists.
CREATE OR REPLACE FUNCTION public.read_invoice_business_profile()
RETURNS SETOF public.invoice_business_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.*
      FROM public.invoice_business_profiles p
     WHERE p.is_active
       AND EXISTS (
             SELECT 1 FROM public.profiles pr
             WHERE pr.id = auth.uid() AND pr.role = 'admin' AND pr.is_active = true
           )
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.read_invoice_business_profile() FROM public;
GRANT EXECUTE ON FUNCTION public.read_invoice_business_profile() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Save the profile — create or update, in one call
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The settings screen has to work identically whether or not a profile exists
-- yet, and the app has no way to know in advance. Rather than making the client
-- branch on "SELECT, then INSERT or UPDATE", the decision is made here where the
-- current state is visible: this updates the active row if there is one and
-- inserts the first row if there is not.
--
-- `p_fields` is jsonb rather than thirty named parameters so that adding a field
-- to the profile later is a table change and a form field, not a function
-- signature change that every deployed copy of both clients would have to match.
-- Only the keys this table actually has are read; anything else in the jsonb is
-- ignored, so a stale client cannot smuggle a column past the grant check.
--
-- THIS IS A FULL SAVE, NOT A PATCH. Every field the profile has is written from
-- `p_fields` on every call, so a key the caller omitted is stored as NULL — which
-- is how an admin clears a field. That matches what the settings screen is: one
-- form holding the whole profile, saved whole. It is also why the alternative was
-- rejected — a partial save would need each of the twenty-odd assignments to
-- distinguish "key absent, keep what is stored" from "key present and null, clear
-- it", and COALESCE can only express the first of those, which would make it
-- impossible to ever remove a value once typed.
CREATE OR REPLACE FUNCTION public.upsert_invoice_business_profile(p_fields jsonb)
RETURNS public.invoice_business_profiles
LANGUAGE plpgsql
-- VOLATILE is the default for a plpgsql function, so this changes no behaviour. It is
-- written out because the function is SECURITY DEFINER and writes a row: saying so
-- explicitly stops anyone reading it later from assuming, wrongly, that it is safe to
-- call twice in one statement and get one answer.
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.invoice_business_profiles;
BEGIN
    -- SECURITY DEFINER bypasses the RLS above, so the gate that RLS would have
    -- applied has to be applied here instead. Checked first, before the profile is
    -- read at all, so an unauthorised caller learns nothing about it — not even
    -- whether one has been configured.
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'Only an active administrator may change the invoice business profile.'
            USING ERRCODE = '42501';
    END IF;

    IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
        RAISE EXCEPTION 'Business profile fields must be a JSON object.'
            USING ERRCODE = '22023';
    END IF;

    -- The payment window is the one field where a wrong value silently corrupts a
    -- sentence: "forty" would become "Payment requested within  DAYS" and still
    -- print. Refusing it here is what makes the difference between a settings
    -- mistake the admin sees immediately and a malformed term on a tax invoice
    -- nobody notices until a customer queries it.
    --
    -- Blank is allowed and means "not configured" — a company may have no payment
    -- window in its default terms at all — but anything that is present and is not
    -- a whole number of days is an error. Zero and negatives are left to the table's
    -- CHECK so there is exactly one place that decides what a valid window is.
    IF p_fields ? 'payment_days'
       AND p_fields->>'payment_days' IS NOT NULL
       AND btrim(p_fields->>'payment_days') <> ''
       AND (p_fields->>'payment_days') !~ '^\d+$' THEN
        RAISE EXCEPTION 'Payment days must be a whole number of days, got "%".', p_fields->>'payment_days'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.invoice_business_profiles (
        company_name, business_description, gst_number, msme_number, office_address,
        email_1, email_2, mobile_1, mobile_2,
        bank_name, bank_branch, bank_ifsc, bank_account_number,
        payment_days, term_1, term_2, term_3,
        certification_text, authorized_signatory_text,
        authorized_signatory_designation, receiver_signature_label,
        is_active, updated_by
    )
    VALUES (
        p_fields->>'company_name',
        p_fields->>'business_description',
        p_fields->>'gst_number',
        p_fields->>'msme_number',
        p_fields->>'office_address',
        p_fields->>'email_1',
        p_fields->>'email_2',
        p_fields->>'mobile_1',
        p_fields->>'mobile_2',
        p_fields->>'bank_name',
        p_fields->>'bank_branch',
        p_fields->>'bank_ifsc',
        p_fields->>'bank_account_number',
        -- Validated above, so this is a whole number or blank. A blank stays NULL,
        -- which is "no payment window configured" rather than "zero days".
        CASE WHEN btrim(coalesce(p_fields->>'payment_days', '')) = '' THEN NULL
             ELSE btrim(p_fields->>'payment_days')::int END,
        p_fields->>'term_1',
        p_fields->>'term_2',
        p_fields->>'term_3',
        p_fields->>'certification_text',
        p_fields->>'authorized_signatory_text',
        p_fields->>'authorized_signatory_designation',
        p_fields->>'receiver_signature_label',
        true,
        auth.uid()
    )
    ON CONFLICT ((true)) WHERE is_active
    DO UPDATE SET
        -- EXCLUDED is the row this statement proposed, so this assigns the profile
        -- exactly as sent rather than merging with whatever is stored. `updated_at`
        -- is set by the table's trigger, which fires on this UPDATE as it would on
        -- any other.
        company_name = EXCLUDED.company_name,
        business_description = EXCLUDED.business_description,
        gst_number = EXCLUDED.gst_number,
        msme_number = EXCLUDED.msme_number,
        office_address = EXCLUDED.office_address,
        email_1 = EXCLUDED.email_1,
        email_2 = EXCLUDED.email_2,
        mobile_1 = EXCLUDED.mobile_1,
        mobile_2 = EXCLUDED.mobile_2,
        bank_name = EXCLUDED.bank_name,
        bank_branch = EXCLUDED.bank_branch,
        bank_ifsc = EXCLUDED.bank_ifsc,
        bank_account_number = EXCLUDED.bank_account_number,
        payment_days = EXCLUDED.payment_days,
        term_1 = EXCLUDED.term_1,
        term_2 = EXCLUDED.term_2,
        term_3 = EXCLUDED.term_3,
        certification_text = EXCLUDED.certification_text,
        authorized_signatory_text = EXCLUDED.authorized_signatory_text,
        authorized_signatory_designation = EXCLUDED.authorized_signatory_designation,
        receiver_signature_label = EXCLUDED.receiver_signature_label,
        updated_by = auth.uid()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_invoice_business_profile(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_invoice_business_profile(jsonb) TO authenticated;

COMMENT ON FUNCTION public.upsert_invoice_business_profile(jsonb) IS
    'Create or replace the single active invoice business profile. Admin-only. A FULL save: every field is written from p_fields, so a key the caller omits is stored as NULL.';

COMMIT;