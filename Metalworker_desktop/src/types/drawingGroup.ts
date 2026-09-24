// src/types/drawingGroup.ts

export interface DrawingGroup {
  id: string;
  folder_id: string | null;
  name: string;
  group_date: string;
  created_at: string;
  updated_at: string;
}

export interface DrawingGroupPhoto {
  id: string;
  drawing_group_id: string;
  photo_url: string;
  photo_public_id: string;
  position: number;
  created_at: string;
}

export interface DrawingGroupInput {
  name: string;
  group_date: string;
  folder_id?: string | null;
}
