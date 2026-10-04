-- Migration: Bill ↔ Job Connections — many-to-many links between invoices and jobs.
--
-- WHAT THIS ADDS
--   bill_job_connections   the relationship itself, and nothing else
--   seven small functions: link, unlink, and read the links four ways
--
-- WHAT IT IS NOT
-- It copies nothing. No bill field and no job field is denormalised onto the link
-- row: a link stores two ids, who made it and when. Every label the UI shows is
-- resolved from the real `bills` / `jobs` rows at read time, so renaming a job or
-- correcting an invoice number is reflected everywhere at once and there is no
-- second copy to fall out of date.
--
-- WHY ONE TABLE AND NOT TWO
-- The obvious worry with "link bills to Labour *and* With Material jobs" is that
-- labour and with-material might be different tables needing different link tables.
-- They are not. `jobs` is a SINGLE table carrying a `job_type` discriminator
-- constrained to ('labour', 'with_material'), so one link table with a real
-- foreign key to `jobs(id)` covers both, and the type of a linked job is a
-- property of the job rather than of the link. Splitting into
-- `bill_labour_links` / `bill_with_material_links` would have doubled every
-- query, every RPC and every index to store exactly the same rows.
--
-- WHY NOT A POLYMORPHIC `item_type` + `item_id`
-- `folder_items` uses that shape, and it is the right shape THERE: a folder can
-- hold jobs, bills, stock and groups at once, so there is no single table to point
-- a foreign key at and the database cannot enforce it. Here there are exactly two
-- tables and both are known, so this table takes two real foreign keys. That buys
-- referential integrity the polymorphic form cannot offer: a link to a job that was
-- deleted cannot exist, not even for one millisecond.
--
-- WHY ON DELETE CASCADE
-- A link has no meaning without both of its endpoints, and no content of its own to
-- preserve. Cascading is therefore the correct behaviour, and it is the behaviour
-- the database provides whether or not the client remembers to clean up: deleting a
-- job removes its links and leaves every bill untouched, and deleting a bill removes
-- its links and leaves every job untouched. The client's own delete paths
-- (`deleteJob`, `deleteBill`) predate this table and know nothing about it, so
-- cascade is also what stops them silently orphaning rows — the same reasoning as
-- `bill_line_items.bill_id`.
--
-- Contrast `bills.logo_id`, which is deliberately ON DELETE RESTRICT: a logo in use
-- is a decision an admin must make, and the constraint exists to stop them. A link
-- carries no such decision, so it cascades instead.
--
-- DUPLICATES ARE IMPOSSIBLE, NOT MERELY AVOIDED
-- The UNIQUE constraint is the guarantee, not the client code. `link_bill_jobs` also
-- uses ON CONFLICT DO NOTHING, so a second attempt is a no-op that reports
-- "already linked" rather than failing — which is what makes re-running a bulk link
-- safe.
--
-- SECURITY
-- This is an admin feature, gated exactly as `bills` is: an authenticated user whose
-- `profiles` row has role = 'admin' AND is_active = true. Inactive admins are
-- rejected, workers and processors are rejected, and anon is refused at the ACL
-- layer as well as by policy.
--
-- EVERY MUTATION GOES THROUGH A FUNCTION
-- `authenticated` is granted SELECT on this table and NOT INSERT/UPDATE/DELETE.
-- Writing a link therefore always means going through `link_bill_jobs` /
-- `unlink_bill_jobs` / `unlink_job_bill_links`, which re-check the admin gate
-- inside the function (SECURITY DEFINER bypasses RLS, so the gate RLS would have
-- applied has to be applied there instead) and run as one transaction. A client
-- cannot write a link row directly even if it is an active admin.
--
-- NOTHING HERE MODIFIES AN EXISTING POLICY
-- No policy, grant, bucket, column or function from 0001–0012 is changed. The new
-- table and the new functions get their own active-admin rules, which are the same
-- gate the billing tables already use.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) bill_job_connections — the relationship
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bill_job_connections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Both endpoints are real foreign keys, and both cascade. `bill_id` is listed
    -- first because it is the leading column of the unique index below, so every
    -- "which jobs does this bill have" lookup is served by that index.
    bill_id     uuid NOT NULL
                    REFERENCES public.bills (id) ON DELETE CASCADE,
    job_id      uuid NOT NULL
                    REFERENCES public.jobs  (id) ON DELETE CASCADE,

    -- Who made the link. SET NULL rather than CASCADE, matching `invoice_logos`
    -- and `bill_uploads`: deleting a profile must not delete relationships, and a
    -- link made by a since-departed admin is still a real fact about the invoice.
    created_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    -- A bill/job pair exists at most once. Named rather than inline so the error
    -- and the index share one definition.
    CONSTRAINT bill_job_connections_pair_key UNIQUE (bill_id, job_id)
);

COMMENT ON TABLE public.bill_job_connections IS
    'Many-to-many links between bills and jobs. Stores ids only: no bill or job data is copied here.';

COMMENT ON COLUMN public.bill_job_connections.created_by IS
    'The admin who created the link, or NULL if that profile has since been deleted.';

-- `bill_job_connections_pair_key` already indexes bill_id as its leading column, so
-- this is the only extra index needed: it serves "which bills does this job have"
-- and the per-job count aggregation.
CREATE INDEX IF NOT EXISTS bill_job_connections_job_id_idx
    ON public.bill_job_connections (job_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RLS — the same active-admin gate as the rest of billing
-- ─────────────────────────────────────────────────────────────────────────────
-- These policies are identical in shape to `bills_admin_all` from 0005 and to
-- `invoice_business_profiles_admin_all` from 0012. Quoted rather than factored into
-- a helper because the repo has no such helper yet and inventing one here would
-- change how every other table is written.
ALTER TABLE public.bill_job_connections ENABLE ROW LEVEL SECURITY;

-- anon can never touch connections.
DROP POLICY IF EXISTS "bill_job_connections_no_anon_access" ON public.bill_job_connections;
CREATE POLICY "bill_job_connections_no_anon_access"
    ON public.bill_job_connections FOR ALL TO anon
    USING (false) WITH CHECK (false);

-- An authenticated, active admin may read connections. Deliberately SELECT only:
-- writes go through the SECURITY DEFINER functions below, which re-check this same
-- gate inside the transaction.
DROP POLICY IF EXISTS "bill_job_connections_admin_read" ON public.bill_job_connections;
CREATE POLICY "bill_job_connections_admin_read"
    ON public.bill_job_connections FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));

-- TABLE-LEVEL GRANTS, NOT JUST POLICIES.
-- On a Supabase project a new table in `public` inherits the project's default
-- privileges, so `anon` is handed SELECT, INSERT, UPDATE and DELETE the moment it
-- is created — and creating policies does not take those grants back. Revoking at
-- the ACL layer is what actually removes the privilege; the policy above then says
-- the same thing a second time.
--
-- Note the asymmetry with 0011/0012, which granted all four privileges: this table
-- is a relationship, and the only safe way to write one is through a function that
-- validates both endpoints, is idempotent and is transactional. `authenticated` is
-- granted SELECT and nothing else.
REVOKE ALL ON TABLE public.bill_job_connections FROM anon;
GRANT SELECT ON TABLE public.bill_job_connections TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Link jobs to a bill — one call, idempotent, one transaction
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns one row per requested job so the caller can say which links were new and
-- which already existed, instead of only learning the total.
CREATE OR REPLACE FUNCTION public.link_bill_jobs(p_bill_id uuid, p_job_ids uuid[])
RETURNS TABLE (
    job_id  uuid,
    linked  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inserted uuid[];
BEGIN
    -- SECURITY DEFINER bypasses the RLS above, so the gate that RLS would have
    -- applied has to be applied here instead. Checked first, before the bill or
    -- any job is looked at, so an unauthorised caller learns nothing about either.
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'Only an active administrator may link jobs to a bill.'
            USING ERRCODE = '42501';
    END IF;

    IF p_bill_id IS NULL THEN
        RAISE EXCEPTION 'A bill is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_job_ids IS NULL OR coalesce(array_length(p_job_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'At least one job is required.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.bills b WHERE b.id = p_bill_id) THEN
        RAISE EXCEPTION 'That bill no longer exists.'
            USING ERRCODE = '23503';
    END IF;

    -- An unknown job is an error, not a silent no-op. A bulk link that quietly
    -- skipped three of six jobs because they had been deleted a second earlier
    -- would report success and leave the admin with the wrong picture.
    IF EXISTS (
        SELECT 1 FROM unnest(p_job_ids) AS u(id)
        WHERE NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = u.id)
    ) THEN
        RAISE EXCEPTION 'One of those jobs no longer exists.'
            USING ERRCODE = '23503';
    END IF;

    -- ON CONFLICT DO NOTHING, not DO UPDATE: re-running the same bulk link must not
    -- rewrite created_at or created_by and pretend the link is new.
    WITH ins AS (
        INSERT INTO public.bill_job_connections (bill_id, job_id, created_by)
        SELECT p_bill_id, u.id, auth.uid()
          FROM unnest(p_job_ids) AS u(id)
        ON CONFLICT (bill_id, job_id) DO NOTHING
        RETURNING job_id
    )
    SELECT coalesce(array_agg(job_id), '{}'::uuid[])
      INTO v_inserted
      FROM ins;

    -- DISTINCT because a caller may pass the same id twice; ON CONFLICT absorbs the
    -- duplicate insert but the report should still be one row per job.
    RETURN QUERY
        SELECT DISTINCT u.id, u.id = ANY (v_inserted)
          FROM unnest(p_job_ids) AS u(id);
END;
$$;

REVOKE ALL ON FUNCTION public.link_bill_jobs(uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.link_bill_jobs(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.link_bill_jobs(uuid, uuid[]) IS
    'Link jobs to one bill in a single transaction. Idempotent: an existing pair is left untouched and reported as linked = false. Admin-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Unlink jobs from a bill
-- ─────────────────────────────────────────────────────────────────────────────
-- Deletes only the relationship. No bill and no job is touched, and unlinking a
-- pair that was never linked is reported as unlinked = false rather than failing.
CREATE OR REPLACE FUNCTION public.unlink_bill_jobs(p_bill_id uuid, p_job_ids uuid[])
RETURNS TABLE (
    job_id    uuid,
    unlinked  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_removed uuid[];
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'Only an active administrator may unlink jobs from a bill.'
            USING ERRCODE = '42501';
    END IF;

    IF p_bill_id IS NULL THEN
        RAISE EXCEPTION 'A bill is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_job_ids IS NULL OR coalesce(array_length(p_job_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'At least one job is required.'
            USING ERRCODE = '22023';
    END IF;

    WITH del AS (
        DELETE FROM public.bill_job_connections c
         WHERE c.bill_id = p_bill_id
           AND c.job_id = ANY (p_job_ids)
        RETURNING c.job_id
    )
    SELECT coalesce(array_agg(job_id), '{}'::uuid[])
      INTO v_removed
      FROM del;

    RETURN QUERY
        SELECT DISTINCT u.id, u.id = ANY (v_removed)
          FROM unnest(p_job_ids) AS u(id);
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_bill_jobs(uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.unlink_bill_jobs(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.unlink_bill_jobs(uuid, uuid[]) IS
    'Remove the given job links from one bill. Deletes only the relationship rows. Admin-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Unlink across both sides — the cross product
-- ─────────────────────────────────────────────────────────────────────────────
-- Needed because unlinking is not only ever "these jobs from that one bill": the
-- bills page removes one job from several selected bills at once, and the job side
-- removes a specific bill from a specific job. Removing the cross product of the
-- two id lists expresses all three cases, and is still one statement.
--
-- Rows outside the supplied lists are untouched: unlinking job 1546 from bill A
-- never disturbs job 1546's link to bill B.
CREATE OR REPLACE FUNCTION public.unlink_job_bill_links(p_job_ids uuid[], p_bill_ids uuid[])
RETURNS TABLE (
    job_id  uuid,
    bill_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'Only an active administrator may unlink jobs from bills.'
            USING ERRCODE = '42501';
    END IF;

    IF p_job_ids IS NULL OR coalesce(array_length(p_job_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'At least one job is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_bill_ids IS NULL OR coalesce(array_length(p_bill_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'At least one bill is required.'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
        DELETE FROM public.bill_job_connections c
         WHERE c.job_id = ANY (p_job_ids)
           AND c.bill_id = ANY (p_bill_ids)
        RETURNING c.job_id, c.bill_id;
END;
$$;

REVOKE ALL ON FUNCTION public.unlink_job_bill_links(uuid[], uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.unlink_job_bill_links(uuid[], uuid[]) TO authenticated;

COMMENT ON FUNCTION public.unlink_job_bill_links(uuid[], uuid[]) IS
    'Delete the links formed by the cross product of the two id lists. Admin-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Read the jobs linked to one bill
-- ─────────────────────────────────────────────────────────────────────────────
-- The job's own columns are joined in here rather than copied onto the link, so
-- the bill's "linked jobs" panel always shows the current job_no and status. The
-- link's own created_at/created_by come along because "who linked this, and when"
-- is a fact about the link and exists nowhere else.
CREATE OR REPLACE FUNCTION public.get_bill_job_connections(p_bill_id uuid)
RETURNS TABLE (
    job_id            uuid,
    job_no            text,
    job_type          text,
    job_given_date    date,
    tool_description  text,
    tool_part         text,
    quantity          text,
    status            text,
    linked_at         timestamptz,
    linked_by         uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'Only an active administrator may view a bill''s linked jobs.'
            USING ERRCODE = '42501';
    END IF;

    IF p_bill_id IS NULL THEN
        RAISE EXCEPTION 'A bill is required.'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
        SELECT j.id, j.job_no, j.job_type, j.job_given_date,
               j.tool_description, j.tool_part, j.quantity, j.status,
               c.created_at, c.created_by
          FROM public.bill_job_connections c
          JOIN public.jobs j ON j.id = c.job_id
         WHERE c.bill_id = p_bill_id
         ORDER BY j.job_type, j.job_no NULLS LAST, j.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.get_bill_job_connections(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_bill_job_connections(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_bill_job_connections(uuid) IS
    'The jobs linked to one bill, with their current job_no/type/status and the link''s own created_at/created_by. Admin-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) Read the bills linked to some jobs
-- ─────────────────────────────────────────────────────────────────────────────
-- The mirror of the above, and the one the job table's CONNECTIONS column and its
-- connection wires are driven from.
--
-- `invoice_no` is nullable and `sheet_name` is not, so the label precedence matches
-- the rest of the app: an invoice number when there is one, otherwise the sheet the
-- bill came from. The precedence is computed HERE as well as returned raw, because
-- the SVG wire layer and the popover must not each invent their own idea of what a
-- bill is called.
CREATE OR REPLACE FUNCTION public.get_job_bill_connections(p_job_ids uuid[])
RETURNS TABLE (
    job_id      uuid,
    bill_id     uuid,
    invoice_no  text,
    party_name  text,
    sheet_name  text,
    job_kind    text,
    label       text,
    linked_at   timestamptz,
    linked_by   uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'Only an active administrator may view a job''s linked bills.'
            USING ERRCODE = '42501';
    END IF;

    IF p_job_ids IS NULL OR coalesce(array_length(p_job_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'At least one job is required.'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
        SELECT c.job_id, b.id, b.invoice_no, b.party_name, b.sheet_name, b.job_kind,
               coalesce(nullif(btrim(b.invoice_no), ''), nullif(btrim(b.sheet_name), ''), 'this bill'),
               c.created_at, c.created_by
          FROM public.bill_job_connections c
          JOIN public.bills b ON b.id = c.bill_id
         WHERE c.job_id = ANY (p_job_ids)
         ORDER BY c.job_id, b.invoice_date DESC NULLS LAST, b.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_job_bill_connections(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_job_bill_connections(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_job_bill_connections(uuid[]) IS
    'The bills linked to the given jobs, with a ready-to-print label. Admin-only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) Counts, one row per requested id
-- ─────────────────────────────────────────────────────────────────────────────
-- Both count functions return a row for EVERY id passed in, including ids with no
-- links at all. That is the point: the job table renders a CONNECTIONS cell per
-- visible row and needs "0" to be a value it received rather than an absence it has
-- to guess at, so `?? 0` never silently papers over a failed lookup.
--
-- `unnest` drives the FROM so the LEFT JOIN, not the link table, decides how many
-- rows come back. Written as `count(c.<fk>)` rather than `count(*)`, because
-- count(*) would report 1 for an unlinked job.
CREATE OR REPLACE FUNCTION public.get_job_connection_counts(p_job_ids uuid[])
RETURNS TABLE (
    job_id           uuid,
    connection_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT j.id, count(c.bill_id)
      FROM unnest(p_job_ids) AS j(id)
      LEFT JOIN public.bill_job_connections c ON c.job_id = j.id
     WHERE EXISTS (
               SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
           )
     GROUP BY j.id;
$$;

REVOKE ALL ON FUNCTION public.get_job_connection_counts(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_job_connection_counts(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_job_connection_counts(uuid[]) IS
    'One row per requested job id with how many bills it is linked to, zero included. Admin-only; returns nothing to anyone else.';

-- The bill-side equivalent, split by job type because the bill UI presents labour
-- and with-material jobs as separate lists rather than one mixed column.
CREATE OR REPLACE FUNCTION public.get_bill_connection_counts(p_bill_ids uuid[])
RETURNS TABLE (
    bill_id            uuid,
    connection_count   bigint,
    labour_count       bigint,
    with_material_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.id,
           count(c.job_id),
           count(c.job_id) FILTER (WHERE j.job_type = 'labour'),
           count(c.job_id) FILTER (WHERE j.job_type = 'with_material')
      FROM unnest(p_bill_ids) AS b(id)
      LEFT JOIN public.bill_job_connections c ON c.bill_id = b.id
      LEFT JOIN public.jobs j ON j.id = c.job_id
     WHERE EXISTS (
               SELECT 1 FROM public.profiles p
               WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
           )
     GROUP BY b.id;
$$;

REVOKE ALL ON FUNCTION public.get_bill_connection_counts(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_bill_connection_counts(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_bill_connection_counts(uuid[]) IS
    'One row per requested bill id with total, labour and with-material link counts, zero included. Admin-only; returns nothing to anyone else.';

COMMIT;