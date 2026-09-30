// src/services/admin.ts

import { supabase } from "../lib/supabase";
import { logAudit } from "./auditLog";
import type { Profile } from "../types/profile";

export async function createWorkerUser(
  username: string,
  password: string,
  role: "worker" | "processor" = "worker"
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    username?: string;
    error?: string;
  }>("create-user", {
    body: { username, password, role },
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  void logAudit({
    action: "user.created",
    targetType: "user",
    detail: { username, role },
  });
  return { ok: true };
}

export async function fetchWorkers(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .in("role", ["worker", "processor"])
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export async function updateWorkerProfile(
  id: string,
  updates: Partial<Pick<Profile, "full_name" | "is_active">>
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "user.profile.updated",
    targetType: "user",
    targetId: id,
    detail: { fields: Object.keys(updates) },
  });
  return { ok: true };
}

export async function updateWorkerUsername(
  id: string,
  newUsername: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
  }>("update-worker-username", {
    body: { id, newUsername },
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  void logAudit({
    action: "user.username_changed",
    targetType: "user",
    targetId: id,
    detail: { to: newUsername },
  });
  return { ok: true };
}

/**
 * Delete a worker/processor.
 *
 * The edge function can succeed at removing the auth account while a related
 * cleanup step fails; it reports that as `warning` (see delete-worker). The
 * warning is passed through instead of being dropped so the caller can tell
 * the admin that the account is gone but a row may need manual cleanup.
 */
export async function deleteWorker(
  id: string
): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    warning?: string;
  }>("delete-worker", {
    body: { id },
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  void logAudit({ action: "user.deleted", targetType: "user", targetId: id });
  if (data?.warning) return { ok: true, warning: data.warning };
  return { ok: true };
}
