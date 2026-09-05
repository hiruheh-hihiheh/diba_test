export type DispatchStatus = "submitted" | "reviewed" | "approved" | "rejected";
export type MaterialType = "scrap" | "ferrous" | "non_ferrous" | "other";

export interface Dispatch {
  id: string;
  worker_id: string | null;
  worker_username: string;
  vehicle_number: string;
  material_type: MaterialType;
  photo_url: string;
  photo_public_id: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  submitted_at: string;
  status: DispatchStatus;
  created_at: string;
}