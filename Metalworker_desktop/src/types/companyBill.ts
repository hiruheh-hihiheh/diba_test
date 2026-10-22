// src/types/companyBill.ts
export interface CompanyBillFolder {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  billCount?: number;
}

export interface CompanyBillDocument {
  id: string;
  folder_id: string | null;
  display_name: string;
  original_filename: string;
  storage_path: string;
  content_type: string | null;
  byte_size: number | null;
  supplier_name: string | null;
  bill_number: string | null;
  bill_date: string | null;
  amount: number | null;
  gst_amount: number | null;
  is_paid: boolean;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export const COMPANY_BILL_MAX_BYTES = 50 * 1024 * 1024;

export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function safeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
}
