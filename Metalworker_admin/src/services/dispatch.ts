import { supabase } from "./supabase";
import type { Dispatch, MaterialType } from "../types/dispatch";

export async function fetchAdminDispatches(): Promise<{ ok: boolean; data?: Dispatch[]; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; data?: Dispatch[]; error?: string }>("get-admin-dispatches", {
    body: {},
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true, data: data?.data || [] };
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