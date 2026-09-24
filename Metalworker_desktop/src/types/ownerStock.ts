// src/types/ownerStock.ts

export interface OwnerStock {
  id: string;
  source_of_metal: string | null;
  folder_no: string | null;
  folio_number: string | null;
  metal_type: string | null;
  tn_no: string | null;
  paint: string | null;
  drawing_photo_url: string | null;
  drawing_photo_public_id: string | null;
  recorded_time: string | null;
  metal_photo_url: string | null;
  metal_photo_public_id: string | null;
  amount_purchase: number | null;
  processing_start: string | null;
  processing_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface OwnerStockInput {
  source_of_metal?: string;
  folder_no?: string;
  folio_number?: string;
  metal_type?: string;
  tn_no?: string;
  paint?: string;
  drawing_photo_url?: string;
  drawing_photo_public_id?: string;
  recorded_time?: string;
  metal_photo_url?: string;
  metal_photo_public_id?: string;
  amount_purchase?: number;
  processing_start?: string;
  processing_end?: string;
}
