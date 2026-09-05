import { supabase } from "./supabase";
import type { Profile } from "../types/profile";

export async function createWorkerUser(
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    username?: string;
    error?: string;
  }>("create-user", {
    body: { username, password },
  });

  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.error };
  return { ok: true };
}

export async function fetchWorkers(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "worker")
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
  return { ok: true };
}