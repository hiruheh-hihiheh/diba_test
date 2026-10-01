-- Migration: Billing folders — a folder workspace for Bills, and a richer
-- per-folder analysis.
--
-- THE PROBLEM THIS SOLVES
-- `folder_items.item_type` already understands 'bill' (migration 0005), so bills
-- could already be dropped into any `admin_folders` row. But `admin_folders` has
-- no way to say WHICH folders are bill folders: one table serves Labour folders,
-- With Metal folders, general job folders AND bills. So a billing folder was
-- indistinguishable from a job folder, a job folder could silently collect bills,
-- and the Bills screen could not offer a "folders" area of its own.
--
-- WHAT IS REUSED
--   * the `admin_folders` table itself (no new folder engine)
--   * the `folder_items` link table and its (folder_id, item_type, item_id)
--     uniqueness index (migration 0001)
--   * `item_type = 'bill'`, already supported by both clients
--   * the existing job-type / folder_type guard in the desktop `addJobToFolder`
--
-- WHAT IS ADDED
--   1. `folder_type = 'billing'` as a first-class folder kind.
--   2. A trigger that makes "a billing folder holds bills only" a DATABASE
--      invariant rather than a UI convention.
--   3. `get_folder_bill_summary` extended with the comparison figures the Billing
--      screen needs: min/max bill value, the remaining averages, and a job-kind
--      breakdown.
--   4. `get_billing_folder_bill_counts()` for the folder list, so the count of
--      every billing folder arrives in ONE round trip.
--
-- NOTHING ABOUT BILLS CHANGES
-- No column on `bills` or `bill_uploads` is touched, no PDF is regenerated and no
-- edge function changes. 1 physical invoice is still 1 bill record with 3 print
-- copies, and every total below is over unique `bills` rows.
--
-- Apply with:  psql "$DATABASE_URL" -f 0009_billing_folders.sql
-- (or via `supabase db push`, or the Supabase dashboard SQL editor)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) folder_type must be able to hold 'billing'
-- ─────────────────────────────────────────────────────────────────────────────
-- The base schema predates the Billing section, so it may carry a CHECK that
-- enumerates ('labour','with_material','general'). Adding a value a CHECK does
-- not list fails at INSERT, so any such CHECK is dropped and replaced with one
-- that also permits 'billing' and NULL (NULL = an untyped/general folder, which
-- is what every pre-existing folder has and must keep working).
DO $$
DECLARE
    con_name text;
BEGIN
    FOR con_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_attribute att
          ON att.attrelid = rel.oid
         AND att.attnum = ANY (con.conkey)
        WHERE rel.relname = 'admin_folders'
          AND con.contype = 'c'
          AND att.attname = 'folder_type'
    LOOP
        EXECUTE format('ALTER TABLE public.admin_folders DROP CONSTRAINT %I', con_name);
    END LOOP;
END $$;

-- Idempotent: re-running the migration must not fail on an existing constraint.
ALTER TABLE public.admin_folders DROP CONSTRAINT IF EXISTS admin_folders_folder_type_check;
ALTER TABLE public.admin_folders
    ADD CONSTRAINT admin_folders_folder_type_check
    CHECK (folder_type IS NULL
           OR folder_type IN ('labour', 'with_material', 'general', 'billing'));

-- A partial index so the Billing screen's folder query stays a cheap index scan
-- instead of filtering every folder row. Partial (not a plain index on the
-- column) because the vast majority of folders are job folders and are never
-- read through this path.
CREATE INDEX IF NOT EXISTS admin_folders_billing_kind_idx
    ON public.admin_folders (created_at DESC)
    WHERE folder_type = 'billing';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) A billing folder may contain BILLS ONLY
-- ─────────────────────────────────────────────────────────────────────────────
-- The clients already refuse to put a labour job in a With Metal folder
-- (Metalworker_desktop/src/services/jobs.ts addJobToFolder). This extends the
-- same rule in the only direction that was unprotected: a BILL could go into any
-- folder, and a job could go into a billing folder.
--
-- Why a trigger rather than only client checks: `folder_items` is written from
-- three apps. A check that only exists in the Billing UI would be a convention,
-- and a folder that mixes a job with bills is exactly the kind of thing that
-- makes a financial summary quietly wrong later.
--
-- Deliberately scoped so it CANNOT affect any existing behaviour:
--   * it fires only when the target folder's folder_type is exactly 'billing';
--     for every other folder the function returns immediately and NULL.
--   * it fires on INSERT and UPDATE only. `deleteFolder` and
--     `emptyBillingFolder` DELETE `folder_items` rows freely, which is how a
--     billing folder is emptied or removed — a DELETE guard would deadlock them.
--   * item_type is a free-form discriminator (see 0005), so the rule is
--     "billing folder => item_type must be 'bill'", not an enumeration of every
--     type that is not a bill.
CREATE OR REPLACE FUNCTION public.enforce_billing_folder_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    kind text;
BEGIN
    SELECT f.folder_type INTO kind
    FROM public.admin_folders f
    WHERE f.id = NEW.folder_id;

    IF kind = 'billing' AND NEW.item_type IS DISTINCT FROM 'bill' THEN
        RAISE EXCEPTION
            'A billing folder can only contain bills; got item_type=%. '
            'Create the folder inside the Billing section, or use a job folder '
            'for % items.', NEW.item_type, NEW.item_type
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_folder_items_only_bills ON public.folder_items;
CREATE TRIGGER billing_folder_items_only_bills
    BEFORE INSERT OR UPDATE ON public.folder_items
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_billing_folder_items();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Extended get_folder_bill_summary
-- ─────────────────────────────────────────────────────────────────────────────
-- EXTENDED IN PLACE, NOT REPLACED BY A PARALLEL FUNCTION.
-- `CREATE OR REPLACE` cannot change a function's return type, so the extended
-- body is installed by dropping and recreating under the SAME name and signature.
-- That keeps exactly one aggregation function in the database, so the two
-- clients and the existing FolderBillSummaryPanel cannot drift apart. Postgres
-- DDL is transactional, so a failure here leaves the 0006 version in place
-- rather than no function at all.
--
-- Every column that 0006 returned is returned unchanged, with the same names.
-- Both clients map those by name, so adding columns is backward compatible; only
-- the RETURNS TABLE list differs.
--
-- THE ONE INVARIANT
-- `WITH unique_bills AS (SELECT DISTINCT b.id, …)` — the three print copies of
-- an invoice are three PDFs on ONE `bills` row, so counting per bill row can
-- never triple a total. The 0001 uniqueness index already forbids a repeated
-- (folder, type, item) row; the DISTINCT is kept anyway so COUNT and every SUM
-- are derived from the SAME set of rows. Without it, a duplicated link would
-- inflate the money while the bill count stayed correct — the one shape of bug a
-- financial summary must not have.
--
-- Safe division: every average divides by NULLIF(count, 0), so an empty folder
-- yields 0 rather than NaN or Infinity.
--
-- The job-kind breakdown is a jsonb array built from the SAME de-duplicated set,
-- so it cannot disagree with total_bills: the breakdown's counts always add up to
-- total_bills, including the null bucket, which is reported as "Unclassified"
-- rather than dropped. No category is invented — the keys are the raw
-- `bills.job_kind` values exactly as stored.
DROP FUNCTION IF EXISTS public.get_folder_bill_summary(uuid);

CREATE FUNCTION public.get_folder_bill_summary(p_folder_id uuid)
RETURNS TABLE (
    -- ── counts and totals (unchanged names from 0006) ──
    total_bills            bigint,
    total_quantity         numeric,
    amount_before_tax      numeric,
    cgst                   numeric,
    sgst                   numeric,
    igst                   numeric,
    total_gst              numeric,
    amount_after_tax       numeric,
    round_off              numeric,
    avg_bill_value         numeric,
    avg_quantity           numeric,
    avg_amount_before_tax  numeric,
    -- ── added: the remaining averages ──
    avg_cgst               numeric,
    avg_sgst               numeric,
    avg_igst               numeric,
    avg_total_gst          numeric,
    avg_round_off          numeric,
    -- ── added: min / max, for "cheapest and dearest bill in this folder" ──
    min_amount_after_tax   numeric,
    max_amount_after_tax   numeric,
    min_amount_before_tax  numeric,
    max_amount_before_tax  numeric,
    -- ── added: bills that carry no usable after-tax figure ──
    bills_without_total    bigint,
    -- ── added: job-kind breakdown over the same de-duplicated bills ──
    job_kind_breakdown     jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_admin boolean;
    n_bills  bigint;
    v_qty    numeric := 0;
    v_abt    numeric := 0;
    v_cgst   numeric := 0;
    v_sgst   numeric := 0;
    v_igst   numeric := 0;
    v_gst    numeric := 0;
    v_aat    numeric := 0;
    v_round  numeric := 0;
    v_min_aat numeric;
    v_max_aat numeric;
    v_min_abt numeric;
    v_max_abt numeric;
    v_no_total bigint := 0;
    v_breakdown jsonb;
BEGIN
    -- Authorization FIRST, before any data is read: only an authenticated,
    -- active admin may read folder financial totals.
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

    IF p_folder_id IS NULL THEN
        RAISE EXCEPTION 'folder_id_required';
    END IF;

    -- One pass over a DE-DUPLICATED set of bills.
    WITH unique_bills AS (
        SELECT DISTINCT
            b.id,
            b.total_quantity,
            b.amount_before_tax,
            b.cgst,
            b.sgst,
            b.igst,
            b.total_gst,
            b.amount_after_tax,
            b.round_off
        FROM public.folder_items fi
        JOIN public.bills b ON b.id = fi.item_id
        WHERE fi.folder_id = p_folder_id
          AND fi.item_type = 'bill'
    )
    SELECT
        count(*),
        coalesce(sum(coalesce(u.total_quantity, 0)), 0),
        coalesce(sum(coalesce(u.amount_before_tax, 0)), 0),
        coalesce(sum(coalesce(u.cgst, 0)), 0),
        coalesce(sum(coalesce(u.sgst, 0)), 0),
        coalesce(sum(coalesce(u.igst, 0)), 0),
        coalesce(sum(coalesce(u.total_gst, 0)), 0),
        coalesce(sum(coalesce(u.amount_after_tax, 0)), 0),
        coalesce(sum(coalesce(u.round_off, 0)), 0),
        -- MIN/MAX ignore nulls, which is the point: a bill whose total was never
        -- imported must not drag the cheapest-bill figure to zero.
        min(u.amount_after_tax),
        max(u.amount_after_tax),
        min(u.amount_before_tax),
        max(u.amount_before_tax),
        -- Reported rather than silently folded in, so a folder whose totals are
        -- all null reads as "3 bills, no totals" instead of "0".
        count(*) FILTER (WHERE u.amount_after_tax IS NULL)
    INTO n_bills, v_qty, v_abt, v_cgst, v_sgst, v_igst, v_gst, v_aat, v_round,
         v_min_aat, v_max_aat, v_min_abt, v_max_abt, v_no_total
    FROM unique_bills u;

    total_bills           := n_bills;
    total_quantity        := v_qty;
    amount_before_tax     := v_abt;
    cgst                  := v_cgst;
    sgst                  := v_sgst;
    igst                  := v_igst;
    total_gst             := v_gst;
    amount_after_tax      := v_aat;
    round_off             := v_round;
    min_amount_after_tax  := coalesce(v_min_aat, 0);
    max_amount_after_tax  := coalesce(v_max_aat, 0);
    min_amount_before_tax := coalesce(v_min_abt, 0);
    max_amount_before_tax := coalesce(v_max_abt, 0);
    bills_without_total   := v_no_total;

    -- Safe division: NULLIF(n,0) makes an empty folder produce 0, not NaN.
    avg_bill_value        := coalesce(round(v_aat / NULLIF(n_bills, 0), 2), 0);
    avg_quantity          := coalesce(round(v_qty / NULLIF(n_bills, 0), 3), 0);
    avg_amount_before_tax := coalesce(round(v_abt / NULLIF(n_bills, 0), 2), 0);
    avg_cgst              := coalesce(round(v_cgst / NULLIF(n_bills, 0), 2), 0);
    avg_sgst              := coalesce(round(v_sgst / NULLIF(n_bills, 0), 2), 0);
    avg_igst              := coalesce(round(v_igst / NULLIF(n_bills, 0), 2), 0);
    avg_total_gst         := coalesce(round(v_gst  / NULLIF(n_bills, 0), 2), 0);
    avg_round_off         := coalesce(round(v_round/ NULLIF(n_bills, 0), 2), 0);

    -- Breakdown by the RAW stored job_kind, built from the SAME de-duplicated set,
    -- so its counts always sum to total_bills.
    --
    -- The inner SELECT de-duplicates to one row per (bill, job_kind); the middle
    -- one counts them per kind; the outer jsonb_agg then collapses those per-kind
    -- rows into ONE array. The nesting matters: aggregating directly over the
    -- per-bill rows would emit one array element per BILL rather than per kind,
    -- and dropping the inner GROUP BY would make the aggregate itself grouped,
    -- returning one row per kind of which only the first would survive INTO.
    --
    -- jsonb_agg over an empty set is NULL, so an empty folder yields NULL here and
    -- the coalesce below turns that into '[]' — the client never has to normalise.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'job_kind', g.raw_kind,
                 'count',    g.bill_count
             ) ORDER BY g.bill_count DESC, g.raw_kind NULLS LAST), '[]'::jsonb)
    INTO v_breakdown
    FROM (
        SELECT u.raw_kind, count(*) AS bill_count
        FROM (
            SELECT DISTINCT b.id, b.job_kind AS raw_kind
            FROM public.folder_items fi
            JOIN public.bills b ON b.id = fi.item_id
            WHERE fi.folder_id = p_folder_id
              AND fi.item_type = 'bill'
        ) u
        GROUP BY u.raw_kind
    ) g;

    job_kind_breakdown := coalesce(v_breakdown, '[]'::jsonb);

    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_folder_bill_summary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_folder_bill_summary(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Bill counts for the Billing folder list
-- ─────────────────────────────────────────────────────────────────────────────
-- The folder list has to show "September Analysis — 24 bills" for every folder.
-- Counting client-side would mean one COUNT query per folder (N+1), and fetching
-- every `folder_items` row to group in JS means transferring every link in the
-- whole application. This returns one row per BILLING folder instead, so the
-- whole list costs exactly one request.
--
-- Folders with no bills are returned with bill_count 0 rather than omitted, so
-- the list can render an empty folder without a second lookup.
--
-- Restricted to `folder_type = 'billing'` on purpose: this is the Billing
-- section's count, and counting bills that happen to sit in a job folder would
-- put a job folder's bill total on a Billing screen.
CREATE OR REPLACE FUNCTION public.get_billing_folder_bill_counts()
RETURNS TABLE (
    folder_id   uuid,
    folder_name text,
    created_at  timestamptz,
    updated_at  timestamptz,
    bill_count  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- De-duplicated on the bill id, matching get_folder_bill_summary: a repeated
    -- link inflates neither this count nor that summary.
    --
    -- created_at / updated_at travel with the row so the client does not need a
    -- second request to know when a folder was made or renamed.
    SELECT f.id,
           f.name,
           f.created_at,
           f.updated_at,
           count(DISTINCT b.id) AS bill_count
    FROM public.admin_folders f
    LEFT JOIN public.folder_items fi
           ON fi.folder_id = f.id
          AND fi.item_type = 'bill'
    LEFT JOIN public.bills b
           ON b.id = fi.item_id
    WHERE f.folder_type = 'billing'
      AND EXISTS (
            -- Same active-admin gate as 0002 / 0004 / 0006, checked before any
            -- folder name or count is read.
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
          )
    -- f.created_at is grouped explicitly rather than relying on the
    -- functional-dependency shortcut: the ORDER BY below needs it, and naming it
    -- keeps that correct even if the primary key is ever changed.
    GROUP BY f.id, f.name, f.created_at
    ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_billing_folder_bill_counts() FROM public;
GRANT EXECUTE ON FUNCTION public.get_billing_folder_bill_counts() TO authenticated;