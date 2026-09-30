// src/services/companyStock.ts

import { supabase } from "../lib/supabase";
import { logAudit } from "./auditLog";
import { destroyCloudinaryAsset } from "./cloudinaryCleanup";
import type { CompanyStock, CompanyStockInput } from "../types/companyStock";

const TABLE = "company_stock";

export async function fetchCompanyStocks(): Promise<CompanyStock[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CompanyStock[];
}

export async function fetchCompanyStock(id: string): Promise<CompanyStock> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as CompanyStock;
}

export async function createCompanyStock(
  input: CompanyStockInput
): Promise<{ ok: boolean; data?: CompanyStock; error?: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "stock.company.created",
    targetType: "stock",
    targetId: data.id,
    detail: { company: input.company_name ?? null, folder_no: input.folder_no ?? null },
  });
  return { ok: true, data: data as CompanyStock };
}

export async function updateCompanyStock(
  id: string,
  input: Partial<CompanyStockInput>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update(input).eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "stock.company.updated",
    targetType: "stock",
    targetId: id,
    detail: { fields: Object.keys(input) },
  });
  return { ok: true };
}

export async function deleteCompanyStock(
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
    .eq("item_type", "company_stock")
    .eq("item_id", id);

  if (linksError) {
    return { ok: false, error: `Failed to remove folder links: ${linksError.message}` };
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) return { ok: false, error: error.message };

  // Destroy the uploads only once no row references them; best-effort and
  // server-side, so it can never fail the delete.
  void destroyCloudinaryAsset(existing?.drawing_photo_public_id, "company stock drawing");
  void destroyCloudinaryAsset(existing?.metal_photo_public_id, "company stock metal");

  void logAudit({ action: "stock.company.deleted", targetType: "stock", targetId: id });
  return { ok: true };
}
