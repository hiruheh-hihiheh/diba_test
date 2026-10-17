-- Migration: Company Bills - Independent document management for supplier/expense bills
BEGIN;
CREATE TABLE IF NOT EXISTS public.company_bill_folders (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.company_bill_documents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id         uuid REFERENCES public.company_bill_folders (id) ON DELETE SET NULL,
    display_name      text NOT NULL,
    original_filename text NOT NULL,
    storage_path      text NOT NULL,
    content_type      text,
    byte_size         bigint,
    supplier_name     text,
    bill_number       text,
    bill_date         date,
    amount            numeric(14, 2),
    notes             text,
    uploaded_by       uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_bill_documents_folder_idx ON public.company_bill_documents (folder_id);
CREATE INDEX IF NOT EXISTS company_bill_documents_created_at_idx ON public.company_bill_documents (created_at DESC);
CREATE INDEX IF NOT EXISTS company_bill_documents_display_name_idx ON public.company_bill_documents (lower(display_name));
CREATE INDEX IF NOT EXISTS company_bill_documents_supplier_name_idx ON public.company_bill_documents (lower(supplier_name));
CREATE INDEX IF NOT EXISTS company_bill_documents_bill_number_idx ON public.company_bill_documents (lower(bill_number));
ALTER TABLE public.company_bill_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bill_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_bill_folders FROM anon;
REVOKE ALL ON TABLE public.company_bill_documents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_bill_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_bill_documents TO authenticated;
DROP POLICY IF EXISTS "company_bill_folders_no_anon_access" ON public.company_bill_folders;
DROP POLICY IF EXISTS "company_bill_documents_no_anon_access" ON public.company_bill_documents;
CREATE POLICY "company_bill_folders_no_anon_access" ON public.company_bill_folders FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "company_bill_documents_no_anon_access" ON public.company_bill_documents FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "company_bill_folders_admin_all" ON public.company_bill_folders;
DROP POLICY IF EXISTS "company_bill_documents_admin_all" ON public.company_bill_documents;
CREATE POLICY "company_bill_folders_admin_all" ON public.company_bill_folders FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
CREATE POLICY "company_bill_documents_admin_all" ON public.company_bill_documents FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('company-bills', 'company-bills', false, 52428800,
    ARRAY['application/pdf','image/jpeg','image/jpg','image/png','image/webp','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "company_bills_storage_read" ON storage.objects;
DROP POLICY IF EXISTS "company_bills_storage_write" ON storage.objects;
DROP POLICY IF EXISTS "company_bills_storage_delete" ON storage.objects;
CREATE POLICY "company_bills_storage_read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'company-bills' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
CREATE POLICY "company_bills_storage_write" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'company-bills' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
CREATE POLICY "company_bills_storage_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'company-bills' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
COMMIT;
