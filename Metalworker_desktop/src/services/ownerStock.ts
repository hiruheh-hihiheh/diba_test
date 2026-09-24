// src/services/ownerStock.ts

import { supabase } from "../lib/supabase";
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
  return { ok: true, data: data as OwnerStock };
}

export async function updateOwnerStock(
  id: string,
  input: Partial<OwnerStockInput>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).update(input).eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteOwnerStock(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
