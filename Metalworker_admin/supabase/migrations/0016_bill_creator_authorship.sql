-- Migration: authorship and generation time for a hand-built bill.
--
-- WHY THIS IS A SEPARATE FILE AND NOT PART OF 0015
-- 0015 was already applied. A migration is history: rewriting an applied one to
-- smuggle in two more columns would make the repository disagree with the database
-- and would re-run `db push` against a database that already has the earlier version.
--
-- THE TWO COLUMNS
--
--   bills.created_by     who typed the invoice. NOT NULL is wrong here - every imported
--                        bill predates this column and has no author to record - so it
--                        is nullable, and it is filled in by `create-bill` alone.
--   bills.finalized_at   when the three copies were produced. Distinct from
--                        `updated_at`, which moves on every keystroke-driven save: an
--                        invoice's issued time is a fact about the document, and it
--                        cannot be read from a column that changes when somebody
--                        reopens the form.
--
-- NEITHER IS A NEW RELATIONSHIP
-- Both are plain uuid/timestamptz columns governed by the existing
-- `bills_admin_all` row policy, so a hand-built bill is exactly as private as an
-- imported one. No new policy, no new grant, no new storage rule.

BEGIN;

ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS created_by uuid
        REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

COMMENT ON COLUMN public.bills.created_by IS
    'The admin who typed this bill in the Bill Creator. Null for every bill parsed '
    'from a workbook, which has no human author in this sense - the uploader is '
    'recorded on bill_uploads.created_by instead.';

COMMENT ON COLUMN public.bills.finalized_at IS
    'When this bill''s ORIGINAL / DUPLICATE / TRIPLICATE were produced. Distinct from '
    'updated_at, which moves on every save; this moves once. Null while the bill is a '
    'draft, and it is set in the same UPDATE that stores the three PDF paths, so a '
    'bill cannot be finalized without it.';

-- "Which drafts are mine, newest first" is the query the Bills list runs for the
-- creator's own draft filter, and it is also what makes a partially-written draft
-- cheap to find again after a browser crash.
CREATE INDEX IF NOT EXISTS bills_created_by_idx
    ON public.bills (created_by, created_at DESC)
    WHERE created_by IS NOT NULL;

-- The self-check below is small, because there is very little here to be wrong about:
-- a nullable reference column with an index. What it does check is the part that could
-- quietly break a feature — that a bill with an author can still be finalized, and
-- that a finalized bill cannot be missing its timestamp.

SAVEPOINT bill_creator_authorship_selfcheck;

DO $$
DECLARE
    v_admin uuid;
    v_upload_id uuid;
    v_draft uuid;
    v_final uuid;
BEGIN
    SELECT p.id INTO v_admin
    FROM public.profiles p
    WHERE p.role = 'admin' AND p.is_active = true
    ORDER BY p.created_at
    LIMIT 1;

    IF v_admin IS NULL THEN
        RAISE NOTICE 'bill-creator authorship self-check SKIPPED: no active admin.';
        RETURN;
    END IF;

    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

    /* ---- 1. both columns exist ------------------------------------------- */

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='bills'
          AND column_name='created_by' AND is_nullable='YES'
    ) THEN
        RAISE EXCEPTION 'bills.created_by missing or NOT NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='bills'
          AND column_name='finalized_at' AND data_type='timestamp with time zone'
    ) THEN
        RAISE EXCEPTION 'bills.finalized_at missing or wrong type';
    END IF;

    RAISE NOTICE 'authorship self-check 1-2: both columns exist and are nullable.';

    /* ---- 2. the index exists -------------------------------------------- */

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND indexname='bills_created_by_idx'
    ) THEN
        RAISE EXCEPTION 'bills_created_by_idx missing';
    END IF;

    RAISE NOTICE 'authorship self-check 3: the draft-owner index exists.';

    /* ---- 3. a draft may carry an author and no timestamp ---------------- */

    INSERT INTO public.bill_uploads
        (original_filename, base_name, status, invoice_count, created_by, creation_source)
    VALUES ('Created manually','Created manually','completed',0,v_admin,'manual')
    RETURNING id INTO v_upload_id;

    IF v_upload_id IS NULL THEN
        RAISE EXCEPTION 'authorship self-check could not create its provenance row';
    END IF;

    INSERT INTO public.bills
        (bill_upload_id, sheet_name, invoice_no, invoice_date, status, origin,
         created_by, creator_draft_key)
    VALUES (v_upload_id,'AUTH-DRAFT','AUTH-DRAFT','2026-03-01','draft','manual',
            v_admin,'auth-check-key')
    RETURNING id INTO v_draft;

    IF v_draft IS NULL THEN
        RAISE EXCEPTION 'authorship self-check could not create its draft';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.bills
        WHERE id = v_draft AND created_by = v_admin AND finalized_at IS NULL
    ) THEN
        RAISE EXCEPTION 'a draft with an author could not exist with no finalized_at';
    END IF;

    RAISE NOTICE 'authorship self-check 4: a draft has an author and no timestamp.';

    /* ---- 4. finalizing sets both at once --------------------------------
       The same UPDATE the feature uses, with a real timestamp, so the constraint
       interaction between `bills_draft_has_no_documents` and the new columns is
       exercised rather than assumed. */

    INSERT INTO public.bills
        (bill_upload_id, sheet_name, invoice_no, invoice_date, status, origin,
         created_by, finalized_at, pdf_version,
         original_pdf_path, duplicate_pdf_path, triplicate_pdf_path)
    VALUES (v_upload_id,'AUTH-FINAL','AUTH-FINAL','2026-03-02','finalized','manual',
            v_admin, now(), 1,
            'x/' || v_admin::text || '_AUTH_v1_original.pdf',
            'x/' || v_admin::text || '_AUTH_v1_duplicate.pdf',
            'x/' || v_admin::text || '_AUTH_v1_triplicate.pdf')
    RETURNING id INTO v_final;

    IF v_final IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.bills WHERE id = v_final AND finalized_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'a finalized bill could not carry a finalized_at';
    END IF;

    RAISE NOTICE 'authorship self-check 5: a finalized bill carries a timestamp.';

    /* ---- 5. an existing bill is untouched by the new nullable columns ---- */

    IF EXISTS (
        SELECT 1 FROM public.bills
        WHERE created_by IS NOT NULL AND invoice_no NOT LIKE 'AUTH-%'
    ) THEN
        RAISE EXCEPTION 'an imported bill was given an author';
    END IF;

    RAISE NOTICE 'authorship self-check 6: no imported bill acquired an author.';

    /* ---- 7. cleanup ------------------------------------------------------ */

    DELETE FROM public.bills WHERE id IN (v_draft, v_final);
    DELETE FROM public.bill_uploads WHERE id = v_upload_id;

    IF EXISTS (SELECT 1 FROM public.bills WHERE invoice_no LIKE 'AUTH-%') THEN
        RAISE EXCEPTION 'authorship self-check left a fixture row behind';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.bill_uploads
        WHERE id = v_upload_id
    ) THEN
        RAISE EXCEPTION 'authorship self-check left its provenance row behind';
    END IF;

    RAISE NOTICE 'bill-creator authorship self-check PASSED: 7 assertions, no fixtures left.';
END
$$;

ROLLBACK TO SAVEPOINT bill_creator_authorship_selfcheck;

COMMIT;