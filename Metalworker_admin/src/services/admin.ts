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