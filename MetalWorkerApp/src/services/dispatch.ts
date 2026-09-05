import { supabase } from "./supabase";

export type MaterialType = "scrap" | "ferrous" | "non_ferrous" | "other";

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

    // Fetch worker username to denormalize into the dispatch record
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
      // status, submitted_at, and created_at rely on database defaults
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