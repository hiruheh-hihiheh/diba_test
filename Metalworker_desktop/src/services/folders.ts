// src/services/folders.ts

import { supabase } from "../lib/supabase";
import { logAudit } from "./auditLog";
import { formatJobKind } from "./bills";
import type { AdminFolder, FolderItem, FolderItemDisplay, FolderItemType } from "../types/folder";

const TABLE = "admin_folders";
const ITEMS_TABLE = "folder_items";
const CHUNK_SIZE = 100;

export async function fetchFolders(): Promise<AdminFolder[]> {
  const { data, error } = await supabase
    .from(TABLE).select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  
  const folders = (data ?? []) as AdminFolder[];
  
  // Fetch counts efficiently
  if (folders.length > 0) {
    const { data: counts } = await supabase
      .from(ITEMS_TABLE)
      .select("folder_id, item_type, item_id");
      
    const { data: allJobs } = await supabase.from("jobs").select("id, job_type");
    const jobTypeMap = new Map((allJobs || []).map(j => [j.id, j.job_type]));
      
    const countMap = new Map<string, number>();
    const labourCountMap = new Map<string, number>();
    const withMaterialCountMap = new Map<string, number>();
    
    for (const c of counts || []) {
      countMap.set(c.folder_id, (countMap.get(c.folder_id) || 0) + 1);
      
      if (c.item_type === "job") {
        const type = jobTypeMap.get(c.item_id);
        if (type === "labour") {
          labourCountMap.set(c.folder_id, (labourCountMap.get(c.folder_id) || 0) + 1);
        } else if (type === "with_material") {
          withMaterialCountMap.set(c.folder_id, (withMaterialCountMap.get(c.folder_id) || 0) + 1);
        }
      }
    }
    
    for (const f of folders) {
      f.itemCount = countMap.get(f.id) || 0;
      f.labourCount = labourCountMap.get(f.id) || 0;
      f.withMaterialCount = withMaterialCountMap.get(f.id) || 0;
    }
  }

  return folders;
}

export async function fetchFolder(id: string): Promise<AdminFolder> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data as AdminFolder;
}

export async function createFolder(
  name: string,
  folderType: AdminFolder["folder_type"] = null
): Promise<{ ok: boolean; data?: AdminFolder; error?: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ name, folder_type: folderType })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as AdminFolder };
}

export async function updateFolder(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update({ name }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  // Delete folder items first and CHECK the result. Silently ignoring this
  // error (the previous behaviour) could delete the folder while leaving its
  // folder_items rows behind, which then show up as dangling entries in every
  // folder list and cannot be resolved.
  const { error: itemsError } = await supabase
    .from(ITEMS_TABLE)
    .delete()
    .eq("folder_id", id);

  if (itemsError) {
    return { ok: false, error: `Failed to remove folder items: ${itemsError.message}` };
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  void logAudit({ action: "folder.deleted", targetType: "folder", targetId: id });
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
  // Compatibility + duplicate checks for job items, mirroring the job-folder
  // flow in jobs.ts so typed folders cannot receive the wrong job type.
  if (itemType === "job") {
    const { data: folderData } = await supabase.from(TABLE).select("folder_type").eq("id", folderId).single();
    const { data: jobData } = await supabase.from("jobs").select("job_type").eq("id", itemId).single();
    if (folderData && jobData && folderData.folder_type && folderData.folder_type !== "general") {
      if (jobData.job_type !== folderData.folder_type) {
        return { ok: false, error: `Cannot add ${jobData.job_type} job to a ${folderData.folder_type} folder.` };
      }
    }

    const { data: existingLink } = await supabase
      .from(ITEMS_TABLE)
      .select("id")
      .match({ folder_id: folderId, item_id: itemId, item_type: "job" })
      .limit(1);
    if (existingLink && existingLink.length > 0) {
      // Already linked: treat as success, no duplicate row.
      return { ok: true };
    }
  }

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
export async function addMultipleItemsToFolder(
  folderId: string,
  items: { type: FolderItemType; id: string }[]
): Promise<{ ok: boolean; error?: string }> {
  if (items.length === 0) return { ok: true };

  // Compatibility check for job items against a typed folder.
  const jobItems = items.filter((i) => i.type === "job");
  if (jobItems.length > 0) {
    const { data: folderData } = await supabase.from(TABLE).select("folder_type").eq("id", folderId).single();
    if (folderData?.folder_type && folderData.folder_type !== "general") {
      const { data: jobsData } = await supabase.from("jobs").select("id, job_type").in("id", jobItems.map((i) => i.id));
      const invalid = (jobsData ?? []).find((j: { job_type: string }) => j.job_type !== folderData.folder_type);
      if (invalid) {
        return { ok: false, error: `Cannot add ${invalid.job_type} job to a ${folderData.folder_type} folder.` };
      }
    }
  }

  const { data: existing } = await supabase
    .from(ITEMS_TABLE)
    .select("position")
    .eq("folder_id", folderId)
    .order("position", { ascending: false })
    .limit(1);

  let nextPos = existing && existing.length > 0 ? existing[0].position + 1 : 0;

  const insertData = items.map((item) => {
    const data = {
      folder_id: folderId,
      item_type: item.type,
      item_id: item.id,
      position: nextPos,
    };
    nextPos++;
    return data;
  });

  const { error } = await supabase.from(ITEMS_TABLE).insert(insertData);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removeMultipleItemsFromFolder(
  folderItemIds: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (folderItemIds.length === 0) return { ok: true };

  const { error } = await supabase
    .from(ITEMS_TABLE)
    .delete()
    .in("id", folderItemIds);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function reorderFolderItems(
  items: { id: string; position: number }[],
  folderId?: string
): Promise<{ ok: boolean; error?: string }> {
  // Preferred path: the transactional `reorder_folder_items` RPC (migration
  // 0004, shared with the admin app). It rewrites every position in ONE
  // transaction, so a partial reorder is impossible. The RPC is
  // SECURITY DEFINER and enforces the active-admin check server-side.
  if (folderId) {
    const { error: rpcError } = await supabase.rpc("reorder_folder_items", {
      p_folder_id: folderId,
      p_item_ids: items.map((item) => item.id),
    });

    if (!rpcError) {
      void logAudit({
        action: "folder.reordered",
        targetType: "folder_item",
        detail: { folder_id: folderId, count: items.length, via: "rpc" },
      });
      return { ok: true };
    }
  }

  // Fallback (RPC not deployed yet): the previous multi-update path. A
  // mixture of updates can partially persist — report that state explicitly
  // (k of n) rather than a bare failure, so the caller can refresh and tell
  // the user which positions did not save.
  const results = await Promise.all(
    items.map((item) =>
      supabase
        .from(ITEMS_TABLE)
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
    detail: { count: items.length, via: "fallback" },
  });
  return { ok: true };
}

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
/**
 * Build a display label for a `bills` record.
 *
 * A bill is one real invoice from a tax-invoice workbook, so the invoice number
 * is what identifies it — the sheet name is only a fallback for a workbook whose
 * invoice cell was left blank. The three print copies are NOT part of the label:
 * they are three renderings of this one record, and listing them as three items
 * would make a folder of 2 bills look like a folder of 6.
 */
function buildBillLabel(data: {
  invoice_no?: string | null;
  sheet_name?: string | null;
  amount_after_tax?: number | string | null;
}, fallbackId: string): string {
  const invoice = data.invoice_no?.trim();
  const sheet = data.sheet_name?.trim();
  const money =
    data.amount_after_tax === null || data.amount_after_tax === undefined
      ? null
      : Number(data.amount_after_tax);
  const amount = money !== null && Number.isFinite(money) ? ` • ₹${money.toLocaleString("en-IN")}` : "";

  if (invoice) return `${invoice}${amount}`;
  if (sheet) return `Bill ${sheet}${amount}`;
  return `Bill (${fallbackId.slice(0, 8)})`;
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
  /** Optional second lines (currently only a bill's job classification). */
  const subtitleMap = new Map<string, string>();

  // Chunked lookups: PostgREST URLs have a practical length limit, and an
  // imported folder can link hundreds of jobs at once. Sending them all in
  // one `.in(...)` produces an HTTP 400 "Bad Request", so walk them in
  // fixed-size chunks instead (mirroring the import pipeline's CHUNK_SIZE).
  const fetches: PromiseLike<void>[] = [];

  const chunkedIn = async <T>(
    table: string,
    select: string,
    ids: string[],
    onRows: (rows: T[]) => void
  ) => {
    for (let c = 0; c < ids.length; c += CHUNK_SIZE) {
      const chunk = ids.slice(c, c + CHUNK_SIZE);
      if (chunk.length === 0) continue;
      const { data, error } = await supabase.from(table).select(select).in("id", chunk);
      if (error) throw new Error(error.message);
      onRows((data ?? []) as T[]);
    }
  };

  if (groups.has("owner_stock")) {
    fetches.push(
      (async () => {
        await chunkedIn<{ id: string; source_of_metal: string | null; folder_no: string | null }>(
          "owner_stock",
          "id, source_of_metal, folder_no",
          groups.get("owner_stock")!,
          (rows) => rows.forEach((r) => labelMap.set(r.id, r.source_of_metal || r.folder_no || "Owner Stock"))
        );
      })()
    );
  }
  if (groups.has("company_stock")) {
    fetches.push(
      (async () => {
        await chunkedIn<{ id: string; company_name: string | null; product_name: string | null }>(
          "company_stock",
          "id, company_name, product_name",
          groups.get("company_stock")!,
          (rows) => rows.forEach((r) => labelMap.set(r.id, r.company_name || r.product_name || "Company Stock"))
        );
      })()
    );
  }
  if (groups.has("bill_group")) {
    fetches.push(
      (async () => {
        await chunkedIn<{ id: string; name: string }>(
          "bill_groups",
          "id, name",
          groups.get("bill_group")!,
          (rows) => rows.forEach((r) => labelMap.set(r.id, r.name))
        );
      })()
    );
  }
  if (groups.has("drawing_group")) {
    fetches.push(
      (async () => {
        await chunkedIn<{ id: string; name: string }>(
          "drawing_groups",
          "id, name",
          groups.get("drawing_group")!,
          (rows) => rows.forEach((r) => labelMap.set(r.id, r.name))
        );
      })()
    );
  }
  if (groups.has("job")) {
    fetches.push(
      (async () => {
        await chunkedIn<{ id: string; job_no: string | null }>(
          "jobs",
          "id, job_no",
          groups.get("job")!,
          (rows) => rows.forEach((r) => labelMap.set(r.id, r.job_no ? `Job ${r.job_no}` : "Job"))
        );
      })()
    );
  }
  if (groups.has("bill")) {
    fetches.push(
      (async () => {
        await chunkedIn<{ id: string; invoice_no: string | null; sheet_name: string | null; amount_after_tax: number | null; job_kind: string | null }>(
          "bills",
          "id, invoice_no, sheet_name, amount_after_tax, job_kind",
          groups.get("bill")!,
          (rows) =>
            rows.forEach((r) => {
              labelMap.set(r.id, buildBillLabel(r, r.id));
              /* Second line only. The label above is untouched so search, toasts and
                 the accessible names all stay exactly as they were; the
                 classification is displayed alongside, never merged into the name.
                 Normalized, so "WITHMETAL" never reaches a folder list. */
              const kind = formatJobKind(r.job_kind);
              if (kind) subtitleMap.set(r.id, kind);
            })
        );
      })()
    );
  }

  await Promise.all(fetches);

  return items.map((item) => {
    let label = `${item.item_type} (${item.item_id.slice(0, 8)})`;

    if (item.item_type === "owner_stock") {
      const fallback = labelMap.get(item.item_id);
      if (fallback) label = buildOwnerStockLabel({ source_of_metal: fallback }, item.item_id);
    } else if (item.item_type === "company_stock") {
      const fallback = labelMap.get(item.item_id);
      if (fallback) label = buildCompanyStockLabel({ company_name: fallback }, item.item_id);
    } else if (item.item_type === "bill_group" || item.item_type === "drawing_group") {
      const name = labelMap.get(item.item_id);
      if (name) {
        label = item.item_type === "bill_group" ? `Bill Group - ${name}` : `Drawing Group - ${name}`;
      }
    } else if (item.item_type === "job") {
      const name = labelMap.get(item.item_id);
      if (name) label = name;
    } else if (item.item_type === "bill") {
      const built = labelMap.get(item.item_id);
      if (built) label = built;
    }
    const subtitle = subtitleMap.get(item.item_id) ?? null;
    return { ...item, label, subtitle };
  });
}

export async function fetchAvailableItems(
  folderId: string
): Promise<{ type: FolderItemType; id: string; label: string }[]> {
  const { data: existing } = await supabase
    .from(ITEMS_TABLE)
    .select("item_id")
    .eq("folder_id", folderId);

  const existingIds = new Set((existing ?? []).map((e) => e.item_id));

  // Folder type drives which jobs may be offered. A typed folder must not
  // even list incompatible jobs as available.
  const { data: folderData } = await supabase.from(TABLE).select("folder_type").eq("id", folderId).single();
  const folderType = folderData?.folder_type ?? null;

  const [ownerRes, companyRes, billRes, drawingRes, jobRes, taxBillRes] = await Promise.all([
    supabase.from("owner_stock").select("id, folder_no, folio_number, source_of_metal").order("created_at", { ascending: false }),
    supabase.from("company_stock").select("id, folder_no, company_name, product_name").order("created_at", { ascending: false }),
    supabase.from("bill_groups").select("id, name").order("created_at", { ascending: false }),
    supabase.from("drawing_groups").select("id, name").order("created_at", { ascending: false }),
    supabase.from("jobs").select("id, job_no, job_type").order("created_at", { ascending: false }),
    supabase.from("bills").select("id, invoice_no, sheet_name, amount_after_tax, invoice_date").order("created_at", { ascending: false }),
  ]);

  const available: { type: FolderItemType; id: string; label: string }[] = [];

  for (const s of ownerRes.data ?? []) {
    if (!existingIds.has(s.id)) available.push({ type: "owner_stock", id: s.id, label: buildOwnerStockLabel(s, s.id) });
  }
  for (const s of companyRes.data ?? []) {
    if (!existingIds.has(s.id)) available.push({ type: "company_stock", id: s.id, label: buildCompanyStockLabel(s, s.id) });
  }
  for (const g of billRes.data ?? []) {
    if (!existingIds.has(g.id)) available.push({ type: "bill_group", id: g.id, label: `Bill Group - ${g.name}` });
  }
  for (const g of drawingRes.data ?? []) {
    if (!existingIds.has(g.id)) available.push({ type: "drawing_group", id: g.id, label: `Drawing Group - ${g.name}` });
  }
  for (const j of jobRes.data ?? []) {
    if (existingIds.has(j.id)) continue;
    if (folderType && folderType !== "general" && j.job_type !== folderType) continue;
    available.push({ type: "job", id: j.id, label: j.job_no ? `Job ${j.job_no}` : `Job (${j.id.slice(0, 8)})` });
  }
  // One row per real invoice. The three print copies are deliberately absent:
  // adding "Original", "Duplicate" and "Triplicate" separately would put three
  // copies of one bill into a folder and triple every folder total.
  for (const b of taxBillRes.data ?? []) {
    if (!existingIds.has(b.id)) available.push({ type: "bill", id: b.id, label: buildBillLabel(b, b.id) });
  }

  return available;
}

export async function fetchAllItems(): Promise<{ type: FolderItemType; id: string; label: string }[]> {
  const [ownerRes, companyRes, billRes, drawingRes, jobRes, taxBillRes] = await Promise.all([
    supabase.from("owner_stock").select("id, folder_no, folio_number, source_of_metal").order("created_at", { ascending: false }),
    supabase.from("company_stock").select("id, folder_no, company_name, product_name").order("created_at", { ascending: false }),
    supabase.from("bill_groups").select("id, name").order("created_at", { ascending: false }),
    supabase.from("drawing_groups").select("id, name").order("created_at", { ascending: false }),
    supabase.from("jobs").select("id, job_no").order("created_at", { ascending: false }),
    supabase.from("bills").select("id, invoice_no, sheet_name, amount_after_tax, invoice_date").order("created_at", { ascending: false }),
  ]);

  const items: { type: FolderItemType; id: string; label: string }[] = [];

  for (const s of ownerRes.data ?? []) items.push({ type: "owner_stock", id: s.id, label: buildOwnerStockLabel(s, s.id) });
  for (const s of companyRes.data ?? []) items.push({ type: "company_stock", id: s.id, label: buildCompanyStockLabel(s, s.id) });
  for (const g of billRes.data ?? []) items.push({ type: "bill_group", id: g.id, label: `Bill Group - ${g.name}` });
  for (const g of drawingRes.data ?? []) items.push({ type: "drawing_group", id: g.id, label: `Drawing Group - ${g.name}` });
  for (const j of jobRes.data ?? []) items.push({ type: "job", id: j.id, label: j.job_no ? `Job ${j.job_no}` : `Job (${j.id.slice(0, 8)})` });
  for (const b of taxBillRes.data ?? []) items.push({ type: "bill", id: b.id, label: buildBillLabel(b, b.id) });

  return items;
}
