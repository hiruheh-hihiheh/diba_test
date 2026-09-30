-- Migration: Bills (tax-invoice workbooks uploaded as Excel).
--
-- The client sends a workbook where EVERY invoice is laid out three times
-- vertically (ORIGINAL / DUPLICATE / TRIPLICATE). Those three blocks are three
-- physical print copies of ONE financial bill, never three bills.
--
-- The model therefore has three levels:
--
--   bill_uploads     one row per uploaded .xlsx workbook
--        |
--        +-- original_pdf_path / duplicate_pdf_path / triplicate_pdf_path
--            the three generated PDFs (storage paths inside the `bills` bucket,
--            i.e. <upload-id>/SAMPLE_original.pdf)
--
--   bills            one row per WORKSHEET (one real invoice)
--        |
--   bill_line_items  one row per invoice line
--
-- ORIGINAL / DUPLICATE / TRIPLICATE never appear as separate `bills` rows, so
-- every financial total in this schema is already "one copy" counted once.
-- Folder sums (see 0006) can simply sum the `bills` rows and can never triple
-- anything.
--
-- SECURITY: only an authenticated ACTIVE ADMIN may read or write any of this.
-- The EXCEPTION is reads/writes performed by the `process-bill-upload` edge
-- function, which uses the service role (service role bypasses RLS) and
-- verifies the caller server-side first. Workers and processors have no path to
-- bill documents.
--
-- Apply with:  psql "$DATABASE_URL" -f 0005_bills.sql
-- (or via the Supabase dashboard SQL editor)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) folder_items.item_type must be able to hold 'bill'
-- ─────────────────────────────────────────────────────────────────────────────
-- The base schema (created outside this migrations folder) may or may not carry
-- a CHECK on item_type, and it was written before 'bill' existed. We drop any
-- such CHECK so the new type is storable.
--
-- Deliberately NO replacement CHECK is added: this column is a free-form
-- discriminator validated by the app layer (FolderItemType in both admin
-- clients), and a hard-coded list would silently start rejecting types the
-- worker app writes (the column is shared with MetalWorkerApp, which this
-- migration must not constrain). The 0001 uniqueness index still prevents the
-- only integrity problem that actually mattered — duplicate (folder, type,
-- item) rows — and folder_items RLS is untouched.
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
        WHERE rel.relname = 'folder_items'
          AND con.contype = 'c'
          AND att.attname = 'item_type'
    LOOP
        EXECUTE format('ALTER TABLE public.folder_items DROP CONSTRAINT %I', con_name);
    END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) bill_uploads — one row per uploaded workbook
-- ─────────────────────────────────────────────────────────────────────────────
-- *_pdf_path columns hold the STORAGE PATH RELATIVE TO THE `bills` BUCKET, i.e.
-- the object name is "<upload-id>/SAMPLE_original.pdf" and the full path is
-- "bills/<upload-id>/SAMPLE_original.pdf". The last path segment is always the
-- exact on-disk filename, so downloads reuse it verbatim.
CREATE TABLE IF NOT EXISTS bill_uploads (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    original_filename   text NOT NULL,
    base_name           text NOT NULL,
    -- 'completed' is the only value a successful write produces. Rows are
    -- inserted once all three PDFs are in storage, so 'failed' is never left
    -- behind as a broken record.
    status              text NOT NULL DEFAULT 'completed'
                            CHECK (status IN ('uploaded', 'completed', 'failed')),
    original_pdf_path   text,
    duplicate_pdf_path  text,
    triplicate_pdf_path text,
    invoice_count       integer NOT NULL DEFAULT 0
                            CHECK (invoice_count >= 0),
    created_by          uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) bills — one row per worksheet (one real invoice)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_upload_id        uuid NOT NULL
                              REFERENCES bill_uploads (id) ON DELETE CASCADE,
    sheet_name            text NOT NULL,

    -- Invoice
    invoice_no            text,
    invoice_date          date,

    -- Challan
    our_challan_no        text,
    our_challan_date      date,
    your_challan_no       text,
    your_challan_date     date,

    -- Order. order_no_label keeps which template label was found, because the
    -- same client uses "Service Order No.:" for labour jobs and
    -- "Purchase Order No.:" for with-material jobs.
    order_no              text,
    order_no_label        text,
    order_date            date,

    -- Transport
    eway_bill_no          text,
    place_of_supply       text,
    state                 text,
    state_code            text,
    transporter_mode      text,
    vehicle_number        text,

    -- Party
    party_gst_no          text,
    party_name            text,

    -- Financial summary. Every column is per-invoice (never per-copy) and
    -- nullable, because a template may legitimately omit a field (e.g. IGST is
    -- written as the literal "-" on an intra-state invoice).
    total_quantity        numeric(14, 3),
    amount_before_tax     numeric(14, 2),
    cgst                  numeric(14, 2),
    sgst                  numeric(14, 2),
    igst                  numeric(14, 2),
    total_gst             numeric(14, 2),
    amount_after_tax      numeric(14, 2),
    reverse_charge_gst    numeric(14, 2),
    round_off             numeric(14, 2),
    amount_in_words       text,

    -- Presentation extras carried over from the workbook so the PDF renderer and
    -- the detail screen can reproduce the invoice.
    job_kind              text,
    seller_name           text,
    seller_address        text,
    bank_details          jsonb,
    terms                 text,

    created_at            timestamptz NOT NULL DEFAULT now()
);

-- One bill per worksheet per upload: a workbook can never produce two rows for
-- the same sheet.
CREATE UNIQUE INDEX IF NOT EXISTS bills_upload_sheet_key
    ON bills (bill_upload_id, sheet_name);
CREATE INDEX IF NOT EXISTS bills_upload_idx
    ON bills (bill_upload_id);
-- Search by invoice number (spec §20) without a sequential scan.
CREATE INDEX IF NOT EXISTS bills_invoice_no_idx
    ON bills (lower(invoice_no));
CREATE INDEX IF NOT EXISTS bills_invoice_date_idx
    ON bills (invoice_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS bills_party_gst_idx
    ON bills (lower(party_gst_no));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) bill_line_items — one row per invoice line
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bill_line_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id     uuid NOT NULL REFERENCES bills (id) ON DELETE CASCADE,
    sr_no       integer,
    description text,
    hsn_code    text,
    uom         text,
    quantity    numeric(14, 3),
    rate        numeric(14, 2),
    amount      numeric(14, 2)
);

CREATE INDEX IF NOT EXISTS bill_line_items_bill_idx
    ON bill_line_items (bill_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RLS — active admins only
-- ─────────────────────────────────────────────────────────────────────────────
-- The profiles subquery is subject to its own RLS, so a worker/processor is
-- either unable to see admin profiles (=> no row => denied) or is an admin
-- (=> row found => allowed). This is the same predicate as 0002/0003/0004.
ALTER TABLE bill_uploads   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_line_items ENABLE ROW LEVEL SECURITY;

-- anon can never touch bills.
DROP POLICY IF EXISTS "bills_no_anon_access"          ON bill_uploads;
DROP POLICY IF EXISTS "bills_no_anon_access"          ON bills;
DROP POLICY IF EXISTS "bills_no_anon_access"          ON bill_line_items;
CREATE POLICY "bills_no_anon_access" ON bill_uploads   FOR ALL TO anon  USING (false) WITH CHECK (false);
CREATE POLICY "bills_no_anon_access" ON bills           FOR ALL TO anon  USING (false) WITH CHECK (false);
CREATE POLICY "bills_no_anon_access" ON bill_line_items FOR ALL TO anon  USING (false) WITH CHECK (false);

-- An authenticated, active admin may do anything with bills.
-- (INSERT is only ever reached through the service-role edge function, but the
-- policy is declared for completeness so the rule is the same however a write
-- arrives.)
DROP POLICY IF EXISTS "bills_admin_all" ON bill_uploads;
DROP POLICY IF EXISTS "bills_admin_all" ON bills;
DROP POLICY IF EXISTS "bills_admin_all" ON bill_line_items;
CREATE POLICY "bills_admin_all" ON bill_uploads
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
CREATE POLICY "bills_admin_all" ON bills
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
CREATE POLICY "bills_admin_all" ON bill_line_items
    FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Private storage bucket for the generated PDFs
-- ─────────────────────────────────────────────────────────────────────────────
-- No bucket existed in this project before (verified: GET /storage/v1/bucket
-- returned an empty list), so the `bills` bucket is created here. It is PRIVATE
-- (public = false): documents are reachable only through short-lived signed
-- URLs minted by an authenticated admin session. No service-role key is ever
-- present in a client.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('bills', 'bills', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
    SET public             = false,
        file_size_limit    = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Signed-URL minting (read) and cleanup-on-delete for active admins.
DROP POLICY IF EXISTS "bills_storage_admin_read"   ON storage.objects;
DROP POLICY IF EXISTS "bills_storage_admin_delete" ON storage.objects;
CREATE POLICY "bills_storage_admin_read"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'bills'
        AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true)
    );

CREATE POLICY "bills_storage_admin_delete"
    ON storage.objects FOR DELETE TO authenticated
    USING (
        bucket_id = 'bills'
        AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true)
    );

-- INSERT is intentionally NOT granted to clients: PDFs are written only by the
-- service-role edge function, so a client cannot plant arbitrary objects in the
-- bills bucket.
