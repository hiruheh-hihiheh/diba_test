// src/services/ownerStock.ts

import { supabase } from "../lib/supabase";
import { logAudit } from "./auditLog";
import { destroyCloudinaryAsset } from "./cloudinaryCleanup";
import type { OwnerStock, OwnerStockInput } from "../types/ownerStock";

const TABLE = "owner_stock";

export async function fetchOwnerStocks(): Promise<OwnerStock[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as OwnerStock[];
}

export async function fetchOwnerStock(id: string): Promise<OwnerStock> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as OwnerStock;
}

export async function createOwnerStock(
  input: OwnerStockInput
): Promise<{ ok: boolean; data?: OwnerStock; error?: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "stock.owner.created",
    targetType: "stock",
    targetId: data.id,
    detail: { folder_no: input.folder_no ?? null, source: input.source_of_metal ?? null },
  });
  return { ok: true, data: data as OwnerStock };
}

export async function updateOwnerStock(
  id: string,
  input: Partial<OwnerStockInput>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update(input).eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "stock.owner.updated",
    targetType: "stock",
    targetId: id,
    detail: { fields: Object.keys(input) },
  });
  return { ok: true };
}

export async function deleteOwnerStock(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  // Read the asset ids before the row disappears.
  const { data: existing, error: readError } = await supabase
    .from(TABLE)
    .select("drawing_photo_public_id, metal_photo_public_id")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };

  // Remove folder associations first. Without this, folders keep a
  // folder_items row pointing at a record that no longer exists, and the folder
  // screens show a dangling entry that cannot be resolved or previewed.
  const { error: linksError } = await supabase
    .from("folder_items")
    .delete()
    .eq("item_type", "owner_stock")
    .eq("item_id", id);

  if (linksError) {
    return { ok: false, error: `Failed to remove folder links: ${linksError.message}` };
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) return { ok: false, error: error.message };

  // Destroy the uploads only once no row references them; best-effort and
  // server-side, so it can never fail the delete.
  void destroyCloudinaryAsset(existing?.drawing_photo_public_id, "owner stock drawing");
  void destroyCloudinaryAsset(existing?.metal_photo_public_id, "owner stock metal");

  void logAudit({ action: "stock.owner.deleted", targetType: "stock", targetId: id });
  return { ok: true };
}
