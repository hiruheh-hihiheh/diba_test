import { supabase } from "../lib/supabase";
import type { Job, JobInput, JobType } from "../types/job";

const TABLE = "jobs";

export async function fetchJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export async function fetchJobsByType(type: JobType): Promise<Job[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("job_type", type)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export async function fetchJobsByFolder(folderId: string, type: JobType): Promise<Job[]> {
  const { data: items, error: itemsError } = await supabase
    .from("folder_items")
    .select("item_id")
    .eq("folder_id", folderId)
    .eq("item_type", "job");
    
  if (itemsError) throw new Error(itemsError.message);
  if (!items || items.length === 0) return [];
  
  const jobIds = items.map(i => i.item_id);
  
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .in("id", jobIds)
    .eq("job_type", type)
    .order("created_at", { ascending: false });
    
  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export async function fetchJob(id: string): Promise<Job> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as Job;
}

export async function createJob(input: JobInput): Promise<{ ok: boolean; data?: Job; error?: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Job };
}

export async function updateJob(id: string, input: JobInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(TABLE)
    .update(input)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
