-- Migration: Tax Invoices and Delivery Challans as two document types.
--
-- NOT APPLIED AUTOMATICALLY. Apply after 0024 and before deploying the matching
-- process-bill-upload, update-bill, set-bill-logos and regenerate-bill-pdfs
-- functions. Every statement is additive; nothing existing is renamed or dropped.
--
-- WHY ONE SET OF TABLES WITH A DISCRIMINATOR
-- A Delivery Challan has the same shape as a Tax Invoice above and below its item
-- table — seller, customer, references, line items, job kind, signatures — and
-- differs in what it leaves out (rate, amount, tax, bank, terms) and one column it
-- adds (REMARKS per item). A parallel set of tables would duplicate every query,
-- policy, RPC, folder link and job link the bill system already has. So:
--
--   bill_uploads.document_type  'tax_invoice' | 'delivery_challan'
--   bills.document_type         the same, and REQUIRED to equal its upload's
--   bill_line_items.remarks     the challan's REMARKS column (null on invoices)
--   bill_uploads.source_group_id  links the two logical uploads one mixed workbook
--                                 is split into (null for a single-type upload)
--
-- Monetary columns are already nullable; a challan leaves them null. No dummy
-- rate, amount or GST value is ever stored.
--
-- EXISTING DATA
-- Every row written before this migration is a Tax Invoice: the upload parser
-- required a "TAX INVOICE" title, an AMOUNT column and financial totals, and the
-- Bill Creator only makes invoices. The column DEFAULT therefore backfills every
-- existing upload and bill as 'tax_invoice' in the same statement that adds it.
-- No PDF path or storage object is touched.
--
-- ISOLATION IS ENFORCED BY THE DATABASE, NOT ONLY BY THE APPS
-- A composite foreign key (bill_upload_id, document_type) -> bill_uploads(id,
-- document_type) makes it impossible for a challan bill to sit under an invoice
-- upload or the other way round, whichever client or function writes it.
--
-- Billing folders get a sibling kind, 'challan_billing', and the existing
-- billing-folder trigger now also requires a folder's bills to match its kind,
-- so a Tax Bills folder can never hold a challan and vice versa.
--
-- REVERSAL (if ever needed, before any challan data exists):
--   ALTER TABLE public.bills DROP CONSTRAINT bills_upload_document_type_fkey;
--   ALTER TABLE public.bill_uploads DROP CONSTRAINT bill_uploads_id_document_type_key;
--   ALTER TABLE public.bills DROP COLUMN document_type;
--   ALTER TABLE public.bill_uploads DROP COLUMN document_type, DROP COLUMN source_group_id;
--   ALTER TABLE public.bill_line_items DROP COLUMN remarks;
--   and restore 0009's enforce_billing_folder_items / 0015's folder-count function.

BEGIN;

-- 1) Document type on uploads -------------------------------------------------
ALTER TABLE public.bill_uploads
    ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'tax_invoice',
    ADD COLUMN IF NOT EXISTS source_group_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_uploads_document_type_check') THEN
        ALTER TABLE public.bill_uploads
            ADD CONSTRAINT bill_uploads_document_type_check
            CHECK (document_type IN ('tax_invoice', 'delivery_challan'));
    END IF;
    -- Target of the composite foreign key below. `id` alone is already unique, so
    -- this adds no new restriction on uploads.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bill_uploads_id_document_type_key') THEN
        ALTER TABLE public.bill_uploads
            ADD CONSTRAINT bill_uploads_id_document_type_key UNIQUE (id, document_type);
    END IF;
END $$;

COMMENT ON COLUMN public.bill_uploads.document_type IS
    'tax_invoice or delivery_challan, from each worksheet''s printed title. A mixed workbook becomes one upload per type.';
COMMENT ON COLUMN public.bill_uploads.source_group_id IS
    'Shared by the per-type uploads one mixed workbook was split into; null for a single-type workbook.';

CREATE INDEX IF NOT EXISTS bill_uploads_document_type_idx
    ON public.bill_uploads (document_type, created_at DESC);
CREATE INDEX IF NOT EXISTS bill_uploads_source_group_idx
    ON public.bill_uploads (source_group_id) WHERE source_group_id IS NOT NULL;

-- 2) Document type on bills, tied to the upload's ------------------------------
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'tax_invoice';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bills_document_type_check') THEN
        ALTER TABLE public.bills
            ADD CONSTRAINT bills_document_type_check
            CHECK (document_type IN ('tax_invoice', 'delivery_challan'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bills_upload_document_type_fkey') THEN
        ALTER TABLE public.bills
            ADD CONSTRAINT bills_upload_document_type_fkey
            FOREIGN KEY (bill_upload_id, document_type)
            REFERENCES public.bill_uploads (id, document_type)
            ON DELETE CASCADE;
    END IF;
END $$;

COMMENT ON COLUMN public.bills.document_type IS
    'Always equal to the upload''s document_type (bills_upload_document_type_fkey).';

CREATE INDEX IF NOT EXISTS bills_document_type_idx
    ON public.bills (document_type, invoice_date DESC);

-- 3) Remarks per item (Delivery Challan only) ----------------------------------
ALTER TABLE public.bill_line_items
    ADD COLUMN IF NOT EXISTS remarks text;

COMMENT ON COLUMN public.bill_line_items.remarks IS
    'The REMARKS column of a Delivery Challan. Always null for a Tax Invoice line.';

-- 4) Billing folders per document type -----------------------------------------
ALTER TABLE public.admin_folders DROP CONSTRAINT IF EXISTS admin_folders_folder_type_check;
ALTER TABLE public.admin_folders
    ADD CONSTRAINT admin_folders_folder_type_check
    CHECK (folder_type IS NULL
           OR folder_type IN ('labour', 'with_material', 'general', 'billing', 'challan_billing'));

CREATE OR REPLACE FUNCTION public.enforce_billing_folder_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    kind text;
    bill_type text;
BEGIN
    SELECT f.folder_type INTO kind
    FROM public.admin_folders f
    WHERE f.id = NEW.folder_id;

    IF kind IN ('billing', 'challan_billing') THEN
        IF NEW.item_type IS DISTINCT FROM 'bill' THEN
            RAISE EXCEPTION
                'A billing folder can only contain bills; got item_type=%.', NEW.item_type
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT b.document_type INTO bill_type FROM public.bills b WHERE b.id = NEW.item_id;
        IF bill_type IS NOT NULL
           AND bill_type <> CASE kind WHEN 'billing' THEN 'tax_invoice' ELSE 'delivery_challan' END THEN
            RAISE EXCEPTION
                'A % folder cannot hold a % bill.',
                CASE kind WHEN 'billing' THEN 'Tax Bills' ELSE 'Challan Bills' END,
                CASE bill_type WHEN 'tax_invoice' THEN 'Tax Invoice' ELSE 'Delivery Challan' END
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- The existing count function stays exactly as it was (Tax Bills folders), so
-- clients that have not been updated keep working. Challan Bills folders use this
-- sibling, which takes the folder kind explicitly.
CREATE OR REPLACE FUNCTION public.get_billing_folder_bill_counts_by_kind(p_folder_type text)
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
    WHERE f.folder_type = p_folder_type
      AND p_folder_type IN ('billing', 'challan_billing')
      AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
          )
    GROUP BY f.id, f.name, f.created_at
    ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_billing_folder_bill_counts_by_kind(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_billing_folder_bill_counts_by_kind(text) TO authenticated;

-- 5) Self-checks -----------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.bills b JOIN public.bill_uploads u ON u.id = b.bill_upload_id
               WHERE b.document_type <> u.document_type) THEN
        RAISE EXCEPTION 'a bill does not match its upload''s document_type';
    END IF;
END $$;

COMMIT;
