// src/services/billGroups.ts

import { supabase } from "./supabase";
import type {
  BillGroup,
  BillGroupPhoto,
  BillGroupInput,
} from "../types/billGroup";
import { logAudit } from "./auditLog";

const TABLE = "bill_groups";
const PHOTOS_TABLE = "bill_group_photos";

/* ──────────────────────────────────────────────
   BILL GROUP CRUD
   ────────────────────────────────────────────── */

export async function fetchBillGroups(): Promise<BillGroup[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as BillGroup[];
}

export async function fetchBillGroup(id: string): Promise<BillGroup> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as BillGroup;
}

export async function createBillGroup(
  input: BillGroupInput
): Promise<{ ok: boolean; data?: BillGroup; error?: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "group.bill.created",
    targetType: "group",
    targetId: data.id,
    detail: { name: input.name ?? null },
  });
  return { ok: true, data: data as BillGroup };
}

export async function updateBillGroup(
  id: string,
  input: Partial<BillGroupInput>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update(input).eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "group.bill.updated",
    targetType: "group",
    targetId: id,
    detail: { fields: Object.keys(input) },
  });
  return { ok: true };
}

export async function deleteBillGroup(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  // Delete photos first. If that step fails we must NOT delete the group or
  // report success — otherwise orphaned photo rows are left behind while the
  // UI claims the group is gone.
  const { error: photosError } = await supabase
    .from(PHOTOS_TABLE)
    .delete()
    .eq("bill_group_id", id);

  if (photosError) {
    return {
      ok: false,
      error: `Failed to remove group photos: ${photosError.message}`,
    };
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "group.bill.deleted", targetType: "group", targetId: id });
  return { ok: true };
}

/* ──────────────────────────────────────────────
   BILL GROUP PHOTOS
   ────────────────────────────────────────────── */

export async function fetchBillGroupPhotos(
  groupId: string
): Promise<BillGroupPhoto[]> {
  const { data, error } = await supabase
    .from(PHOTOS_TABLE)
    .select("*")
    .eq("bill_group_id", groupId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as BillGroupPhoto[];
}

export async function addBillGroupPhoto(
  groupId: string,
  photoUrl: string,
  photoPublicId: string
): Promise<{ ok: boolean; data?: BillGroupPhoto; error?: string }> {
  // Get next position (surface read failures instead of silently collapsing
  // every new photo onto position 0)
  const { data: existing, error: readError } = await supabase
    .from(PHOTOS_TABLE)
    .select("position")
    .eq("bill_group_id", groupId)
    .order("position", { ascending: false })
    .limit(1);

  if (readError) return { ok: false, error: readError.message };

  const nextPosition =
    existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const { data, error } = await supabase
    .from(PHOTOS_TABLE)
    .insert({
      bill_group_id: groupId,
      photo_url: photoUrl,
      photo_public_id: photoPublicId,
      position: nextPosition,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as BillGroupPhoto };
}

export async function removeBillGroupPhoto(
  photoId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(PHOTOS_TABLE)
    .delete()
    .eq("id", photoId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function reorderBillGroupPhotos(
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
