// src/services/folders.ts

import { supabase } from "./supabase";
import type {
  AdminFolder,
  FolderItem,
  FolderItemType,
  FolderItemDisplay,
} from "../types/folder";
import { logAudit } from "./auditLog";

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
  void logAudit({
    action: "folder.created",
    targetType: "folder",
    targetId: data.id,
    detail: { name },
  });
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
  void logAudit({
    action: "folder.renamed",
    targetType: "folder",
    targetId: id,
    detail: { to: name },
  });
  return { ok: true };
}

export async function deleteFolder(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  // Delete folder items first; surface the error instead of silently
  // proceeding and leaving orphaned folder_items rows behind.
  const { error: itemsError } = await supabase
    .from("folder_items")
    .delete()
    .eq("folder_id", id);

  if (itemsError) return { ok: false, error: itemsError.message };

  const { error } = await supabase
    .from("admin_folders")
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({ action: "folder.deleted", targetType: "folder", targetId: id });
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
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as FolderItem[];
}

/**
 * Pre-check which of the given (type, id) pairs are already present in the
 * folder. This mirrors the `(folder_id, item_type, item_id)` uniqueness of the
 * DB index (see supabase/migrations) so the app stays correct even before the
 * migration is applied and turns raw Postgres violations into clear messages.
 */
async function findDuplicateFolderItems(
  folderId: string,
  items: { type: FolderItemType; id: string }[]
): Promise<{
  duplicates: { type: FolderItemType; id: string }[];
  error: string | null;
}> {
  if (items.length === 0) return { duplicates: [], error: null };

  const { data, error } = await supabase
    .from("folder_items")
    .select("item_type, item_id")
    .eq("folder_id", folderId)
    .in("item_id", items.map((i) => i.id));

  if (error) return { duplicates: [], error: error.message };

  const present = new Set(
    ((data ?? []) as { item_type: string; item_id: string }[]).map(
      (r) => `${r.item_type}:${r.item_id}`
    )
  );

  const duplicates = items.filter((i) => present.has(`${i.type}:${i.id}`));
  return { duplicates, error: null };
}

export async function addItemToFolder(
  folderId: string,
  itemType: FolderItemType,
  itemId: string
): Promise<{ ok: boolean; error?: string }> {
  // Reject duplicates up-front instead of relying on a string-matched
  // Postgres error (which only exists once the DB unique index is applied).
  const dup = await findDuplicateFolderItems(folderId, [
    { type: itemType, id: itemId },
  ]);
  if (dup.error) return { ok: false, error: dup.error };
  if (dup.duplicates.length > 0) {
    return { ok: false, error: "This item is already in this folder." };
  }

  // Get the next position (surface read failures instead of silently
  // collapsing every new item onto position 0).
  const { data: existing, error: readError } = await supabase
    .from("folder_items")
    .select("position")
    .eq("folder_id", folderId)
    .order("position", { ascending: false })
    .limit(1);

  if (readError) return { ok: false, error: readError.message };

  const nextPosition =
    existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const { error } = await supabase.from("folder_items").insert({
    folder_id: folderId,
    item_type: itemType,
    item_id: itemId,
    position: nextPosition,
  });

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "folder.item_added",
    targetType: "folder_item",
    targetId: itemId,
    detail: { folder_id: folderId, item_type: itemType },
  });
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
  void logAudit({
    action: "folder.item_removed",
    targetType: "folder_item",
    targetId: folderItemId,
  });
  return { ok: true };
}

export async function addMultipleItemsToFolder(
  folderId: string,
  items: { type: FolderItemType; id: string }[]
): Promise<{ ok: boolean; error?: string }> {
  if (items.length === 0) return { ok: true };

  // All-or-nothing on duplicates: if any candidate is already in the folder,
  // insert nothing and say exactly why (no silent partial adds).
  const dup = await findDuplicateFolderItems(folderId, items);
  if (dup.error) return { ok: false, error: dup.error };
  if (dup.duplicates.length > 0) {
    return {
      ok: false,
      error:
        dup.duplicates.length === items.length
          ? "These items are already in this folder."
          : `${dup.duplicates.length} of ${items.length} selected items are already in this folder, so none were added.`,
    };
  }

  // Get the next position (surface read failures instead of silently
  // collapsing every new item onto position 0).
  const { data: existing, error: readError } = await supabase
    .from("folder_items")
    .select("position")
    .eq("folder_id", folderId)
    .order("position", { ascending: false })
    .limit(1);

  if (readError) return { ok: false, error: readError.message };

  let nextPosition =
    existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const insertData = items.map((item) => {
    const data = {
      folder_id: folderId,
      item_type: item.type,
      item_id: item.id,
      position: nextPosition,
    };
    nextPosition++;
    return data;
  });

  const { error } = await supabase.from("folder_items").insert(insertData);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "folder.items_added",
    targetType: "folder_item",
    detail: { folder_id: folderId, count: items.length, item_ids: items.map((i) => i.id) },
  });
  return { ok: true };
}

export async function removeMultipleItemsFromFolder(
  folderItemIds: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (folderItemIds.length === 0) return { ok: true };

  const { error } = await supabase
    .from("folder_items")
    .delete()
    .in("id", folderItemIds);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "folder.items_removed",
    targetType: "folder_item",
    detail: { count: folderItemIds.length, item_ids: folderItemIds },
  });
  return { ok: true };
}

/**
 * Batch-update positions for folder items.
 * Uses Promise.all instead of sequential updates (performance fix).
 * If a subset of writes fails, the rest are already persisted — that partial
 * state is reported explicitly so callers can refresh from the backend.
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

  let failed = 0;
  let firstError: string | null = null;
  for (const r of results) {
    if (r.error) {
      failed++;
      if (!firstError) firstError = r.error.message;
    }
  }

  if (failed > 0) {
    return {
      ok: false,
      error:
        `${failed} of ${items.length} positions failed to save` +
        (firstError ? ` (${firstError})` : ""),
    };
  }
  void logAudit({
    action: "folder.reordered",
    targetType: "folder_item",
    detail: { count: items.length },
  });
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
