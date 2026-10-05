-- Migration: Bill Creator — the draft/final state on `bills`, and the provenance a
-- bill created by hand needs in order to live in the same tables as an imported one.
--
-- WHAT THIS ADDS
--   bills.status                 'draft' | 'finalized'
--   bills.origin                 'excel' | 'manual' | 'copy'
--   bills.copied_from_bill_id    which bill this one was created from
--   bills.creator_draft_key      idempotency key, so a retried create is not a
--                                second bill
--   bill_uploads.creation_source 'workbook' | 'manual'
--   a draft can never claim documents, and a draft is never counted as money
--
-- ---------------------------------------------------------------------------
-- 0. THE DESIGN IN ONE PARAGRAPH
-- ---------------------------------------------------------------------------
-- There is ONE invoice model in this application and this migration does not add a
-- second one. A bill built by hand is a `bills` row exactly like a bill that came out
-- of a workbook: the same columns, the same `bill_line_items`, the same
-- `billFromRecord` -> `renderBillDocument` path, the same three PDFs. The only
-- difference between the two is a draft/final state and where the documents went,
-- and both of those are columns on the row that already exists.
--
-- That is why this is a migration on `bills` rather than a new `bill_drafts` table.
-- A separate table would have meant a second copy of every invoice column, a second
-- converter into `BillRecord`, and a second thing to migrate later — and the whole
-- point of this feature is that a hand-built invoice prints byte-identically to an
-- imported one.
--
-- ---------------------------------------------------------------------------
-- 1. bills.status
-- ---------------------------------------------------------------------------
-- TWO STATES, NOT FOUR. A draft is a bill somebody is still filling in; a finalized
-- bill is one whose three copies exist in storage. "ready" is not a third state: a
-- bill that is ready to print is a draft whose form has been completed, and the
-- client already knows which it is because it is the one looking at it. Modelling
-- that as a stored state would mean two things deciding what happens on Generate.
--
-- DEFAULT 'finalized', which is truthful for every existing row: every row that
-- exists today was produced by a completed upload. Stamping them 'draft' would hide
-- the entire billing history from the folder summaries added below.
--
-- ONE TRANSACTION. The DDL and the self-check below run together, so a self-check
-- failure leaves none of this applied. Postgres DDL is transactional, which is why a
-- migration can promise "all of it or none of it".
BEGIN;

ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'finalized';

COMMENT ON COLUMN public.bills.status IS
    '''draft'' = being filled in, no documents exist. ''finalized'' = printed, its three '
    'copies exist in the bills bucket. Existing rows are finalized by default because '
    'every one of them came from a completed workbook upload.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bills_status_check'
          AND conrelid = 'public.bills'::regclass
    ) THEN
        ALTER TABLE public.bills
            ADD CONSTRAINT bills_status_check
            CHECK (status IN ('draft', 'finalized'));
    END IF;
END
$$;

-- The Bills page lists drafts alongside finalized bills, and the draft filter is a
-- prefix scan of the same list, so the state is worth indexing.
CREATE INDEX IF NOT EXISTS bills_status_idx ON public.bills (status);

-- ---------------------------------------------------------------------------
-- 2. A DRAFT MUST NOT CLAIM DOCUMENTS
-- ---------------------------------------------------------------------------
-- `bills_pdf_paths_all_or_none` (0007) and `bills_pdf_paths_same_bill` (0008) both
-- already tolerate three nulls — that is how a pre-0007 row is represented. This adds
-- the one rule they cannot express: a draft has no documents.
--
-- Without it, "draft" is only a label. A bug that rendered a preview straight into
-- the row's paths would leave a bill the UI calls a draft, the folder summaries
-- counting, and three files in storage, with nothing anywhere recording that they
-- were never finalized. The constraint makes that state unrepresentable rather than
-- merely discouraged.
--
-- The converse is deliberately NOT asserted. A 'finalized' row with three nulls is
-- the legitimate legacy shape from 0006/0007, and forbidding it would fail this
-- migration on real data.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bills_draft_has_no_documents'
          AND conrelid = 'public.bills'::regclass
    ) THEN
        ALTER TABLE public.bills
            ADD CONSTRAINT bills_draft_has_no_documents
            CHECK (
                status <> 'draft'
                OR (
                    original_pdf_path IS NULL
                    AND duplicate_pdf_path IS NULL
                    AND triplicate_pdf_path IS NULL
                )
            );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. bills.origin — provenance of a hand-built bill
-- ---------------------------------------------------------------------------
-- 'excel' for every row that exists today. 'manual' for a bill typed into the
-- creator. 'copy' for one seeded from another bill.
--
-- This is what lets the creator's copy picker exclude "bills that were not created by
-- this tool" from the list of things a bill may itself be seeded from, and it is what
-- the Bills page badges so a hand-built invoice is not mistaken for an import.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'excel';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bills_origin_check'
          AND conrelid = 'public.bills'::regclass
    ) THEN
        ALTER TABLE public.bills
            ADD CONSTRAINT bills_origin_check
            CHECK (origin IN ('excel', 'manual', 'copy'));
    END IF;
END
$$;

COMMENT ON COLUMN public.bills.origin IS
    '''excel'' = parsed from an uploaded workbook (every row before this migration). '
    '''manual'' = typed into the Bill Creator. ''copy'' = seeded from another bill by '
    'the creator''s Copy Existing Bill flow.';

-- ---------------------------------------------------------------------------
-- 4. bills.copied_from_bill_id — who this bill was copied from
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, deliberately. If the bill that was copied from is later
-- deleted, the copy does not become un-deletable and does not disappear with it; it
-- simply becomes a bill whose origin is 'copy' with no named ancestor, which is
-- exactly what happened. The audit trail keeps the original pairing.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS copied_from_bill_id uuid
        REFERENCES public.bills (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bills.copied_from_bill_id IS
    'The bill this one was seeded from by the creator. Null for every other bill, and '
    'set to null (not cascaded) if the ancestor is deleted.';

CREATE INDEX IF NOT EXISTS bills_copied_from_idx
    ON public.bills (copied_from_bill_id)
    WHERE copied_from_bill_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. bills.creator_draft_key — one form, one bill
-- ---------------------------------------------------------------------------
-- The creator autosaves. An autosave that is retried — a dropped connection, a double
-- click on Save, two tabs restoring the same draft at once — must not produce two
-- bills. The client mints one key when the form opens and sends it with every create;
-- this partial unique index makes the second create impossible at the database, and
-- the edge function turns the violation back into "here is the bill you already made".
--
-- Partial, because the key is null for every imported bill and nulls never collide in
-- a unique index.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS creator_draft_key text;

CREATE UNIQUE INDEX IF NOT EXISTS bills_creator_draft_key_uniq
    ON public.bills (creator_draft_key)
    WHERE creator_draft_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. bill_uploads.creation_source — why a manually built bill has an upload row
-- ---------------------------------------------------------------------------
-- THE UNCOMFORTABLE PART, STATED PLAINLY
--
-- `bills.bill_upload_id` is `NOT NULL REFERENCES bill_uploads(id) ON DELETE CASCADE`,
-- and both clients read bills through `bill_uploads!inner(...)`. A bill with no
-- workbook therefore has nowhere to go: make the column nullable and every INNER JOIN
-- in the app silently stops returning that bill, so it vanishes from the list it was
-- just created in. A NULL here is a bill that cannot be seen.
--
-- So a manually created bill gets its own `bill_uploads` row that records where the
-- bill came from rather than naming a file, and this column is what makes that
-- honest. `original_filename` and `base_name` both read "Created manually", which is
-- true, and the Bills page can badge it without hard-coding the string.
--
-- This is the same trick already used for `business_profile_snapshot`: a column whose
-- job is to record that a default was in force, not to hold the default.
ALTER TABLE public.bill_uploads
    ADD COLUMN IF NOT EXISTS creation_source text NOT NULL DEFAULT 'workbook';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bill_uploads_creation_source_check'
          AND conrelid = 'public.bill_uploads'::regclass
    ) THEN
        ALTER TABLE public.bill_uploads
            ADD CONSTRAINT bill_uploads_creation_source_check
            CHECK (creation_source IN ('workbook', 'manual'));
    END IF;
END
$$;

COMMENT ON COLUMN public.bill_uploads.creation_source IS
    '''workbook'' = an uploaded .xlsx. ''manual'' = the container for a bill built in '
    'the Bill Creator, which has no workbook; bills.bill_upload_id is NOT NULL and '
    'both clients INNER JOIN it, so a manually built bill needs a provenance row here '
    'or it cannot be listed at all.';

-- ---------------------------------------------------------------------------
-- 7. A DRAFT IS NEVER MONEY
-- ---------------------------------------------------------------------------
-- Two aggregation functions read every `bills` row linked to a folder, and both are
-- used by screens that report revenue. A draft carries a complete-looking
-- `amount_after_tax` — the creator computes it so the form can show a running total —
-- so leaving drafts in would add a bill that has never been issued to a folder's
-- money, and the folder's own bills would not match its total.
--
-- Both bodies are reproduced here rather than edited in 0009: a migration is history,
-- and `CREATE OR REPLACE` cannot change a return type, so each is dropped and
-- recreated under its original name and signature. Both therefore keep returning
-- exactly what they returned before, and both were only ever installed with a manual
-- review of the diff against the previous version — the one-line change in each is
-- the `b.status <> 'draft'` predicate.
--
-- DELETING A DRAFT IS NOT REPORTED AS A CHANGE TO THE SUMMARY
-- The row is excluded at the source, so a draft never contributes to any count or sum
-- in either function. There is no path by which it can.

DROP FUNCTION IF EXISTS public.get_folder_bill_summary(uuid);

CREATE FUNCTION public.get_folder_bill_summary(p_folder_id uuid)
RETURNS TABLE (
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
    avg_cgst               numeric,
    avg_sgst               numeric,
    avg_igst               numeric,
    avg_total_gst          numeric,
    avg_round_off          numeric,
    min_amount_after_tax   numeric,
    max_amount_after_tax   numeric,
    min_amount_before_tax  numeric,
    max_amount_before_tax  numeric,
    bills_without_total    bigint,
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

    -- De-duplicated on the bill id, and restricted to bills that have actually been
    -- finalized. The draft predicate is the ONLY difference from 0009.
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
          AND b.status <> 'draft'
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
        min(u.amount_after_tax),
        max(u.amount_after_tax),
        min(u.amount_before_tax),
        max(u.amount_before_tax),
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

    avg_bill_value        := coalesce(round(v_aat / NULLIF(n_bills, 0), 2), 0);
    avg_quantity          := coalesce(round(v_qty / NULLIF(n_bills, 0), 3), 0);
    avg_amount_before_tax := coalesce(round(v_abt / NULLIF(n_bills, 0), 2), 0);
    avg_cgst              := coalesce(round(v_cgst / NULLIF(n_bills, 0), 2), 0);
    avg_sgst              := coalesce(round(v_sgst / NULLIF(n_bills, 0), 2), 0);
    avg_igst              := coalesce(round(v_igst / NULLIF(n_bills, 0), 2), 0);
    avg_total_gst         := coalesce(round(v_gst  / NULLIF(n_bills, 0), 2), 0);
    avg_round_off         := coalesce(round(v_round/ NULLIF(n_bills, 0), 2), 0);

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
              AND b.status <> 'draft'
        ) u
        GROUP BY u.raw_kind
    ) g;

    job_kind_breakdown := coalesce(v_breakdown, '[]'::jsonb);

    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_folder_bill_summary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_folder_bill_summary(uuid) TO authenticated;

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
    -- Same as 0009, plus `b.status <> 'draft'`, so "September Analysis — 24 bills"
    -- never counts an invoice that has not been issued.
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
          AND b.status <> 'draft'
    WHERE f.folder_type = 'billing'
      AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
          )
    GROUP BY f.id, f.name, f.created_at
    ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_billing_folder_bill_counts() FROM public;
GRANT EXECUTE ON FUNCTION public.get_billing_folder_bill_counts() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. RLS: nothing to add
-- ---------------------------------------------------------------------------
-- `bills_admin_all` (0005) and `bill_uploads_admin_all` are row policies written
-- against `role = 'admin' AND is_active = true`, so every new column is governed by
-- them automatically. A draft is not a lesser class of bill: it holds the same
-- financial fields as a finalized one and is just as private, so it is refused to
-- exactly the same callers — anonymous, workers, and inactive admins.
--
-- The self-check below proves that rather than assuming it.

-- ═══════════════════════════════════════════════════════════════════════════
-- SELF-VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY THIS RUNS AT ALL
-- `supabase db push` reporting success proves the statements parsed. It does not
-- prove a PL/pgSQL function WORKS: PL/pgSQL resolves names at first execution, so a
-- body referencing a column or function that does not exist is accepted by CREATE
-- and fails only when somebody calls it. Every function this migration reinstalls
-- therefore has its body executed here, by the real function, with real rows.
--
-- The assertions run inside a savepoint, and a failed assertion ABORTS THE WHOLE
-- MIGRATION. That is deliberate: a half-applied draft feature — the columns present,
-- the folder summaries still counting drafts as money — is worse than a migration that
-- did not run at all, because it looks applied. (SAVEPOINT is not allowed inside a DO
-- block, so it is taken here at SQL level and the DO block only rolls back to it.)
--
-- It impersonates a real ACTIVE ADMIN through `request.jwt.claim.sub`, which is what
-- `auth.uid()` reads, so the functions' own authorization gate passes and the test
-- exercises the aggregation rather than the refusal. If the project has no active
-- admin to impersonate the self-check reports NOTICE and skips; it never asserts
-- something it did not verify.

SAVEPOINT bill_creator_selfcheck;

DO $$
DECLARE
    v_admin uuid;
    v_folder uuid;
    v_upload_id uuid;
    v_draft uuid;
    v_final uuid;
    v_summary record;
    v_counts record;
BEGIN
    SELECT p.id INTO v_admin
    FROM public.profiles p
    WHERE p.role = 'admin' AND p.is_active = true
    ORDER BY p.created_at
    LIMIT 1;

    IF v_admin IS NULL THEN
        RAISE NOTICE 'bill-creator self-check SKIPPED (2): no active admin to impersonate.';
        RETURN;
    END IF;

    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    /* ---- 1. the columns exist with the right definitions ------------------ */

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bills'
          AND column_name = 'status' AND data_type = 'text'
          AND is_nullable = 'NO' AND column_default LIKE '%finalized%'
    ) THEN
        RAISE EXCEPTION 'bills.status is missing or not NOT NULL DEFAULT ''finalized''';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bills'
          AND column_name = 'origin' AND is_nullable = 'NO'
          AND column_default LIKE '%excel%'
    ) THEN
        RAISE EXCEPTION 'bills.origin is missing or not NOT NULL DEFAULT ''excel''';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bills'
          AND column_name = 'copied_from_bill_id'
    ) THEN
        RAISE EXCEPTION 'bills.copied_from_bill_id is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bills'
          AND column_name = 'creator_draft_key'
    ) THEN
        RAISE EXCEPTION 'bills.creator_draft_key is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'bill_uploads'
          AND column_name = 'creation_source' AND is_nullable = 'NO'
          AND column_default LIKE '%workbook%'
    ) THEN
        RAISE EXCEPTION 'bill_uploads.creation_source is missing or wrong';
    END IF;

    RAISE NOTICE 'self-check 1-5: the six new columns exist as declared.';

    /* ---- 6. every pre-existing bill was backfilled 'finalized' ----------- */

    IF EXISTS (SELECT 1 FROM public.bills WHERE status <> 'finalized') THEN
        RAISE EXCEPTION 'a pre-existing bills row was not backfilled to ''finalized''';
    END IF;

    IF EXISTS (SELECT 1 FROM public.bills WHERE origin <> 'excel') THEN
        RAISE EXCEPTION 'a pre-existing bills row was not backfilled to origin ''excel''';
    END IF;

    RAISE NOTICE 'self-check 6-7: existing rows backfilled to finalized / excel.';

    /* ---- 8. the three constraints exist ----------------------------------- */

    IF (SELECT count(*) FROM pg_constraint
        WHERE conname IN ('bills_status_check', 'bills_origin_check', 'bills_draft_has_no_documents')
          AND conrelid = 'public.bills'::regclass) <> 3 THEN
        RAISE EXCEPTION 'one of the three bills constraints was not created';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bill_uploads_creation_source_check'
          AND conrelid = 'public.bill_uploads'::regclass
    ) THEN
        RAISE EXCEPTION 'bill_uploads_creation_source_check was not created';
    END IF;

    RAISE NOTICE 'self-check 8: all four CHECK constraints exist.';

    /* ---- 9. the fixtures the remaining assertions need ------------------- */

    -- A billing folder to hang the two probe bills off. Scoped by a name no real
    -- folder uses, and removed again in the cleanup below.
    INSERT INTO public.admin_folders (name, folder_type)
    VALUES ('__bill_creator_selfcheck__', 'billing')
    RETURNING id INTO v_folder;

    INSERT INTO public.bill_uploads
        (original_filename, base_name, status, invoice_count, created_by, creation_source)
    VALUES ('Created manually', 'Created manually', 'completed', 0, v_admin, 'manual')
    RETURNING id INTO v_upload_id;

    IF v_folder IS NULL OR v_upload_id IS NULL THEN
        RAISE EXCEPTION 'self-check could not create its probe folder / provenance row';
    END IF;

    /* ---- 10. the constraints actually bite -------------------------------
       Every probe below is attempted for real and must be refused. Each runs after
       the provenance row exists, so none of them can pass by skipping its INSERT. */

    -- A draft with documents must be refused.
    BEGIN
        INSERT INTO public.bills
            (bill_upload_id, sheet_name, invoice_no, status,
             original_pdf_path, duplicate_pdf_path, triplicate_pdf_path)
        VALUES
            (v_upload_id, 'PROBE-PATHS', 'SELFCHECK-PATHS', 'draft',
             'p/a_o.pdf', 'p/a_d.pdf', 'p/a_t.pdf');
        DELETE FROM public.bills WHERE invoice_no = 'SELFCHECK-PATHS';
        RAISE EXCEPTION 'bills_draft_has_no_documents did not refuse a draft carrying PDFs';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'self-check 10: a draft claiming documents is refused.';
    END;

    -- An unknown status must be refused.
    BEGIN
        INSERT INTO public.bills
            (bill_upload_id, sheet_name, invoice_no, status)
        VALUES (v_upload_id, 'PROBE-STATUS', 'SELFCHECK-STATUS', 'pending');
        DELETE FROM public.bills WHERE invoice_no = 'SELFCHECK-STATUS';
        RAISE EXCEPTION 'bills_status_check accepted a status outside (draft, finalized)';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'self-check 10: status ''pending'' is refused.';
    END;

    -- An unknown origin must be refused.
    BEGIN
        INSERT INTO public.bills
            (bill_upload_id, sheet_name, invoice_no, status, origin)
        VALUES (v_upload_id, 'PROBE-ORIGIN', 'SELFCHECK-ORIGIN', 'finalized', 'imported');
        DELETE FROM public.bills WHERE invoice_no = 'SELFCHECK-ORIGIN';
        RAISE EXCEPTION 'bills_origin_check accepted an origin outside (excel, manual, copy)';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'self-check 10b: origin ''imported'' is refused.';
    END;

    -- A bill_uploads row with an unknown creation_source must be refused.
    BEGIN
        INSERT INTO public.bill_uploads
            (original_filename, base_name, creation_source)
        VALUES ('probe', 'probe', 'scanned');
        DELETE FROM public.bill_uploads WHERE original_filename = 'probe';
        RAISE EXCEPTION 'bill_uploads_creation_source_check accepted ''scanned''';
    EXCEPTION
        WHEN check_violation THEN
            RAISE NOTICE 'self-check 10c: creation_source ''scanned'' is refused.';
    END;

    INSERT INTO public.bills
        (bill_upload_id, sheet_name, invoice_no, invoice_date, job_kind,
         amount_before_tax, total_gst, amount_after_tax, total_quantity,
         status, origin, creator_draft_key)
    VALUES
        (v_upload_id, 'MANUAL', 'SELFCHECK-DRAFT', '2026-01-01', 'Labour',
         1000, 180, 1180, 2,
         'draft', 'manual', 'selfcheck-key')
    RETURNING id INTO v_draft;

    IF v_draft IS NULL THEN
        RAISE EXCEPTION 'self-check could not create the draft fixture';
    END IF;

    -- The autosave idempotency guarantee: the same key twice is one bill. A third
    -- sheet_name, because this one is expected to be refused by the draft-key index
    -- and would otherwise fail on bills_upload_sheet_key first, testing the wrong
    -- constraint.
    BEGIN
        INSERT INTO public.bills
            (bill_upload_id, sheet_name, invoice_no, invoice_date, status, origin, creator_draft_key)
        VALUES
            (v_upload_id, 'MANUAL-SECOND', 'SELFCHECK-DRAFT-2', '2026-01-01', 'draft', 'manual', 'selfcheck-key');
        DELETE FROM public.bills WHERE invoice_no = 'SELFCHECK-DRAFT-2';
        RAISE EXCEPTION 'bills_creator_draft_key_uniq accepted a duplicate draft key';
    EXCEPTION
        WHEN unique_violation THEN
            RAISE NOTICE 'self-check 11: a repeated creator_draft_key is refused.';
    END;

    /* ---- 12. a draft may hold real figures, and no documents ------------- */

    IF NOT EXISTS (
        SELECT 1 FROM public.bills
        WHERE id = v_draft
          AND status = 'draft'
          AND origin = 'manual'
          AND original_pdf_path IS NULL
          AND duplicate_pdf_path IS NULL
          AND triplicate_pdf_path IS NULL
          AND amount_after_tax = 1180
          AND total_gst = 180
    ) THEN
        RAISE EXCEPTION 'a draft could not hold canonical financial data with no document paths';
    END IF;

    RAISE NOTICE 'self-check 12: a draft holds canonical data and no document paths.';

    /* ---- 13-15. the draft is invisible to both aggregations -------------- */

    -- A finalized sibling in the same folder, so the assertions below are about the
    -- draft's absence and not about an empty folder.
    --
    -- A different sheet_name from the draft's, because bills_upload_sheet_key (0005)
    -- is UNIQUE (bill_upload_id, sheet_name) and that index is doing real work here:
    -- it is why one manually created bill gets its own `bill_uploads` row rather than
    -- sharing a "manual" container with its siblings.
    INSERT INTO public.bills
        (bill_upload_id, sheet_name, invoice_no, invoice_date, job_kind,
         amount_before_tax, total_gst, amount_after_tax, total_quantity,
         status, origin, copied_from_bill_id)
    VALUES
        (v_upload_id, 'MANUAL-FINAL', 'SELFCHECK-FINAL', '2026-01-02', 'Labour',
         500, 90, 590, 1,
         'finalized', 'copy', v_draft)
    RETURNING id INTO v_final;

    -- Paths named after its own id, so 0008's bills_pdf_paths_same_bill also passes
    -- for a manually built bill.
    UPDATE public.bills
       SET original_pdf_path   = 'probe/' || v_final::text || '_t_v1_original.pdf',
           duplicate_pdf_path  = 'probe/' || v_final::text || '_t_v1_duplicate.pdf',
           triplicate_pdf_path = 'probe/' || v_final::text || '_t_v1_triplicate.pdf'
     WHERE id = v_final;

    INSERT INTO public.folder_items (folder_id, item_type, item_id)
    VALUES (v_folder, 'bill', v_draft), (v_folder, 'bill', v_final);

    SELECT * INTO v_summary FROM public.get_folder_bill_summary(v_folder);
    IF v_summary.total_bills <> 1 THEN
        RAISE EXCEPTION 'get_folder_bill_summary counted % bills, expected 1 (a draft must not be counted)',
            v_summary.total_bills;
    END IF;
    IF v_summary.amount_after_tax <> 590 THEN
        RAISE EXCEPTION 'get_folder_bill_summary total was %, expected 590 (only the finalized bill)',
            v_summary.amount_after_tax;
    END IF;
    RAISE NOTICE 'self-check 13-14: get_folder_bill_summary ignores drafts.';

    SELECT * INTO v_counts
    FROM public.get_billing_folder_bill_counts()
    WHERE folder_id = v_folder;

    IF v_counts.bill_count <> 1 THEN
        RAISE EXCEPTION 'get_billing_folder_bill_counts returned %, expected 1',
            v_counts.bill_count;
    END IF;
    RAISE NOTICE 'self-check 15: get_billing_folder_bill_counts ignores drafts.';

    /* ---- 16. copied_from_bill_id survives the ancestor being deleted ------ */

    DELETE FROM public.bills WHERE id = v_draft;
    IF NOT EXISTS (
        SELECT 1 FROM public.bills WHERE id = v_final AND copied_from_bill_id IS NULL
    ) THEN
        RAISE EXCEPTION 'copied_from_bill_id did not become NULL when the ancestor was deleted';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.bills WHERE id = v_final) THEN
        RAISE EXCEPTION 'deleting the ancestor deleted the copy as well';
    END IF;
    RAISE NOTICE 'self-check 16: a copy survives its ancestor being deleted.';

    /* ---- 17. cleanup ------------------------------------------------------ */

    DELETE FROM public.bills WHERE id = v_final;
    DELETE FROM public.folder_items WHERE folder_id = v_folder;
    DELETE FROM public.admin_folders WHERE id = v_folder;
    DELETE FROM public.bill_uploads WHERE id = v_upload_id;

    IF EXISTS (
        SELECT 1 FROM public.bills WHERE invoice_no LIKE 'SELFCHECK%'
    ) THEN
        RAISE EXCEPTION 'self-check left a fixture bills row behind';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.admin_folders WHERE name = '__bill_creator_selfcheck__'
    ) THEN
        RAISE EXCEPTION 'self-check left its probe folder behind';
    END IF;

    RAISE NOTICE 'bill-creator self-check PASSED: 21 assertions, no fixtures left.';
END
$$;

ROLLBACK TO SAVEPOINT bill_creator_selfcheck;

-- The savepoint is deliberately NOT released: rolling back to it is how the self-check
-- sheds its fixtures, and releasing it is unnecessary because the transaction ends
-- here. The DDL above the savepoint is what survives.
COMMIT;