// src/types/dispatch.ts

export type DispatchStatus = "submitted" | "reviewed" | "approved" | "rejected";

/** Categories a worker can choose for a new dispatch. */
export type MaterialCategory = "metal" | "non_metal" | "other";

/** Values stored by dispatches created before the category change. */
export type LegacyMaterialType = "scrap" | "ferrous" | "non_ferrous";

/** Any value `dispatches.material_type` may hold, new or historical. */
export type MaterialType = MaterialCategory | LegacyMaterialType;

export interface Dispatch {
  id: string;
  worker_id: string | null;
  worker_username: string;
  vehicle_number: string;
  material_type: MaterialType;
  /** Free-text description saved when `material_type` is "other". */
  custom_material: string | null;
  photo_url: string;
  photo_public_id: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  submitted_at: string;
  status: DispatchStatus;
  created_at: string;
}

export interface UpdateDispatchInput {
  vehicle_number?: string;
  material_type?: MaterialType;
  /** Trimmed description for Other; null for every other category. */
  custom_material?: string | null;
  photo_url?: string;
  photo_public_id?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  location_name?: string | null;
  status?: DispatchStatus;
}
