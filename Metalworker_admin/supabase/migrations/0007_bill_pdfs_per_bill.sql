-- Migration: one PDF set per BILL, not per workbook.
--
-- THE BUG THIS FIXES
-- 0005 put `original_pdf_path` / `duplicate_pdf_path` / `triplicate_pdf_path` on
-- `bill_uploads` and had the edge function render
--
--     renderBillDocument(parsed.map(b => b[kind]), COPY_LABEL[kind])
--
-- i.e. ONE document containing every invoice in the workbook. Every `bills` row
-- then pointed at that same upload, so on a 20-sheet workbook:
--
--   * "Download Original" on bill 301 downloaded a 20-page PDF of all 20 invoices;
--   * the bill detail sheet could only ever offer a document that contained other
--     invoices;
--   * deleting one row meant deleting the workbook, because the PDFs and the
--     sibling rows shared a lifetime.
--
-- The workbook is the SOURCE. The invoice is the RECORD. A record must own its own
-- documents, so the paths move down to `bills`.
--
-- WHAT IS ADDED
-- Three nullable text columns on `bills`. Nullable is the point: a row written
-- before this migration has no per-bill document, and saying so is what lets the
-- clients tell a real per-bill PDF from a legacy workbook-level one instead of
-- silently pointing every old bill at the same file.
--
-- BACKWARD COMPATIBILITY
-- The `bill_uploads` columns are KEPT and still written, holding an optional
-- aggregate "whole workbook, every invoice" document. Nothing existing is deleted
-- or rewritten, and no legacy row is given a per-bill path it never had. The
-- clients prefer the bill's own path and fall back to the upload's only for rows
-- that predate this migration, and they label that fallback.
--
-- RLS / STORAGE
-- Nothing to add. `bills_admin_all` is a row policy, so it governs the new columns
-- automatically, and the `bills` storage policies are scoped by `bucket_id` only,
-- so the new `<upload-id>/<bill-id>_…` objects are covered by the same
-- active-admin gate as the old ones.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Per-bill documents
-- ---------------------------------------------------------------------------
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS original_pdf_path   text,
    ADD COLUMN IF NOT EXISTS duplicate_pdf_path  text,
    ADD COLUMN IF NOT EXISTS triplicate_pdf_path text;

COMMENT ON COLUMN public.bills.original_pdf_path IS
    'Bucket-relative object name of THIS bill''s original, i.e. "<upload-id>/<bill-id>_<token>_original.pdf". Null on rows created before migration 0007, which only ever had a workbook-level document.';
COMMENT ON COLUMN public.bills.duplicate_pdf_path IS
    'Bucket-relative object name of THIS bill''s duplicate print copy. Null on pre-0007 rows.';
COMMENT ON COLUMN public.bills.triplicate_pdf_path IS
    'Bucket-relative object name of THIS bill''s triplicate print copy. Null on pre-0007 rows.';

-- The three copies are three renderings of ONE invoice, so this is documentation,
-- not a constraint: a row with all three null is a legacy row, and a row with
-- exactly one of them set is a partially written upload and should be surfaced
-- rather than trusted.
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_pdf_paths_all_or_none;
ALTER TABLE public.bills
    ADD CONSTRAINT bills_pdf_paths_all_or_none
    CHECK (
        (original_pdf_path IS NULL AND duplicate_pdf_path IS NULL AND triplicate_pdf_path IS NULL)
        OR (original_pdf_path IS NOT NULL AND duplicate_pdf_path IS NOT NULL AND triplicate_pdf_path IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- 2. Grouping a mixed workbook by job type
-- ---------------------------------------------------------------------------
-- The Bills screen groups WITH METAL / LABOUR JOB from `job_kind`. Grouping is a
-- read concern, so an index is all that is needed — no second row, no derived
-- table, and no column that could disagree with `job_kind` itself.
--
-- Partial, because legacy rows have a null `job_kind` and would otherwise bloat
-- the index for no query.
CREATE INDEX IF NOT EXISTS bills_job_kind_idx
    ON public.bills (job_kind)
    WHERE job_kind IS NOT NULL;

-- "delete this one bill" reads by id and the UI lists by upload, so this covers
-- the sibling-preservation and per-upload listings respectively.
CREATE INDEX IF NOT EXISTS bills_bill_upload_id_idx
    ON public.bills (bill_upload_id);

-- ---------------------------------------------------------------------------
-- 3. Legacy rows are identified, not rewritten
-- ---------------------------------------------------------------------------
-- No UPDATE here on purpose. Back-filling each old bill with the workbook PDF
-- would make every sibling point at a document containing all the others, which
-- is the exact bug being fixed — and it would do it invisibly. A null path stays
-- null so the client can say "this bill predates per-bill documents" instead.

COMMIT;
