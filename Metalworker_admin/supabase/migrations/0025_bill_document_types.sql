
-- Migration: Tax Invoices and Delivery Challans as two document types.
--
-- Apply after 0024 and before deploying the matching Edge Functions.
--
-- One shared bills table with document_type:
--   tax_invoice
--   delivery_challan
--
-- Challan monetary fields remain NULL. No dummy values are stored.
-- Existing records default to tax_invoice.
--
-- Mixed workbooks are represented by separate logical uploads linked
-- through source_group_id.
--
-- Billing folders are isolated by document type.

BEGIN;

-- 1. Document type on uploads

ALTER TABLE public.bill_uploads
    ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'tax_invoice',
    ADD COLUMN IF NOT EXISTS source_group_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.bill_uploads'::regclass
          AND conname = 'bill_uploads_document_type_check'
    ) THEN
        ALTER TABLE public.bill_uploads
            ADD CONSTRAINT bill_uploads_document_type_check
            CHECK (document_type IN ('tax_invoice', 'delivery_challan'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.bill_uploads'::regclass
          AND conname = 'bill_uploads_id_document_type_key'
    ) THEN
        ALTER TABLE public.bill_uploads
            ADD CONSTRAINT bill_uploads_id_document_type_key
            UNIQUE (id, document_type);
    END IF;
END;
$$;

COMMENT ON COLUMN public.bill_uploads.document_type IS
    'tax_invoice or delivery_challan, classified from the worksheet title.';

COMMENT ON COLUMN public.bill_uploads.source_group_id IS
    'Links logical uploads created by splitting a mixed workbook.';

CREATE INDEX IF NOT EXISTS bill_uploads_document_type_idx
    ON public.bill_uploads (document_type, created_at DESC);

CREATE INDEX IF NOT EXISTS bill_uploads_source_group_idx
    ON public.bill_uploads (source_group_id)
    WHERE source_group_id IS NOT NULL;


-- 2. Document type on bills, linked to the upload

ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'tax_invoice';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.bills'::regclass
          AND conname = 'bills_document_type_check'
    ) THEN
        ALTER TABLE public.bills
            ADD CONSTRAINT bills_document_type_check
            CHECK (document_type IN ('tax_invoice', 'delivery_challan'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.bills'::regclass
          AND conname = 'bills_upload_document_type_fkey'
    ) THEN
        ALTER TABLE public.bills
            ADD CONSTRAINT bills_upload_document_type_fkey
            FOREIGN KEY (bill_upload_id, document_type)
            REFERENCES public.bill_uploads (id, document_type)
            ON DELETE CASCADE;
    END IF;
END;
$$;

COMMENT ON COLUMN public.bills.document_type IS
    'Must match the document_type of its associated upload.';

CREATE INDEX IF NOT EXISTS bills_document_type_idx
    ON public.bills (document_type, invoice_date DESC);


-- 3. Remarks per Delivery Challan line item

ALTER TABLE public.bill_line_items
    ADD COLUMN IF NOT EXISTS remarks text;

COMMENT ON COLUMN public.bill_line_items.remarks IS
    'The REMARKS column of a Delivery Challan. NULL for Tax Invoice items.';


-- 4. Billing folders per document type

ALTER TABLE public.admin_folders
    DROP CONSTRAINT IF EXISTS admin_folders_folder_type_check;

ALTER TABLE public.admin_folders
    ADD CONSTRAINT admin_folders_folder_type_check
    CHECK (
        folder_type IS NULL
        OR folder_type IN (
            'labour',
            'with_material',
            'general',
            'billing',
            'challan_billing'
        )
    );


-- 5. Enforce document-type isolation in billing folders

CREATE OR REPLACE FUNCTION public.enforce_billing_folder_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    kind text;
    bill_type text;
    expected_bill_type text;
    folder_label text;
    bill_label text;
BEGIN
    SELECT f.folder_type
    INTO kind
    FROM public.admin_folders AS f
    WHERE f.id = NEW.folder_id;

    IF kind IN ('billing', 'challan_billing') THEN

        IF NEW.item_type IS DISTINCT FROM 'bill' THEN
            RAISE EXCEPTION
                'A billing folder can only contain bills; got item_type=%.',
                NEW.item_type
                USING ERRCODE = 'check_violation';
        END IF;

        -- Resolve the expected document type separately.
        -- This avoids the PL/pgSQL parser ambiguity in an inline CASE/IF.
        IF kind = 'billing' THEN
            expected_bill_type := 'tax_invoice';
            folder_label := 'Tax Bills';
        ELSE
            expected_bill_type := 'delivery_challan';
            folder_label := 'Challan Bills';
        END IF;

        SELECT b.document_type
        INTO bill_type
        FROM public.bills AS b
        WHERE b.id = NEW.item_id;

        IF bill_type IS NOT NULL
           AND bill_type <> expected_bill_type THEN

            IF bill_type = 'tax_invoice' THEN
                bill_label := 'Tax Invoice';
            ELSE
                bill_label := 'Delivery Challan';
            END IF;

            RAISE EXCEPTION
                'A % folder cannot hold a % bill.',
                folder_label,
                bill_label
                USING ERRCODE = 'check_violation';
        END IF;

    END IF;

    RETURN NEW;
END;
$$;


-- 6. Billing-folder bill counts by document type

CREATE OR REPLACE FUNCTION public.get_billing_folder_bill_counts_by_kind(
    p_folder_type text
)
RETURNS TABLE (
    folder_id uuid,
    folder_name text,
    created_at timestamptz,
    updated_at timestamptz,
    bill_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        f.id,
        f.name,
        f.created_at,
        f.updated_at,
        count(DISTINCT b.id) AS bill_count
    FROM public.admin_folders AS f
    LEFT JOIN public.folder_items AS fi
        ON fi.folder_id = f.id
       AND fi.item_type = 'bill'
    LEFT JOIN public.bills AS b
        ON b.id = fi.item_id
       AND b.status <> 'draft'
    WHERE f.folder_type = p_folder_type
      AND p_folder_type IN ('billing', 'challan_billing')
      AND EXISTS (
          SELECT 1
          FROM public.profiles AS p
          WHERE p.id = auth.uid()
            AND p.role = 'admin'
            AND p.is_active = true
      )
    GROUP BY f.id, f.name, f.created_at, f.updated_at
    ORDER BY f.created_at DESC;
$$;

REVOKE ALL
ON FUNCTION public.get_billing_folder_bill_counts_by_kind(text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_billing_folder_bill_counts_by_kind(text)
TO authenticated;


-- 7. Self-check: every bill must match its upload's document type

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.bills AS b
        JOIN public.bill_uploads AS u
          ON u.id = b.bill_upload_id
        WHERE b.document_type <> u.document_type
    ) THEN
        RAISE EXCEPTION
            'A bill does not match its upload document_type.';
    END IF;
END;
$$;

COMMIT;
