// src/types/billGroup.ts

export interface BillGroup {
  id: string;
  folder_id: string | null;
  name: string;
  group_date: string;
  created_at: string;
  updated_at: string;
}

export interface BillGroupPhoto {
  id: string;
  bill_group_id: string;
  photo_url: string;
  photo_public_id: string;
  position: number;
  created_at: string;
}

export interface BillGroupInput {
  name: string;
  group_date: string;
  folder_id?: string | null;
}
