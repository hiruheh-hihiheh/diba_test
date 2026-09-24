// src/types/companyStock.ts

export interface CompanyStock {
  id: string;
  metal_type: string | null;
  folder_no: string | null;
  folio_number: string | null;
  drawing_photo_url: string | null;
  drawing_photo_public_id: string | null;
  recorded_time: string | null;
  processed_metal_type: string | null;
  metal_photo_url: string | null;
  metal_photo_public_id: string | null;
  company_name: string | null;
  product_name: string | null;
  processing_start: string | null;
  processing_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyStockInput {
  metal_type?: string;
  folder_no?: string;
  folio_number?: string;
  drawing_photo_url?: string;
  drawing_photo_public_id?: string;
  recorded_time?: string;
  processed_metal_type?: string;
  metal_photo_url?: string;
  metal_photo_public_id?: string;
  company_name?: string;
  product_name?: string;
  processing_start?: string;
  processing_end?: string;
}
