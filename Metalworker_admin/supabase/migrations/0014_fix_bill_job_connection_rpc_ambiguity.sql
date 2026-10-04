-- Migration: fix an ambiguous column reference in the Bill ↔ Job link RPCs.
--
-- WHAT WAS WRONG
-- `link_bill_jobs` and `unlink_bill_jobs` are declared `RETURNS TABLE (job_id uuid,
-- …)`. In PL/pgSQL those result columns become OUT PARAMETERS, which are ordinary
-- variables in the function body. So a bare `job_id` in a SQL statement inside the
-- function can mean either the OUT parameter or a real column of a table in that
-- statement, and PostgreSQL refuses to guess:
--
--     ERROR: column reference "job_id" is ambiguous
--
-- Both functions hit it on the line that aggregates the CTE:
--
--     WITH ins AS ( INSERT … RETURNING job_id )
--     SELECT coalesce(array_agg(job_id), '{}'::uuid[]) INTO v_inserted FROM ins;
--
-- `array_agg(job_id)` named no table, and `job_id` matched both the OUT parameter and
-- `ins.job_id`. `link_bill_jobs` failed for every caller, so linking a job to a bill
-- was impossible from the UI.
--
-- WHY A NEW MIGRATION
-- 0013 is applied. Editing it would make the repository disagree with the database,
-- and `supabase db push` would never replay the corrected body. This migration
-- replaces the two affected functions in place.
--
-- THE AUDIT — WHICH FUNCTIONS WERE AFFECTED, AND WHICH WERE NOT
-- A function is at risk only if it is PL/pgSQL, declares `RETURNS TABLE`, and then
-- mentions one of those column names UNQUALIFIED in a SQL statement. All seven
-- functions in 0013 were checked against exactly that test:
--
--   link_bill_jobs          RETURNS TABLE(job_id, linked)      AFFECTED — fixed below
--   unlink_bill_jobs        RETURNS TABLE(job_id, unlinked)    AFFECTED — fixed below
--   unlink_job_bill_links   RETURNS TABLE(job_id, bill_id)     clean — every reference
--                                                                  is `c.job_id` /
--                                                                  `c.bill_id`
--   get_bill_job_connections   RETURNS TABLE(10 columns)        clean — every column is
--                                                                  `j.…` or `c.…`
--   get_job_bill_connections   RETURNS TABLE(9 columns)         clean — every column is
--                                                                  `c.…` or `b.…`
--   get_job_connection_counts   RETURNS TABLE(job_id, …)        clean — LANGUAGE sql,
--   get_bill_connection_counts  RETURNS TABLE(bill_id, …)       which does no
--                                                                  identifier
--                                                                  substitution at all
--
-- The two count functions were additionally observed WORKING against the live database
-- before this fix, which is the direct evidence that `LANGUAGE sql` is not affected:
-- both returned rows over PostgREST.
--
-- HOW THE AMBIGUITY IS REMOVED RATHER THAN MERELY AVOIDED
-- Nothing here is renamed and no behaviour changes. Every reference is qualified:
--
--   ON CONFLICT (bill_id, job_id)              ->  ON CONFLICT ON CONSTRAINT
--                                                  bill_job_connections_pair_key
--   RETURNING job_id                           ->  RETURNING bill_job_connections.job_id
--   array_agg(job_id)                          ->  array_agg(ins.job_id)  /  array_agg(del.job_id)
--
-- The conflict target is switched to the CONSTRAINT rather than to
-- `ON CONFLICT (bill_id, job_id)` because that clause is also parsed as column
-- references, and `job_id` there is just as ambiguous as it was in the aggregate.
-- Naming the constraint is unambiguous by construction, names the same unique index,
-- and is the better way to write it regardless.
--
-- THE INSERT COLUMN LIST
-- `INSERT INTO … (bill_id, job_id, created_by)` cannot be qualified — PostgreSQL does
-- not accept a table-qualified name in an insert target list. It is left as it is
-- because `job_id` is a column reference in the target list, not a reference to a
-- table in a FROM clause, and the deployed behaviour of the migration below is the
-- proof: the self-check at the end of this file CALLS both functions for real.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) link_bill_jobs — the function that made linking impossible
-- ─────────────────────────────────────────────────────────────────────────────
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
    -- SECURITY DEFINER bypasses the RLS on `bill_job_connections`, so the gate that RLS
    -- would have applied has to be applied here instead. Checked first, before the bill
    -- or any job is looked at, so an unauthorised caller learns nothing about either.
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
    --
    -- Every name below is qualified for the reason in the header. `ins.job_id` is the
    -- CTE's column; `bill_job_connections.job_id` is the inserted row's.
    WITH ins AS (
        INSERT INTO public.bill_job_connections (bill_id, job_id, created_by)
        SELECT p_bill_id, u.id, auth.uid()
          FROM unnest(p_job_ids) AS u(id)
        ON CONFLICT ON CONSTRAINT bill_job_connections_pair_key DO NOTHING
        RETURNING bill_job_connections.job_id
    )
    SELECT coalesce(array_agg(ins.job_id), '{}'::uuid[])
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
-- 2) unlink_bill_jobs — same latent defect, reached on the unlink path
-- ─────────────────────────────────────────────────────────────────────────────
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
    SELECT coalesce(array_agg(del.job_id), '{}'::uuid[])
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
-- 3) SELF-CHECK — call both functions for real, then put everything back
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS HERE AND NOT ONLY IN A TEST FILE
-- A PL/pgSQL body is only NAME-RESOLVED when a statement is first prepared, which
-- happens at run time and only after the function's earlier statements have passed.
-- So `CREATE OR REPLACE FUNCTION` with an ambiguous reference SUCCEEDS, the migration
-- applies cleanly, `supabase migration list` reports the migration present, and the
-- error appears only when a user clicks. Nothing short of calling it can tell you the
-- fix landed, which is how this shipped broken in the first place.
--
-- So this block calls the real functions.
--
--   * It impersonates an ACTIVE ADMIN by setting the same session GUC PostgREST sets,
--     `request.jwt.claim.sub`. `auth.uid()` reads that, so the functions' own
--     authorization check passes — the code path under test is the real one, not a
--     bypass. Nothing outside this transaction is affected by the setting.
--   * It creates its own scratch bill and jobs, links and unlinks them, asserts the
--     outcomes, and then ROLLS BACK TO SAVEPOINT. No row survives: the production
--     data this runs against is not read for anything but row counts it creates
--     itself, and none of it is modified.
--   * If there is no active admin, it reports that and SKIPS. A fresh project with no
--     admin yet must still be able to apply this migration.
--   * If any assertion fails, the exception aborts the whole migration, so a broken
--     body can never be recorded as applied.
--
-- Transaction control (SAVEPOINT / ROLLBACK TO) has to sit OUTSIDE the DO block:
-- PostgreSQL forbids it inside a function or DO block.

SAVEPOINT bill_job_connections_selfcheck;

DO $selfcheck$
DECLARE
    v_admin       uuid;
    v_upload      uuid;
    v_bill        uuid;
    v_bill_two    uuid;
    v_labour      uuid[];
    v_material    uuid[];
    v_linked      integer;
    v_created     integer;
    v_total       bigint;
    v_one         uuid;
    i             integer;
BEGIN
    SELECT p.id INTO v_admin
      FROM public.profiles p
     WHERE p.role = 'admin' AND p.is_active = true
     LIMIT 1;

    IF v_admin IS NULL THEN
        RAISE NOTICE 'SKIPPED: no active admin exists yet, so the RPC self-check could not authenticate. Re-run verify-connection-rls.ts once one does.';
        RETURN;
    END IF;

    -- Become that admin for the rest of the transaction.
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    INSERT INTO public.bill_uploads (original_filename, base_name)
    VALUES ('selfcheck.xlsx', 'selfcheck')
    RETURNING id INTO v_upload;

    INSERT INTO public.bills (bill_upload_id, sheet_name, invoice_no, party_name)
    VALUES (v_upload, 'SELFCHECK-A', 'SELFCHECK-A', 'SELFCHECK')
    RETURNING id INTO v_bill;

    INSERT INTO public.bills (bill_upload_id, sheet_name, invoice_no, party_name)
    VALUES (v_upload, 'SELFCHECK-B', 'SELFCHECK-B', 'SELFCHECK')
    RETURNING id INTO v_bill_two;

    /* Inserted one at a time and collected with array_append. A single
       `INSERT … SELECT … RETURNING id` fills only the FIRST slot, because INTO takes
       one value, which would silently test two-job batches instead of three.
       `INTO v_labour[i]` is not an option either: PL/pgSQL rejects it with
       "cannot subscript type uuid". */
    v_labour := ARRAY[]::uuid[];
    FOR i IN 1..3 LOOP
        INSERT INTO public.jobs (job_type, job_no, status)
        VALUES ('labour', 'SELFCHECK-L' || i, 'Pending')
        RETURNING id INTO v_one;
        v_labour := array_append(v_labour, v_one);
    END LOOP;

    v_material := ARRAY[]::uuid[];
    FOR i IN 1..3 LOOP
        INSERT INTO public.jobs (job_type, job_no, status)
        VALUES ('with_material', 'SELFCHECK-M' || i, 'Pending')
        RETURNING id INTO v_one;
        v_material := array_append(v_material, v_one);
    END LOOP;

    -- (1) three labour jobs -> one bill
    SELECT count(*) INTO v_linked FROM public.link_bill_jobs(v_bill, v_labour) r WHERE r.linked;
    IF v_linked <> 3 THEN
        RAISE EXCEPTION 'link_bill_jobs: expected 3 labour links created, got %', v_linked;
    END IF;

    SELECT count(*) INTO v_total FROM public.get_bill_job_connections(v_bill);
    IF v_total <> 3 THEN
        RAISE EXCEPTION 'get_bill_job_connections: expected 3, got %', v_total;
    END IF;

    -- (2) three with-material jobs -> the SAME bill
    SELECT count(*) INTO v_linked
      FROM public.link_bill_jobs(v_bill, v_material) r WHERE r.linked;
    IF v_linked <> 3 THEN
        RAISE EXCEPTION 'link_bill_jobs: expected 3 with-material links created, got %', v_linked;
    END IF;

    -- (3) both types now sit on one bill, counted separately
    SELECT count(*) FILTER (WHERE c.job_type = 'labour'),
           count(*) FILTER (WHERE c.job_type = 'with_material')
      INTO v_created, v_linked
      FROM public.get_bill_job_connections(v_bill) c;
    IF v_created <> 3 OR v_linked <> 3 THEN
        RAISE EXCEPTION 'mixed link: expected 3 labour + 3 with-material, got % + %', v_created, v_linked;
    END IF;

    -- (4) repeating the identical link creates nothing and reports every pair as present
    SELECT count(*) INTO v_created
      FROM public.link_bill_jobs(v_bill, v_labour || v_material) r WHERE r.linked;
    IF v_created <> 0 THEN
        RAISE EXCEPTION 'idempotency broken: a repeat link reported % as newly created', v_created;
    END IF;
    SELECT count(*) INTO v_total FROM public.get_bill_job_connections(v_bill);
    IF v_total <> 6 THEN
        RAISE EXCEPTION 'idempotency broken: bill has % links after a repeat, expected 6', v_total;
    END IF;

    -- (5) one job -> two bills
    PERFORM public.link_bill_jobs(v_bill_two, ARRAY[v_labour[1]]);
    SELECT count(*) INTO v_total
      FROM public.get_job_bill_connections(ARRAY[v_labour[1]]);
    IF v_total <> 2 THEN
        RAISE EXCEPTION 'one job to two bills: expected 2, got %', v_total;
    END IF;

    -- (6) unlink one job from one bill
    SELECT count(*) INTO v_linked
      FROM public.unlink_bill_jobs(v_bill_two, ARRAY[v_labour[1]]) r WHERE r.unlinked;
    IF v_linked <> 1 THEN
        RAISE EXCEPTION 'unlink_bill_jobs: expected 1 removed, got %', v_linked;
    END IF;

    -- (7) the other bill's link is untouched
    SELECT count(*) INTO v_total
      FROM public.get_bill_job_connections(v_bill) c WHERE c.job_id = v_labour[1];
    IF v_total <> 1 THEN
        RAISE EXCEPTION 'unlink removed the wrong row: the original bill kept % of 1 link', v_total;
    END IF;
    SELECT count(*) INTO v_total
      FROM public.get_job_bill_connections(ARRAY[v_labour[1]]);
    IF v_total <> 1 THEN
        RAISE EXCEPTION 'unlink left the job with % bills, expected 1', v_total;
    END IF;

    -- (8) unlinking the whole batch empties the bill, and no bill or job is deleted
    SELECT count(*) INTO v_linked
      FROM public.unlink_bill_jobs(v_bill, v_labour || v_material) r WHERE r.unlinked;
    IF v_linked <> 6 THEN
        RAISE EXCEPTION 'bulk unlink: expected 6 removed, got %', v_linked;
    END IF;
    SELECT count(*) INTO v_total FROM public.bills WHERE id = v_bill;
    IF v_total <> 1 THEN
        RAISE EXCEPTION 'unlink deleted the bill';
    END IF;
    SELECT count(*) INTO v_total FROM public.jobs WHERE id = ANY (v_labour || v_material);
    IF v_total <> 6 THEN
        RAISE EXCEPTION 'unlink deleted jobs: % of 6 remain', v_total;
    END IF;

    -- (9) cascade: deleting a job takes its link with it and leaves the bill alone
    PERFORM public.link_bill_jobs(v_bill, ARRAY[v_labour[1], v_labour[2]]);
    DELETE FROM public.jobs WHERE id = v_labour[1];
    SELECT count(*) INTO v_total FROM public.bill_job_connections WHERE job_id = v_labour[1];
    IF v_total <> 0 THEN
        RAISE EXCEPTION 'cascade broken: % link(s) survived the job being deleted', v_total;
    END IF;
    SELECT count(*) INTO v_total FROM public.get_bill_job_connections(v_bill) c WHERE c.job_id = v_labour[2];
    IF v_total <> 1 THEN
        RAISE EXCEPTION 'cascade removed too much: the sibling job''s link went too';
    END IF;
    SELECT count(*) INTO v_total FROM public.bills WHERE id = v_bill;
    IF v_total <> 1 THEN
        RAISE EXCEPTION 'cascade deleted the bill';
    END IF;

    -- (10) the admin gate still refuses a caller with no admin identity
    PERFORM set_config('request.jwt.claim.sub', '', true);
    BEGIN
        PERFORM public.link_bill_jobs(v_bill, ARRAY[v_labour[3]]);
        RAISE EXCEPTION 'link_bill_jobs did not refuse an unauthenticated caller';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL; -- expected
    END;

    -- (11) and an empty id list is still refused rather than silently succeeding
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    BEGIN
        PERFORM public.link_bill_jobs(v_bill, ARRAY[]::uuid[]);
        RAISE EXCEPTION 'link_bill_jobs accepted an empty job list';
    EXCEPTION
        WHEN data_exception THEN
            NULL; -- expected: ERRCODE 22023
    END;

    RAISE NOTICE 'SELF-CHECK PASSED: both functions were called for real as an active admin; 11 assertions held.';
END;
$selfcheck$;

-- Nothing above this line survives. The scratch bill, its upload, the six jobs and
-- every link created during the check are all discarded here.
ROLLBACK TO SAVEPOINT bill_job_connections_selfcheck;

COMMIT;