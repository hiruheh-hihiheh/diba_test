-- Migration: Invoice logos — a reusable logo library, referenced by bills.
--
-- WHAT THIS ADDS
--   invoice_logos   one row per logo the company owns (a letterhead mark)
--   bills.logo_id   which logo, if any, prints on this invoice's header
--   a private `invoice-logos` storage bucket holding the image bytes
--   two small functions: one usage count per logo, one work queue of bills
--                      whose stored PDF does not yet match their logo
--
-- WHY A SEPARATE TABLE AND NOT A COLUMN ON BILLS
-- A logo is an asset owned by the company and reused across many invoices. The
-- alternative — a logo path or URL copied onto every bill — would put the same
-- string on hundreds of rows, make "rename this logo" a mass UPDATE, and make it
-- possible for two bills claiming the same logo to name different files. One row
-- per logo, referenced by id, means a rename is a single write and the bytes are
-- stored once. The invoice's own identity never copies the image; only its id.
--
-- AT MOST ONE LOGO PER BILL
-- `logo_id` is a single column, not an array and not a join table. A tax invoice
-- has one letterhead. Allowing several would mean deciding which one prints, and
-- that ambiguity is not worth the flexibility.
--
-- DELETING A LOGO IS RESTRICTED, NOT CASCADE
-- ON DELETE RESTRICT (the default, stated here to be deliberate) is what actually
-- enforces "no bill may ever point at a deleted logo". The API refuses the delete
-- while a logo is in use and tells the admin how many bills and which, so the
-- repair is a decision they make; the constraint is the backstop that holds even
-- if that check is ever bypassed. SET NULL would quietly strip the letterhead from
-- every invoice that used the logo and leave those PDFs — already printed and
-- stored — disagreeing with the database.
--
-- NOTHING HERE MODIFIES AN EXISTING POLICY
-- `bills` keeps the access rules it already has; a new column on a table is
-- covered by that table's existing policies. The new table and the new bucket get
-- their own active-admin-only rules, which is the same gate the billing tables
-- use. No policy, grant or bucket from 0005–0010 is changed.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) invoice_logos — the library
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_logos (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The admin's name for it, e.g. "SAASTHA letterhead". Free text on purpose:
    -- there is no fixed set of logos to validate against, and forcing one would
    -- make adding a customer's mark a schema change.
    name          text NOT NULL,
    -- Bucket-relative object name inside the `invoice-logos` bucket. Stored, not
    -- the full URL: the bucket is private and a public URL would stop working the
    -- day the project id or region changed.
    storage_path  text NOT NULL,
    -- What the admin's file was called, kept for display only. Never used to build
    -- a path — `storage_path` is the only thing that addresses the object.
    file_name     text,
    -- Intrinsic pixel size, recorded at upload so the UI can lay a logo out at the
    -- right aspect ratio without downloading and decoding the image first, and so
    -- the PDF renderer can do the same on the server.
    pixel_width   integer,
    pixel_height  integer,
    -- What the admin's file was, also recorded for display. Constrained below to
    -- the only two formats the PDF writer can embed (see the note on the bucket).
    content_type  text,
    byte_size     bigint,
    created_by    uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.invoice_logos IS
    'Reusable letterhead logos. Referenced by bills.logo_id; the image bytes live in the private `invoice-logos` bucket at storage_path.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) bills.logo_id — which logo prints, if any
-- ─────────────────────────────────────────────────────────────────────────────
-- Both columns are nullable / defaulted, so every row that exists today keeps
-- meaning exactly what it meant: no logo. There is no data migration here, and
-- adding this column cannot change how an existing invoice renders.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS logo_id uuid REFERENCES public.invoice_logos (id) ON DELETE RESTRICT;

-- Which logo is actually baked into this bill's stored PDFs.
--
-- This is the one piece of state the feature genuinely needs, and it exists
-- because a PDF in storage is a snapshot: assigning a logo changes the bill, but
-- it cannot retroactively change a document that was already rendered and
-- uploaded. So the bill records the logo its documents were last printed with.
--
-- A bill is out of date exactly when that differs from `logo_id`, and writing it
-- as `logo_rendered_logo_id IS DISTINCT FROM logo_id` makes both directions of
-- change fall out of the same test — a logo that was assigned, and a logo that
-- was taken away. A first-class "dirty" flag cannot express removal: once
-- `logo_id` is NULL a bill looks exactly like one that never had a logo, while
-- its stored PDF still carries the old mark.
--
-- It is deliberately NOT a copy of the configuration. It is a fact about an
-- artifact on disk, and the two are allowed to disagree — that disagreement is
-- the whole signal.
--
-- No backfill is needed, and none is correct to write: every existing bill has
-- `logo_id` NULL and was printed with no logo, so NULL on both sides is already
-- the correct, in-sync answer.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS logo_rendered_logo_id uuid;

COMMENT ON COLUMN public.bills.logo_id IS
    'The invoice_logos row whose image should print in this bill''s header. NULL means no logo, which is the state of every pre-existing bill.';

COMMENT ON COLUMN public.bills.logo_rendered_logo_id IS
    'The logo actually burned into this bill''s stored PDFs. Behind logo_id when they differ, which is the whole meaning of a bill being queued for re-print. Set by the renderer after it writes all three copies, never by the assignment.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Indexes
-- ─────────────────────────────────────────────────────────────────────────────
-- These come last on purpose. `bills_logo_id_idx` indexes a column on `bills`,
-- and `bills.logo_id` does not exist until the ALTERs above have run — creating
-- the index any earlier fails outright with "column logo_id does not exist",
-- which is not a warning Postgres lets you defer past. An index is derived from
-- the table it describes, so it belongs after the table is in its indexed shape,
-- not before.

-- "used on N bills" is shown for every logo on the library screen and for every
-- row of a picker, so it is a lookup by id rather than a scan.
CREATE INDEX IF NOT EXISTS invoice_logos_name_idx
    ON public.invoice_logos (lower(name));

-- The library is small, but the bills side would be the expensive one otherwise.
-- Partial, so the index holds only the bills that actually carry a logo — which
-- on a freshly migrated database is none of them.
CREATE INDEX IF NOT EXISTS bills_logo_id_idx
    ON public.bills (logo_id)
    WHERE logo_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS — the same active-admin gate as the rest of billing
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoice_logos ENABLE ROW LEVEL SECURITY;

-- TABLE-LEVEL GRANTS, NOT JUST POLICIES.
-- On a Supabase project a new table in `public` inherits the project's default
-- privileges, so `anon` is handed SELECT, INSERT, UPDATE and DELETE on
-- `invoice_logos` the moment it is created — and creating policies does not take
-- those grants back. Left alone, `anon` would hold a live write grant on this
-- table, stopped only by the policy below.
--
-- Revoking at the ACL layer is what actually removes the privilege; the policy
-- then says the same thing a second time. Neither alone is sufficient, which is
-- why both are here. This affects the new table only and touches no billing
-- table, policy, grant or bucket.
REVOKE ALL ON TABLE public.invoice_logos FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.invoice_logos
    TO authenticated;

DROP POLICY IF EXISTS "invoice_logos_no_anon_access" ON public.invoice_logos;
CREATE POLICY "invoice_logos_no_anon_access"
    ON public.invoice_logos FOR ALL TO anon
    USING (false) WITH CHECK (false);

-- An authenticated active admin manages the library. Kept identical in shape to
-- `bills_admin_all` in 0005 so the two read the same way at a glance.
DROP POLICY IF EXISTS "invoice_logos_admin_all" ON public.invoice_logos;
CREATE POLICY "invoice_logos_admin_all"
    ON public.invoice_logos FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Private storage bucket for the logo images
-- ─────────────────────────────────────────────────────────────────────────────
-- Private, like `bills`. A logo is part of a financial document's letterhead, so
-- it is not something to put on a public CDN: a client's masthead is their
-- identity, and this bucket must not become readable by anyone holding the URL.
-- Only the two formats the PDF writer can embed are allowed, which means a file
-- that cannot be printed can never enter the library in the first place — the
-- failure is refused at the door rather than discovered at print time.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoice-logos', 'invoice-logos', false, 5242880,
        ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
    SET public                 = false,
        file_size_limit        = EXCLUDED.file_size_limit,
        allowed_mime_types     = EXCLUDED.allowed_mime_types;

-- Unlike the `bills` bucket, clients DO upload here: a logo is an admin-supplied
-- file, not a document this app generates, so there is nothing for an edge
-- function to produce on the admin's behalf. Read, write and delete are all
-- active-admin-only and all scoped to this bucket id, so none of them can reach
-- an object in any other bucket.
DROP POLICY IF EXISTS "invoice_logos_storage_read"   ON storage.objects;
DROP POLICY IF EXISTS "invoice_logos_storage_write"  ON storage.objects;
DROP POLICY IF EXISTS "invoice_logos_storage_delete" ON storage.objects;

CREATE POLICY "invoice_logos_storage_read"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'invoice-logos'
        AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true)
    );

CREATE POLICY "invoice_logos_storage_write"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'invoice-logos'
        AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true)
    );

CREATE POLICY "invoice_logos_storage_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'invoice-logos'
        AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true)
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Usage counts — "used on 24 bills"
-- ─────────────────────────────────────────────────────────────────────────────
-- The library screen lists every logo with how many bills carry it, and a picker
-- shows the same figure so an admin can tell a heavily-used logo from an unused
-- one before changing bills over to it. Counting per logo from the client would
-- be one COUNT request per row — an N+1 across the whole library. This returns
-- one row per logo in a single round trip.
--
-- Logos with no bills are returned with 0 rather than omitted, so a brand-new
-- logo renders as an ordinary row without the client having to merge two lists.
CREATE OR REPLACE FUNCTION public.get_invoice_logo_usage()
RETURNS TABLE (
    logo_id   uuid,
    bill_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT l.id,
           count(b.id) AS bill_count
    FROM public.invoice_logos l
    LEFT JOIN public.bills b
           ON b.logo_id = l.id
    WHERE EXISTS (
            -- Same active-admin gate as 0002 / 0004 / 0006 / 0009, applied before
            -- any logo or count is read.
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
          )
    GROUP BY l.id
    ORDER BY count(b.id) DESC, l.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_invoice_logo_usage() FROM public;
GRANT EXECUTE ON FUNCTION public.get_invoice_logo_usage() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Assigning a logo to many bills, in one statement
-- ─────────────────────────────────────────────────────────────────────────────
-- "Select 400 bills and assign a logo" has to be ONE round trip. Doing it from
-- the client would mean either 400 UPDATEs or one `.update().in(...)` — and the
-- `.in()` form cannot decide, per row, whether anything actually changed. That
-- decision is the important one: a bill already carrying this logo must not be
-- queued for re-printing, or "assign the same logo to 400 bills" would
-- re-render 400 PDFs to produce files identical to the ones already there.
--
-- So the rule lives here, where it can see every row at once:
--
--   changed   the bill's logo was different, so it now needs re-printing
--   unchanged it already carried exactly this logo (or no logo, for a removal),
--             so its stored PDFs are already correct and it is left alone
--
-- `logo_id IS DISTINCT FROM p_logo_id` is the whole comparison, and it treats
-- NULL as a value: assigning a logo to a bill that has none is a change, and
-- clearing a bill that has one is a change, while re-assigning the same logo to
-- a bill that already has it is not. That is what makes the call idempotent, so
-- a retry after a dropped connection cannot re-render the world.
--
-- Removing a logo is this same call with a NULL argument, which is why there is
-- no second function for it: assign and remove cannot drift apart, because they
-- are one code path.
--
-- The existence check on p_logo_id is what turns "a logo that has since been
-- deleted" into a clear error at the point of assignment. The FK would catch it
-- too, but as a bare constraint violation with no indication of which logo or
-- which bill was at fault.
CREATE OR REPLACE FUNCTION public.set_bill_logo(p_bill_ids uuid[], p_logo_id uuid)
RETURNS TABLE (
    bill_id uuid,
    changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_changed uuid[];
BEGIN
    -- SECURITY DEFINER bypasses the RLS on `bills`, so the gate that RLS would
    -- have applied has to be applied here instead. Checked first, before the logo
    -- is even looked at, so an unauthorised caller learns nothing about it.
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'Only an active administrator may assign a logo to a bill.'
            USING ERRCODE = '42501';
    END IF;

    IF p_logo_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.invoice_logos l WHERE l.id = p_logo_id
    ) THEN
        RAISE EXCEPTION 'That logo no longer exists.'
            USING ERRCODE = '23503';
    END IF;

    -- Collecting the updated ids needs a CTE and an aggregate, and the reason is
    -- worth writing down because the obvious form is wrong in a way that fails
    -- quietly. `UPDATE ... RETURNING b.id INTO v_changed` assigns through the same
    -- machinery as `SELECT ... INTO`: with a scalar target and more than one row
    -- returned, PL/pgSQL keeps the FIRST row and discards the rest. `v_changed` is
    -- a uuid[], so the single surviving id becomes a one-element array.
    --
    -- So the first four of those ids would be missing from `changed`, and the
    -- query below would then report them as `changed = false` — "already correct"
    -- for bills this very statement had just updated. The caller counts
    -- assigned + unchanged to detect missing bills, and that total would still add
    -- up, so nothing would have looked wrong: four invoices would carry a new logo
    -- while the response said they had not changed, and no re-print would be queued
    -- for them.
    --
    -- `array_agg` over the CTE collects every row the UPDATE touched. The COALESCE
    -- covers the no-rows case, where aggregate functions over an empty set yield
    -- NULL rather than an empty array. ORDER BY makes the result deterministic,
    -- which costs nothing and keeps the function's output testable.
    WITH changed AS (
        UPDATE public.bills b
           SET logo_id = p_logo_id
         WHERE b.id = ANY (p_bill_ids)
           AND b.logo_id IS DISTINCT FROM p_logo_id
        RETURNING b.id
    )
    SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[])
    INTO v_changed
    FROM changed;

    RETURN QUERY SELECT u.id, true FROM unnest(v_changed) AS u(id);

    -- Everything else that was asked for and exists. Reported as unchanged so the
    -- caller can distinguish "already correct" from "no such bill" — the second
    -- is worth surfacing, and silence would hide a stale list the user clicked.
    -- `v_changed` needs no guard here: the CTE above is the single place that
    -- establishes it as non-null, and a second COALESCE would only suggest it
    -- might not be.
    RETURN QUERY
    SELECT b.id, false
      FROM public.bills b
     WHERE b.id = ANY (p_bill_ids)
       AND NOT (b.id = ANY (v_changed));
END;
$$;

REVOKE ALL ON FUNCTION public.set_bill_logo(uuid[], uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.set_bill_logo(uuid[], uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) The re-print work queue
-- ─────────────────────────────────────────────────────────────────────────────
-- The other half of that split. An assignment is written immediately and in one
-- statement whatever the size of the selection; the PDFs are re-printed
-- separately, because each one is a render plus three storage uploads and doing
-- that inline would hold a request open for minutes.
--
-- This lists the bills whose stored documents no longer match their logo. The
-- predicate is a plain inequality between two columns, which PostgREST cannot
-- express — it filters a column against a literal, never column against column —
-- so this is a function rather than a query the client could write itself.
--
-- `logo_id IS NOT NULL` is NOT the filter. A bill whose logo was just removed is
-- the most important row in this queue: it needs re-printing precisely because
-- `logo_id` is now NULL, and filtering on it would discard it and leave the old
-- logo permanently burned into its stored PDF. The queue is driven entirely by
-- `logo_rendered_logo_id IS DISTINCT FROM logo_id`.
--
-- Capped at the database, and ordered, so a batch is bounded no matter how far
-- behind the work is. It is also self-healing: a bill leaves the queue the moment
-- its documents are brought up to date, so an interrupted job is resumed by
-- simply asking again rather than by keeping a cursor anywhere.
CREATE OR REPLACE FUNCTION public.list_bills_needing_logo_render(p_limit integer DEFAULT 100)
RETURNS TABLE (
    id            uuid,
    bill_upload_id uuid,
    logo_id       uuid,
    has_logo      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.id, b.bill_upload_id, b.logo_id, b.logo_id IS NOT NULL AS has_logo
    FROM public.bills b
    WHERE b.logo_rendered_logo_id IS DISTINCT FROM b.logo_id
      AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
          )
    -- Oldest invoice first, so a backlog drains from the beginning rather than
    -- re-printing the same recent rows on every pass.
    ORDER BY b.invoice_date NULLS LAST, b.created_at
    LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

REVOKE ALL ON FUNCTION public.list_bills_needing_logo_render(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.list_bills_needing_logo_render(integer) TO authenticated;

COMMIT;