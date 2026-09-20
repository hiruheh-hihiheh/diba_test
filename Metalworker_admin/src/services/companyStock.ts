// src/services/companyStock.ts

import { supabase } from "./supabase";
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
  return { ok: true, data: data as CompanyStock };
}

export async function updateCompanyStock(
  id: string,
  input: Partial<CompanyStockInput>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update(input).eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteCompanyStock(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
