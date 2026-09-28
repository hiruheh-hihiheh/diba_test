-- Migration: transactional "set primary drawing" for job drawings.
--
-- The client previously implemented set-primary as two separate UPDATEs (set
-- target, then clear others). A crash between them could leave a job with 0
-- or 2 primary drawings. This RPC runs both writes inside one transaction and
-- validates that the target drawing belongs to the job, so it is impossible
-- to leave an inconsistent state.
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
BEGIN
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
REVOKE ALL ON FUNCTION public.set_primary_drawing(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.set_primary_drawing(uuid, uuid) TO authenticated;