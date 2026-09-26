// src/services/dispatch.ts

import { supabase } from "./supabase";
import type {
  Dispatch,
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

export function getMaterialLabel(type: MaterialType): string {
  switch (type) {
    case "scrap":
      return "Scrap";

    case "ferrous":
      return "Ferrous Metal";

    case "non_ferrous":
      return "Non-Ferrous Metal";

    case "other":
      return "Other";

    default:
      return type;
  }
}

export function getStatusColor(status: string, theme: any): string {
  switch (status) {
    case "submitted":
      return theme.colors.warning;
    case "reviewed":
      return theme.colors.primary;
    case "approved":
      return theme.colors.success;
    case "rejected":
      return theme.colors.danger;
    default:
      return theme.colors.textMuted;
  }
}