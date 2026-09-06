// src/services/dispatch.ts
import { supabase } from "./supabase";
import type { Dispatch, MaterialType, UpdateDispatchInput } from "../types/dispatch";

export async function fetchAdminDispatches(): Promise<{ ok: boolean; data?: Dispatch[]; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; data?: Dispatch[]; error?: string }>("get-admin-dispatches", {
    body: {},
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, data: data?.data || [] };
}

export async function fetchDispatchById(id: string): Promise<{ ok: boolean; data?: Dispatch; error?: string }> {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Dispatch not found" };
  
  return { ok: true, data: data as Dispatch };
}

export async function updateDispatch(
  id: string,
  input: UpdateDispatchInput
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("dispatches")
    .update(input)
    .eq("id", id);

  if (error) {
    console.error("Update dispatch error:", error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function deleteDispatch(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("dispatches")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Delete dispatch error:", error);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export function getMaterialLabel(type: MaterialType): string {
  switch (type) {
    case "scrap": return "Scrap";
    case "ferrous": return "Ferrous Metal";
    case "non_ferrous": return "Non-Ferrous Metal";
    case "other": return "Other";
    default: return type;
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "submitted": return "#F59E0B"; // amber
    case "reviewed": return "#3B82F6"; // blue
    case "approved": return "#10B981"; // green
    case "rejected": return "#EF4444"; // red
    default: return "#6B7280"; // gray
  }
}