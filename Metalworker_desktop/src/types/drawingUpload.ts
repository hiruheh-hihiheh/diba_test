export interface DrawingUploadFolder {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  documentCount?: number;
}

export interface DrawingUploadDocument {
  id: string;
  folder_id: string | null;
  display_name: string;
  original_filename: string;
  storage_path: string;
  content_type: string | null;
  byte_size: number | null;
  drawing_number: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export const DRAWING_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
