-- Migration: preserve workbook sheet order and support durable PDF regeneration jobs.
--
-- 1. bills.sheet_order: the position of a worksheet within its uploaded workbook.
--    Uploaded bills receive this at import time. Historical rows remain NULL because
--    their original order is not stored anywhere recoverable.
--
-- 2. bill_pdf_regeneration_jobs: one active job at a time, with saved phase/cursor
--    and counters so an interrupted regeneration can resume.

BEGIN;

ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS sheet_order integer;

CREATE INDEX IF NOT EXISTS bills_sheet_order_idx
    ON public.bills (bill_upload_id, sheet_order);

CREATE TABLE IF NOT EXISTS public.bill_pdf_regeneration_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'abandoned')),
    phase text NOT NULL DEFAULT 'bills'
        CHECK (phase IN ('bills', 'aggregates')),
    cursor text,
    bills_processed integer NOT NULL DEFAULT 0,
    bills_succeeded integer NOT NULL DEFAULT 0,
    bills_failed integer NOT NULL DEFAULT 0,
    aggregates_processed integer NOT NULL DEFAULT 0,
    aggregates_succeeded integer NOT NULL DEFAULT 0,
    aggregates_failed integer NOT NULL DEFAULT 0,
    started_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_error text
);

-- Only one running job at a time.
CREATE UNIQUE INDEX IF NOT EXISTS bill_pdf_regeneration_jobs_one_running
    ON public.bill_pdf_regeneration_jobs (status)
    WHERE status = 'running';

ALTER TABLE public.bill_pdf_regeneration_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "regen_jobs_admin_all" ON public.bill_pdf_regeneration_jobs;
CREATE POLICY "regen_jobs_admin_all" ON public.bill_pdf_regeneration_jobs
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));

COMMIT;