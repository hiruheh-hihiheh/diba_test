// src/services/drawingGroups.ts

import { supabase } from "./supabase";
import type {
  DrawingGroup,
  DrawingGroupPhoto,
  DrawingGroupInput,
} from "../types/drawingGroup";
import { logAudit } from "./auditLog";
import { destroyCloudinaryAsset } from "./cloudinary";

const TABLE = "drawing_groups";
const PHOTOS_TABLE = "drawing_group_photos";

/* ──────────────────────────────────────────────
   DRAWING GROUP CRUD
   ────────────────────────────────────────────── */

export async function fetchDrawingGroups(): Promise<DrawingGroup[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as DrawingGroup[];
}

export async function fetchDrawingGroup(id: string): Promise<DrawingGroup> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as DrawingGroup;
}

export async function createDrawingGroup(
  input: DrawingGroupInput
): Promise<{ ok: boolean; data?: DrawingGroup; error?: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "group.drawing.created",
    targetType: "group",
    targetId: data.id,
    detail: { name: input.name ?? null },
  });
  return { ok: true, data: data as DrawingGroup };
}

export async function updateDrawingGroup(
  id: string,
  input: Partial<DrawingGroupInput>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update(input).eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "group.drawing.updated",
    targetType: "group",
    targetId: id,
    detail: { fields: Object.keys(input) },
  });
  return { ok: true };
}

export async function deleteDrawingGroup(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  // Collect the Cloudinary asset ids BEFORE the rows go away, otherwise the
  // uploads are orphaned in Cloudinary with no way to find them again.
  const { data: photos, error: readError } = await supabase
    .from(PHOTOS_TABLE)
    .select("photo_public_id")
    .eq("drawing_group_id", id);

  if (readError) {
    return { ok: false, error: `Failed to read group photos: ${readError.message}` };
  }

  // Delete photos first. If that step fails we must NOT delete the group or
  // report success — otherwise orphaned photo rows are left behind while the
  // UI claims the group is gone.
  const { error: photosError } = await supabase
    .from(PHOTOS_TABLE)
    .delete()
    .eq("drawing_group_id", id);

  if (photosError) {
    return {
      ok: false,
      error: `Failed to remove group photos: ${photosError.message}`,
    };
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) return { ok: false, error: error.message };

  // Assets are destroyed only after nothing references them, and only in a
  // best-effort server-side call that can never fail the delete.
  for (const p of photos ?? []) {
    void destroyCloudinaryAsset(p.photo_public_id, "drawing group photo");
  }

  void logAudit({ action: "group.drawing.deleted", targetType: "group", targetId: id });
  return { ok: true };
}

/* ──────────────────────────────────────────────
   DRAWING GROUP PHOTOS
   ────────────────────────────────────────────── */

export async function fetchDrawingGroupPhotos(
  groupId: string
): Promise<DrawingGroupPhoto[]> {
  const { data, error } = await supabase
    .from(PHOTOS_TABLE)
    .select("*")
    .eq("drawing_group_id", groupId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as DrawingGroupPhoto[];
}

export async function addDrawingGroupPhoto(
  groupId: string,
  photoUrl: string,
  photoPublicId: string
): Promise<{ ok: boolean; data?: DrawingGroupPhoto; error?: string }> {
  // Get next position (surface read failures instead of silently collapsing
  // every new photo onto position 0)
  const { data: existing, error: readError } = await supabase
    .from(PHOTOS_TABLE)
    .select("position")
    .eq("drawing_group_id", groupId)
    .order("position", { ascending: false })
    .limit(1);

  if (readError) return { ok: false, error: readError.message };

  const nextPosition =
    existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const { data, error } = await supabase
    .from(PHOTOS_TABLE)
    .insert({
      drawing_group_id: groupId,
      photo_url: photoUrl,
      photo_public_id: photoPublicId,
      position: nextPosition,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as DrawingGroupPhoto };
}

export async function removeDrawingGroupPhoto(
  photoId: string
): Promise<{ ok: boolean; error?: string }> {
  // Read the asset id before the row is removed so the Cloudinary upload can
  // be destroyed instead of being orphaned.
  const { data: existing, error: readError } = await supabase
    .from(PHOTOS_TABLE)
    .select("photo_public_id")
    .eq("id", photoId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };

  const { error } = await supabase
    .from(PHOTOS_TABLE)
    .delete()
    .eq("id", photoId);

  if (error) return { ok: false, error: error.message };

  void destroyCloudinaryAsset(existing?.photo_public_id, "drawing group photo");
  return { ok: true };
}

export async function reorderDrawingGroupPhotos(
  photos: { id: string; position: number }[]
): Promise<{ ok: boolean; error?: string }> {
  // Sequential updates (a position write affects the whole order, so parallel
  // writes race). If later writes fail, earlier ones are already persisted —
  // report that partial state explicitly instead of a bare failure.
  let failed = 0;
  let firstError: string | null = null;

  for (const photo of photos) {
    const { error } = await supabase
      .from(PHOTOS_TABLE)
      .update({ position: photo.position })
      .eq("id", photo.id);

    if (error) {
      failed++;
      if (!firstError) firstError = error.message;
    }
  }

  if (failed > 0) {
    return {
      ok: false,
      error:
        `${failed} of ${photos.length} photo positions failed to save` +
        (firstError ? ` (${firstError})` : ""),
    };
  }
  return { ok: true };
}
