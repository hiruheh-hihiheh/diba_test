// src/services/dispatch.ts

import { supabase } from "../lib/supabase";
import type {
  Dispatch,
  LegacyMaterialType,
  MaterialType,
  UpdateDispatchInput,
} from "../types/dispatch";

export async function fetchAdminDispatches(): Promise<{
  ok: boolean;
  data?: Dispatch[];
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    data?: Dispatch[];
    error?: string;
  }>("get-admin-dispatches", {
    body: { action: "list" },
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) {
    return { ok: false, error: data?.error || "Failed to load dispatches." };
  }

  return { ok: true, data: data.data || [] };
}

export async function fetchDispatchById(
  id: string
): Promise<{ ok: boolean; data?: Dispatch; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    data?: Dispatch;
    error?: string;
  }>("get-admin-dispatches", {
    body: { action: "get", id },
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok || !data.data) {
    return { ok: false, error: data?.error || "Dispatch not found." };
  }

  return { ok: true, data: data.data };
}

export async function updateDispatch(
  id: string,
  input: UpdateDispatchInput
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    error?: string;
  }>("get-admin-dispatches", {
    body: { action: "update", id, input },
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) {
    return { ok: false, error: data?.error || "Failed to update dispatch." };
  }

  return { ok: true };
}

export async function deleteDispatch(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    error?: string;
  }>("get-admin-dispatches", {
    body: { action: "delete", id },
  });

  if (error) return { ok: false, error: error.message };
  if (!data?.ok) {
    return { ok: false, error: data?.error || "Failed to delete dispatch." };
  }

  return { ok: true };
}

export function isLegacyMaterialType(type: MaterialType): type is LegacyMaterialType {
  return type === "scrap" || type === "ferrous" || type === "non_ferrous";
}

/**
 * Display label for a material value. `custom` is the free-text Other
 * description, so an Other record reads "Other: brass fittings" instead of a
 * bare, uninformative "Other". Historical values keep their original labels.
 */
export function getMaterialLabel(type: MaterialType, custom?: string | null): string {
  switch (type) {
    case "metal":
      return "Metal";
    case "non_metal":
      return "Non-metal";
    case "other": {
      const detail = custom?.trim();
      return detail ? `Other: ${detail}` : "Other";
    }
    case "scrap":
      return "Scrap";
    case "ferrous":
      return "Ferrous Metal";
    case "non_ferrous":
      return "Non-Ferrous Metal";
    default:
      return type;
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "submitted":
      return "#F59E0B";
    case "reviewed":
      return "#3B82F6";
    case "approved":
      return "#10B981";
    case "rejected":
      return "#EF4444";
    default:
      return "#6B7280";
  }
}
