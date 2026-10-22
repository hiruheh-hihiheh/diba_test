-- Migration: Company Bills - add GST amount and payment status
BEGIN;
ALTER TABLE public.company_bill_documents
  ADD COLUMN IF NOT EXISTS gst_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;
UPDATE public.company_bill_documents SET is_paid = false WHERE is_paid IS NULL;
CREATE INDEX IF NOT EXISTS company_bill_documents_is_paid_idx ON public.company_bill_documents (is_paid);
COMMIT;
