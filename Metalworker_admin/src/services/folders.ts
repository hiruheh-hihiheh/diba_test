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

/**
 * Batch-update positions for folder items.
 * Uses Promise.all instead of sequential updates (performance fix).
 */
export async function reorderFolderItems(
  items: { id: string; position: number }[]
): Promise<{ ok: boolean; error?: string }> {
  const results = await Promise.all(
    items.map((item) =>
      supabase
        .from("folder_items")
        .update({ position: item.position })
        .eq("id", item.id)
    )
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  return { ok: true };
}

/* ──────────────────────────────────────────────
   LABEL HELPERS
   ────────────────────────────────────────────── */

/** Build a display label for an owner_stock record */
function buildOwnerStockLabel(data: {
  folder_no?: string | null;
  folio_number?: string | null;
  source_of_metal?: string | null;
  id?: string;
}, fallbackId: string): string {
  let label = `Owner Stock ${data.folder_no || ""}${data.folio_number ? " - " + data.folio_number : ""}`.trim();
  if (label === "Owner Stock") {
    label = `Owner Stock (${data.source_of_metal || fallbackId.slice(0, 8)})`;
  }
  return label;
}

/** Build a display label for a company_stock record */
function buildCompanyStockLabel(data: {
  folder_no?: string | null;
  company_name?: string | null;
  product_name?: string | null;
  id?: string;
}, fallbackId: string): string {
  let label = `Company Stock ${data.folder_no || ""}${data.company_name ? " - " + data.company_name : ""}`.trim();
  if (label === "Company Stock") {
    label = `Company Stock (${data.product_name || fallbackId.slice(0, 8)})`;
  }
  return label;
}

/* ──────────────────────────────────────────────
   BATCHED LABEL RESOLUTION  (fixes N+1 queries)
   ────────────────────────────────────────────── */

/**
 * Resolve display labels for folder items using batched queries.
 *
 * Instead of one query per item (N+1), this groups items by type and
 * performs at most 4 parallel queries using `.in("id", [...])`.
 */
export async function resolveFolderItemLabels(
  items: FolderItem[]
): Promise<FolderItemDisplay[]> {
  if (items.length === 0) return [];

  // Group item IDs by type
  const ownerIds = items.filter((i) => i.item_type === "owner_stock").map((i) => i.item_id);
  const companyIds = items.filter((i) => i.item_type === "company_stock").map((i) => i.item_id);
  const billIds = items.filter((i) => i.item_type === "bill_group").map((i) => i.item_id);
  const drawingIds = items.filter((i) => i.item_type === "drawing_group").map((i) => i.item_id);

  // Batch fetch all types in parallel (max 4 queries)
  const [ownerData, companyData, billData, drawingData] = await Promise.all([
    ownerIds.length > 0
      ? supabase
          .from("owner_stock")
          .select("id, folder_no, folio_number, source_of_metal")
          .in("id", ownerIds)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as any[]),
    companyIds.length > 0
      ? supabase
          .from("company_stock")
          .select("id, folder_no, company_name, product_name")
          .in("id", companyIds)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as any[]),
    billIds.length > 0
      ? supabase
          .from("bill_groups")
          .select("id, name, group_date")
          .in("id", billIds)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as any[]),
    drawingIds.length > 0
      ? supabase
          .from("drawing_groups")
          .select("id, name, group_date")
          .in("id", drawingIds)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as any[]),
  ]);

  // Build lookup maps
  const ownerMap = new Map(ownerData.map((d: any) => [d.id, d]));
  const companyMap = new Map(companyData.map((d: any) => [d.id, d]));
  const billMap = new Map(billData.map((d: any) => [d.id, d]));
  const drawingMap = new Map(drawingData.map((d: any) => [d.id, d]));

  return items.map((item) => {
    let label = `${item.item_type} (${item.item_id.slice(0, 8)})`;

    if (item.item_type === "owner_stock") {
      const data = ownerMap.get(item.item_id);
      if (data) label = buildOwnerStockLabel(data, item.item_id);
    } else if (item.item_type === "company_stock") {
      const data = companyMap.get(item.item_id);
      if (data) label = buildCompanyStockLabel(data, item.item_id);
    } else if (item.item_type === "bill_group") {
      const data = billMap.get(item.item_id);
      if (data) label = `Bill Group - ${data.name}`;
    } else if (item.item_type === "drawing_group") {
      const data = drawingMap.get(item.item_id);
      if (data) label = `Drawing Group - ${data.name}`;
    }

    return { ...item, label };
  });
}

/* ──────────────────────────────────────────────
   AVAILABLE ITEMS  (for a specific folder)
   ────────────────────────────────────────────── */

/**
 * Fetch all items available for adding to a folder (items not already in this folder).
 * Queries all 4 item types in parallel for performance.
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

  // Fetch all item types in parallel
  const [ownerRes, companyRes, billRes, drawingRes] = await Promise.all([
    supabase
      .from("owner_stock")
      .select("id, folder_no, folio_number, source_of_metal")
      .order("created_at", { ascending: false }),
    supabase
      .from("company_stock")
      .select("id, folder_no, company_name, product_name")
      .order("created_at", { ascending: false }),
    supabase
      .from("bill_groups")
      .select("id, name")
      .order("created_at", { ascending: false }),
    supabase
      .from("drawing_groups")
      .select("id, name")
      .order("created_at", { ascending: false }),
  ]);

  const available: { type: FolderItemType; id: string; label: string }[] = [];

  for (const s of ownerRes.data ?? []) {
    if (!existingIds.has(s.id)) {
      available.push({
        type: "owner_stock",
        id: s.id,
        label: buildOwnerStockLabel(s, s.id),
      });
    }
  }

  for (const s of companyRes.data ?? []) {
    if (!existingIds.has(s.id)) {
      available.push({
        type: "company_stock",
        id: s.id,
        label: buildCompanyStockLabel(s, s.id),
      });
    }
  }

  for (const g of billRes.data ?? []) {
    if (!existingIds.has(g.id)) {
      available.push({ type: "bill_group", id: g.id, label: `Bill Group - ${g.name}` });
    }
  }

  for (const g of drawingRes.data ?? []) {
    if (!existingIds.has(g.id)) {
      available.push({ type: "drawing_group", id: g.id, label: `Drawing Group - ${g.name}` });
    }
  }

  return available;
}

/* ──────────────────────────────────────────────
   ALL ITEMS  (for the folders overview page)
   ────────────────────────────────────────────── */

/**
 * Fetch every item across all types (no folder filtering).
 * Used on the folders overview page where items can be dragged into any folder.
 */
export async function fetchAllItems(): Promise<
  { type: FolderItemType; id: string; label: string }[]
> {
  const [ownerRes, companyRes, billRes, drawingRes] = await Promise.all([
    supabase
      .from("owner_stock")
      .select("id, folder_no, folio_number, source_of_metal")
      .order("created_at", { ascending: false }),
    supabase
      .from("company_stock")
      .select("id, folder_no, company_name, product_name")
      .order("created_at", { ascending: false }),
    supabase
      .from("bill_groups")
      .select("id, name")
      .order("created_at", { ascending: false }),
    supabase
      .from("drawing_groups")
      .select("id, name")
      .order("created_at", { ascending: false }),
  ]);

  const items: { type: FolderItemType; id: string; label: string }[] = [];

  for (const s of ownerRes.data ?? []) {
    items.push({
      type: "owner_stock",
      id: s.id,
      label: buildOwnerStockLabel(s, s.id),
    });
  }

  for (const s of companyRes.data ?? []) {
    items.push({
      type: "company_stock",
      id: s.id,
      label: buildCompanyStockLabel(s, s.id),
    });
  }

  for (const g of billRes.data ?? []) {
    items.push({ type: "bill_group", id: g.id, label: `Bill Group - ${g.name}` });
  }

  for (const g of drawingRes.data ?? []) {
    items.push({ type: "drawing_group", id: g.id, label: `Drawing Group - ${g.name}` });
  }

  return items;
}
