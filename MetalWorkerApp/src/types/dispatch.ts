/**
 * Material categories a worker can choose for a NEW dispatch.
 *
 * "Metal" and "Non-metal" replace the old Ferrous / Non-ferrous pair, and
 * "Other" additionally requires a free-text description.
 */
export type MaterialCategory = "metal" | "non_metal" | "other";

/**
 * Values stored by dispatches created before the category change.
 *
 * They are deliberately kept readable so historical records never get
 * re-labelled or silently reclassified. New dispatches cannot produce them.
 */
export type LegacyMaterialType = "scrap" | "ferrous" | "non_ferrous";

/** Any value `dispatches.material_type` may hold, new or historical. */
export type MaterialType = MaterialCategory | LegacyMaterialType;

export type DispatchStatus = "submitted" | "reviewed" | "approved" | "rejected";

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

export interface CreateDispatchInput {
  vehicleNumber: string;
  materialType: MaterialCategory;
  /** Trimmed description for "Other"; always null for Metal / Non-metal. */
  customMaterial: string | null;
  photoUrl: string;
  photoPublicId: string;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
}
