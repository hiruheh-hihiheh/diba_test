// src/services/drawingGroups.ts

import { supabase } from "./supabase";
import type {
  DrawingGroup,
  DrawingGroupPhoto,
  DrawingGroupInput,
} from "../types/drawingGroup";

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
  return { ok: true, data: data as DrawingGroup };
}

export async function updateDrawingGroup(
  id: string,
  input: Partial<DrawingGroupInput>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update(input).eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteDrawingGroup(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  // Delete photos first
  await supabase.from(PHOTOS_TABLE).delete().eq("drawing_group_id", id);

  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) return { ok: false, error: error.message };
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
  // Get next position
  const { data: existing } = await supabase
    .from(PHOTOS_TABLE)
    .select("position")
    .eq("drawing_group_id", groupId)
    .order("position", { ascending: false })
    .limit(1);

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
  const { error } = await supabase
    .from(PHOTOS_TABLE)
    .delete()
    .eq("id", photoId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function reorderDrawingGroupPhotos(
  photos: { id: string; position: number }[]
): Promise<{ ok: boolean; error?: string }> {
  for (const photo of photos) {
    const { error } = await supabase
      .from(PHOTOS_TABLE)
      .update({ position: photo.position })
      .eq("id", photo.id);

    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
