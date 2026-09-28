import { supabase } from "./supabase";
import type { Profile } from "../types/profile";
import { logAudit } from "./auditLog";

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

export async function deleteWorker(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
  }>("delete-worker", {
    body: { id },
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  void logAudit({ action: "user.deleted", targetType: "user", targetId: id });
  return { ok: true };
}