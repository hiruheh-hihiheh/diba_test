-- Migration: Drawing Upload - Independent document management for engineering drawings
BEGIN;
CREATE TABLE IF NOT EXISTS public.drawing_upload_folders (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_by  uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.drawing_upload_documents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id         uuid REFERENCES public.drawing_upload_folders (id) ON DELETE SET NULL,
    display_name      text NOT NULL,
    original_filename text NOT NULL,
    storage_path      text NOT NULL,
    content_type      text,
    byte_size         bigint,
    drawing_number    text,
    notes             text,
    uploaded_by       uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drawing_upload_documents_folder_idx ON public.drawing_upload_documents (folder_id);
CREATE INDEX IF NOT EXISTS drawing_upload_documents_created_at_idx ON public.drawing_upload_documents (created_at DESC);
CREATE INDEX IF NOT EXISTS drawing_upload_documents_display_name_idx ON public.drawing_upload_documents (lower(display_name));
CREATE INDEX IF NOT EXISTS drawing_upload_documents_drawing_number_idx ON public.drawing_upload_documents (lower(drawing_number));
ALTER TABLE public.drawing_upload_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawing_upload_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.drawing_upload_folders FROM anon;
REVOKE ALL ON TABLE public.drawing_upload_documents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.drawing_upload_folders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.drawing_upload_documents TO authenticated;
DROP POLICY IF EXISTS "drawing_upload_folders_no_anon_access" ON public.drawing_upload_folders;
DROP POLICY IF EXISTS "drawing_upload_documents_no_anon_access" ON public.drawing_upload_documents;
CREATE POLICY "drawing_upload_folders_no_anon_access" ON public.drawing_upload_folders FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "drawing_upload_documents_no_anon_access" ON public.drawing_upload_documents FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "drawing_upload_folders_admin_all" ON public.drawing_upload_folders;
DROP POLICY IF EXISTS "drawing_upload_documents_admin_all" ON public.drawing_upload_documents;
CREATE POLICY "drawing_upload_folders_admin_all" ON public.drawing_upload_folders FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
CREATE POLICY "drawing_upload_documents_admin_all" ON public.drawing_upload_documents FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('drawing-uploads', 'drawing-uploads', false, 52428800,
    ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/bmp','image/tiff','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/rtf','text/plain','application/vnd.oasis.opendocument.text','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/vnd.oasis.opendocument.spreadsheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.oasis.opendocument.presentation'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "drawing_uploads_storage_read" ON storage.objects;
DROP POLICY IF EXISTS "drawing_uploads_storage_write" ON storage.objects;
DROP POLICY IF EXISTS "drawing_uploads_storage_delete" ON storage.objects;
CREATE POLICY "drawing_uploads_storage_read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'drawing-uploads' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
CREATE POLICY "drawing_uploads_storage_write" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'drawing-uploads' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
DROP POLICY IF EXISTS "drawing_uploads_storage_update" ON storage.objects;
CREATE POLICY "drawing_uploads_storage_update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'drawing-uploads' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true))
    WITH CHECK (bucket_id = 'drawing-uploads' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
CREATE POLICY "drawing_uploads_storage_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'drawing-uploads' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true));
COMMIT;
