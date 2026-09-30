-- Migration: transactional "set primary drawing" for job drawings.
--
-- The client previously implemented set-primary as two separate UPDATEs (set
-- target, then clear others). A crash between them could leave a job with 0
-- or 2 primary drawings. This RPC runs both writes inside one transaction and
-- validates that the target drawing belongs to the job, so it is impossible
-- to leave an inconsistent state.
--
-- SECURITY: the function is SECURITY DEFINER so the anon-key client can
-- perform the writes on job_drawings the way it does for the direct table
-- path today. That elevated privilege is NOT granted to callers for free:
-- the function first verifies that the caller is an authenticated, ACTIVE
-- admin (role = 'admin' AND is_active = true in profiles). Workers and
-- processors get `admin_required` and nothing changes. Frontend guards are
-- belt-and-braces only; the real authorization lives here in the database.
--
-- The client calls this RPC first and falls back to the old two-step code
-- only when it is not yet deployed (see src/services/jobDrawings.ts).
--
-- Apply with:  psql "$DATABASE_URL" -f 0002_set_primary_drawing.sql
-- (or via the Supabase dashboard SQL editor)

CREATE OR REPLACE FUNCTION public.set_primary_drawing(
    p_job_id uuid,
    p_drawing_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    drawing_exists boolean;
    is_admin boolean;
BEGIN
    -- Authorization: only an authenticated, active admin may change job
    -- drawings. auth.uid() reads the caller's JWT sub claim, which is still
    -- populated inside SECURITY DEFINER functions.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
          AND is_active = true
    ) INTO is_admin;

    IF NOT is_admin THEN
        RAISE EXCEPTION 'admin_required';
    END IF;

    -- The target drawing must belong to the job. (A drawing id from another
    -- job must never be marked primary here.)
    SELECT EXISTS (
        SELECT 1 FROM job_drawings WHERE id = p_drawing_id AND job_id = p_job_id
    ) INTO drawing_exists;

    IF NOT drawing_exists THEN
        RAISE EXCEPTION 'drawing_not_in_job';
    END IF;

    -- Clear the current primary (if any) for this job...
    UPDATE job_drawings SET is_primary = false WHERE job_id = p_job_id;

    -- ...and set the requested one. If the row vanished mid-transaction the
    -- UPDATE touches 0 rows, which rolls the whole transaction back so we
    -- never leave the job with no primary either.
    UPDATE job_drawings SET is_primary = true WHERE id = p_drawing_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'drawing_missing';
    END IF;
END;
$$;

-- Only authenticated users may call it; the function itself uses SECURITY
-- DEFINER so it can write rows the anon-key client would not be able to touch.
-- The admin check above runs *before* any write, so non-admins can call this
-- function but nothing is changed for them.
REVOKE ALL ON FUNCTION public.set_primary_drawing(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.set_primary_drawing(uuid, uuid) TO authenticated;