// src/services/billGroups.ts

import { supabase } from "../lib/supabase";
import type { BillGroup, BillGroupPhoto, BillGroupInput } from "../types/billGroup";

const TABLE = "bill_groups";
const PHOTOS_TABLE = "bill_group_photos";

export async function fetchBillGroups(): Promise<BillGroup[]> {
  const { data, error } = await supabase
    .from(TABLE).select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillGroup[];
}

export async function fetchBillGroup(id: string): Promise<BillGroup> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as BillGroup;
}

export async function createBillGroup(input: BillGroupInput): Promise<{ ok: boolean; data?: BillGroup; error?: string }> {
  const { data, error } = await supabase.from(TABLE).insert(input).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as BillGroup };
}

export async function updateBillGroup(id: string, input: Partial<BillGroupInput>): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update(input).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteBillGroup(id: string): Promise<{ ok: boolean; error?: string }> {
  await supabase.from(PHOTOS_TABLE).delete().eq("bill_group_id", id);
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchBillGroupPhotos(groupId: string): Promise<BillGroupPhoto[]> {
  const { data, error } = await supabase
    .from(PHOTOS_TABLE).select("*").eq("bill_group_id", groupId).order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillGroupPhoto[];
}

export async function addBillGroupPhoto(groupId: string, photoUrl: string, photoPublicId: string): Promise<{ ok: boolean; data?: BillGroupPhoto; error?: string }> {
  const { data: existing } = await supabase.from(PHOTOS_TABLE).select("position").eq("bill_group_id", groupId).order("position", { ascending: false }).limit(1);
  const nextPosition = existing && existing.length > 0 ? existing[0].position + 1 : 0;
  const { data, error } = await supabase.from(PHOTOS_TABLE).insert({ bill_group_id: groupId, photo_url: photoUrl, photo_public_id: photoPublicId, position: nextPosition }).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as BillGroupPhoto };
}

export async function removeBillGroupPhoto(photoId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(PHOTOS_TABLE).delete().eq("id", photoId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
