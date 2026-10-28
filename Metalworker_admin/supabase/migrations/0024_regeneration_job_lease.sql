-- Migration: lease + revision for the PDF regeneration job.
--
-- NOT APPLIED AUTOMATICALLY. Apply this before deploying the matching version of
-- the `regenerate-bill-pdfs` Edge Function; that function refuses to run (with a
-- clear "migration 0024 required" error) until these columns exist.
--
-- WHY
-- 0023 already guarantees at most one RUNNING job (a partial unique index on
-- status). What it could not guarantee is that only one INVOCATION works on that
-- job at a time: a double click, a second browser tab or a client retry racing a
-- slow request could each process the same unit and count it twice.
--
--   revision     bumped by every write. Every update is a compare-and-set on it, so
--                a stale invocation's write matches no row instead of overwriting.
--   lease_token  which invocation currently holds the job.
--   lease_until  when that claim lapses if the invocation died (e.g. the worker was
--                killed with HTTP 546). After it, the next invocation may take over.
--
-- The detailed progress (current workbook, stage, chunk manifest, per-workbook
-- results) stays in the existing `cursor` column as versioned JSON, so no other
-- schema change is needed.

BEGIN;

ALTER TABLE public.bill_pdf_regeneration_jobs
    ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lease_token uuid,
    ADD COLUMN IF NOT EXISTS lease_until timestamptz;

COMMENT ON COLUMN public.bill_pdf_regeneration_jobs.revision IS
    'Compare-and-set version. Every write by regenerate-bill-pdfs matches on it and increments it.';
COMMENT ON COLUMN public.bill_pdf_regeneration_jobs.lease_token IS
    'The invocation currently working on this job, if any.';
COMMENT ON COLUMN public.bill_pdf_regeneration_jobs.lease_until IS
    'When lease_token''s claim lapses if that invocation never released it.';

-- Lookups by status (the running job) and recency (status reads).
CREATE INDEX IF NOT EXISTS bill_pdf_regeneration_jobs_started_idx
    ON public.bill_pdf_regeneration_jobs (started_at DESC);

COMMIT;
