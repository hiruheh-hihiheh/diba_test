import { supabase } from "./supabase";
import type { TranslationDictionary } from "../constants/translations";

export type MaterialType = "scrap" | "ferrous" | "non_ferrous" | "other";
export type DispatchStatus = "submitted" | "reviewed" | "approved" | "rejected";

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

export interface CreateDispatchInput {
  vehicleNumber: string;
  materialType: MaterialType;
  photoUrl: string;
  photoPublicId: string;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
}

export async function createDispatch(
  input: CreateDispatchInput
): Promise<{ ok: boolean; error?: string }> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { ok: false, error: "Not authenticated" };
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return { ok: false, error: "Could not fetch worker profile" };
    }

    const { error: insertError } = await supabase.from("dispatches").insert({
      worker_id: user.id,
      worker_username: profile.username,
      vehicle_number: input.vehicleNumber,
      material_type: input.materialType,
      photo_url: input.photoUrl,
      photo_public_id: input.photoPublicId,
      latitude: input.latitude,
      longitude: input.longitude,
      location_name: input.locationName,
    });

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return { ok: false, error: "Could not save dispatch" };
    }

    return { ok: true };
  } catch (err) {
    console.error("Unexpected dispatch error:", err);
    return { ok: false, error: "An unexpected error occurred" };
  }
}

export async function fetchMyRecentDispatches(
  limit = 5
): Promise<{ ok: boolean; data?: Dispatch[]; error?: string }> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { ok: false, error: "Not authenticated" };
    }

    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("worker_id", user.id)
      .order("submitted_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data: data as Dispatch[] };
  } catch (err) {
    return { ok: false, error: "Unexpected error" };
  }
}

export function getMaterialLabelKey(type: MaterialType): keyof TranslationDictionary {
  switch (type) {
    case "scrap": return "scrap_metal";
    case "ferrous": return "ferrous_metal";
    case "non_ferrous": return "non_ferrous_metal";
    case "other": return "other";
    default: return "other";
  }
}

export function getStatusLabelKey(status: DispatchStatus): keyof TranslationDictionary {
  switch (status) {
    case "submitted": return "status_submitted";
    case "reviewed": return "status_reviewed";
    case "approved": return "status_approved";
    case "rejected": return "status_rejected";
    default: return "status_submitted";
  }
}

export function getStatusColor(status: DispatchStatus): string {
  switch (status) {
    case "submitted": return "#F59E0B"; // amber
    case "reviewed": return "#3B82F6"; // blue
    case "approved": return "#10B981"; // green
    case "rejected": return "#EF4444"; // red
    default: return "#6B7280"; // gray
  }
}