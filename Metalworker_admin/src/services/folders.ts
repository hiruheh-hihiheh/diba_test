// src/services/folders.ts

import { supabase } from "./supabase";
import type {
  AdminFolder,
  FolderItem,
  FolderItemType,
  FolderItemDisplay,
} from "../types/folder";

/* ──────────────────────────────────────────────
   FOLDER CRUD
   ────────────────────────────────────────────── */

export async function fetchFolders(): Promise<AdminFolder[]> {
  const { data, error } = await supabase
    .from("admin_folders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as AdminFolder[];
}

export async function createFolder(
  name: string
): Promise<{ ok: boolean; data?: AdminFolder; error?: string }> {
  const { data, error } = await supabase
    .from("admin_folders")
    .insert({ name })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as AdminFolder };
}

export async function renameFolder(
  id: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("admin_folders")
    .update({ name })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteFolder(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  // Delete folder items first
  await supabase.from("folder_items").delete().eq("folder_id", id);

  const { error } = await supabase
    .from("admin_folders")
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ──────────────────────────────────────────────
   FOLDER ITEMS
   ────────────────────────────────────────────── */

export async function fetchFolderItems(
  folderId: string
): Promise<FolderItem[]> {
  const { data, error } = await supabase
    .from("folder_items")
    .select("*")
    .eq("folder_id", folderId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as FolderItem[];
}

export async function addItemToFolder(
  folderId: string,
  itemType: FolderItemType,
  itemId: string
): Promise<{ ok: boolean; error?: string }> {
  // Get the next position
  const { data: existing } = await supabase
    .from("folder_items")
    .select("position")
    .eq("folder_id", folderId)
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition =
    existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const { error } = await supabase.from("folder_items").insert({
    folder_id: folderId,
    item_type: itemType,
    item_id: itemId,
    position: nextPosition,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removeItemFromFolder(
  folderItemId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("folder_items")
    .delete()
    .eq("id", folderItemId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function reorderFolderItems(
  items: { id: string; position: number }[]
): Promise<{ ok: boolean; error?: string }> {
  for (const item of items) {
    const { error } = await supabase
      .from("folder_items")
      .update({ position: item.position })
      .eq("id", item.id);

    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Resolve display labels for folder items by looking up the referenced records.
 */
export async function resolveFolderItemLabels(
  items: FolderItem[]
): Promise<FolderItemDisplay[]> {
  const result: FolderItemDisplay[] = [];

  for (const item of items) {
    let label = `${item.item_type} (${item.item_id.slice(0, 8)})`;

    try {
      if (item.item_type === "owner_stock") {
        const { data } = await supabase
          .from("owner_stock")
          .select("folder_no, folio_number, source_of_metal")
          .eq("id", item.item_id)
          .single();
        if (data) {
          label = `Owner Stock ${data.folder_no || ""}${data.folio_number ? " - " + data.folio_number : ""}`.trim();
          if (label === "Owner Stock") label = `Owner Stock (${data.source_of_metal || item.item_id.slice(0, 8)})`;
        }
      } else if (item.item_type === "company_stock") {
        const { data } = await supabase
          .from("company_stock")
          .select("folder_no, company_name, product_name")
          .eq("id", item.item_id)
          .single();
        if (data) {
          label = `Company Stock ${data.folder_no || ""}${data.company_name ? " - " + data.company_name : ""}`.trim();
          if (label === "Company Stock") label = `Company Stock (${data.product_name || item.item_id.slice(0, 8)})`;
        }
      } else if (item.item_type === "bill_group") {
        const { data } = await supabase
          .from("bill_groups")
          .select("name, group_date")
          .eq("id", item.item_id)
          .single();
        if (data) {
          label = `Bill Group - ${data.name}`;
        }
      } else if (item.item_type === "drawing_group") {
        const { data } = await supabase
          .from("drawing_groups")
          .select("name, group_date")
          .eq("id", item.item_id)
          .single();
        if (data) {
          label = `Drawing Group - ${data.name}`;
        }
      }
    } catch {
      // Use fallback label
    }

    result.push({ ...item, label });
  }

  return result;
}

/**
 * Fetch all items available for adding to a folder (items not already in this folder).
 */
export async function fetchAvailableItems(
  folderId: string
): Promise<{ type: FolderItemType; id: string; label: string }[]> {
  // Get items already in the folder
  const { data: existing } = await supabase
    .from("folder_items")
    .select("item_id")
    .eq("folder_id", folderId);

  const existingIds = new Set((existing ?? []).map((e) => e.item_id));

  const available: { type: FolderItemType; id: string; label: string }[] = [];

  // Owner stocks
  const { data: ownerStocks } = await supabase
    .from("owner_stock")
    .select("id, folder_no, folio_number, source_of_metal")
    .order("created_at", { ascending: false });

  for (const s of ownerStocks ?? []) {
    if (!existingIds.has(s.id)) {
      const label = `Owner Stock ${s.folder_no || ""}${s.folio_number ? " - " + s.folio_number : ""}`.trim() || `Owner Stock (${s.source_of_metal || s.id.slice(0, 8)})`;
      available.push({ type: "owner_stock", id: s.id, label });
    }
  }

  // Company stocks
  const { data: companyStocks } = await supabase
    .from("company_stock")
    .select("id, folder_no, company_name, product_name")
    .order("created_at", { ascending: false });

  for (const s of companyStocks ?? []) {
    if (!existingIds.has(s.id)) {
      const label = `Company Stock ${s.folder_no || ""}${s.company_name ? " - " + s.company_name : ""}`.trim() || `Company Stock (${s.product_name || s.id.slice(0, 8)})`;
      available.push({ type: "company_stock", id: s.id, label });
    }
  }

  // Bill groups
  const { data: billGroups } = await supabase
    .from("bill_groups")
    .select("id, name")
    .order("created_at", { ascending: false });

  for (const g of billGroups ?? []) {
    if (!existingIds.has(g.id)) {
      available.push({ type: "bill_group", id: g.id, label: `Bill Group - ${g.name}` });
    }
  }

  // Drawing groups
  const { data: drawingGroups } = await supabase
    .from("drawing_groups")
    .select("id, name")
    .order("created_at", { ascending: false });

  for (const g of drawingGroups ?? []) {
    if (!existingIds.has(g.id)) {
      available.push({ type: "drawing_group", id: g.id, label: `Drawing Group - ${g.name}` });
    }
  }

  return available;
}
