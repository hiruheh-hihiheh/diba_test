// src/services/folders.ts

import { supabase } from "../lib/supabase";
import type { AdminFolder, FolderItem, FolderItemDisplay, FolderItemType } from "../types/folder";

const TABLE = "admin_folders";
const ITEMS_TABLE = "folder_items";

export async function fetchFolders(): Promise<AdminFolder[]> {
  const { data, error } = await supabase
    .from(TABLE).select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminFolder[];
}

export async function fetchFolder(id: string): Promise<AdminFolder> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as AdminFolder;
}

export async function createFolder(name: string): Promise<{ ok: boolean; data?: AdminFolder; error?: string }> {
  const { data, error } = await supabase.from(TABLE).insert({ name }).select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as AdminFolder };
}

export async function updateFolder(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update({ name }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  await supabase.from(ITEMS_TABLE).delete().eq("folder_id", id);
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchFolderItems(folderId: string): Promise<FolderItem[]> {
  const { data, error } = await supabase
    .from(ITEMS_TABLE).select("*").eq("folder_id", folderId).order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FolderItem[];
}

export async function addFolderItem(
  folderId: string, itemType: FolderItemType, itemId: string
): Promise<{ ok: boolean; data?: FolderItem; error?: string }> {
  const { data: existing } = await supabase
    .from(ITEMS_TABLE).select("position").eq("folder_id", folderId)
    .order("position", { ascending: false }).limit(1);
  const nextPos = existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const { data, error } = await supabase.from(ITEMS_TABLE)
    .insert({ folder_id: folderId, item_type: itemType, item_id: itemId, position: nextPos })
    .select().single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as FolderItem };
}

export async function removeFolderItem(itemId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(ITEMS_TABLE).delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Resolve display labels for folder items by batch-fetching from their source tables.
 * This avoids N+1 queries by grouping items by type and fetching each group in one query.
 */
export async function resolveFolderItemLabels(items: FolderItem[]): Promise<FolderItemDisplay[]> {
  if (items.length === 0) return [];

  // Group item IDs by type
  const groups = new Map<FolderItemType, string[]>();
  for (const item of items) {
    if (!groups.has(item.item_type)) groups.set(item.item_type, []);
    groups.get(item.item_type)!.push(item.item_id);
  }

  // Fetch labels in parallel
  const labelMap = new Map<string, string>();

  const fetches: Promise<void>[] = [];

  if (groups.has("owner_stock")) {
    fetches.push(
      supabase.from("owner_stock").select("id, source_of_metal, folder_no").in("id", groups.get("owner_stock")!)
        .then(({ data }) => { data?.forEach((r: { id: string; source_of_metal: string | null; folder_no: string | null }) => labelMap.set(r.id, r.source_of_metal || r.folder_no || "Owner Stock")); })
    );
  }
  if (groups.has("company_stock")) {
    fetches.push(
      supabase.from("company_stock").select("id, company_name, product_name").in("id", groups.get("company_stock")!)
        .then(({ data }) => { data?.forEach((r: { id: string; company_name: string | null; product_name: string | null }) => labelMap.set(r.id, r.company_name || r.product_name || "Company Stock")); })
    );
  }
  if (groups.has("bill_group")) {
    fetches.push(
      supabase.from("bill_groups").select("id, name").in("id", groups.get("bill_group")!)
        .then(({ data }) => { data?.forEach((r: { id: string; name: string }) => labelMap.set(r.id, r.name)); })
    );
  }
  if (groups.has("drawing_group")) {
    fetches.push(
      supabase.from("drawing_groups").select("id, name").in("id", groups.get("drawing_group")!)
        .then(({ data }) => { data?.forEach((r: { id: string; name: string }) => labelMap.set(r.id, r.name)); })
    );
  }

  await Promise.all(fetches);

  return items.map((item) => ({
    ...item,
    label: labelMap.get(item.item_id) || `${item.item_type} (${item.item_id.slice(0, 8)})`,
  }));
}
