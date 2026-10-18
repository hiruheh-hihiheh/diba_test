-- Migration: make reverse_charge_gst a text field to support Yes/No status.
BEGIN;
ALTER TABLE public.bills
  ALTER COLUMN reverse_charge_gst TYPE text
  USING (CASE WHEN reverse_charge_gst IS NULL THEN NULL ELSE reverse_charge_gst::text END);
COMMIT;
