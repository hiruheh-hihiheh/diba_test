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

export async function removeJobFromFolder(folderId: string, jobId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("folder_items")
    .delete()
    .match({ folder_id: folderId, item_id: jobId, item_type: "job" });
    
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removeMultipleJobsFromFolder(folderId: string, jobIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (jobIds.length === 0) return { ok: true };
  
  const { error } = await supabase
    .from("folder_items")
    .delete()
    .eq("folder_id", folderId)
    .eq("item_type", "job")
    .in("item_id", jobIds);
    
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
  // Remove from any folders first
  await supabase.from("folder_items").delete().match({ item_id: id, item_type: "job" });
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Fetch jobs of a given type that are NOT already linked to the specified folder.
 */
export async function fetchAvailableJobsForFolder(folderId: string, type: JobType): Promise<Job[]> {
  // 1. Get IDs already in this folder
  const { data: linked } = await supabase
    .from("folder_items")
    .select("item_id")
    .eq("folder_id", folderId)
    .eq("item_type", "job");

  const linkedIds = new Set((linked ?? []).map(l => l.item_id));

  // 2. Get all jobs of the requested type
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("job_type", type)
    .order("job_no", { ascending: true });

  if (error) throw new Error(error.message);

  // 3. Filter out already-linked ones
  return ((data ?? []) as Job[]).filter(j => !linkedIds.has(j.id));
}

/**
 * Add a single job to a folder (via folder_items). Prevents duplicates.
 */
export async function addJobToFolder(folderId: string, jobId: string): Promise<{ ok: boolean; error?: string }> {
  // Check if already linked
  const { data: existing } = await supabase
    .from("folder_items")
    .select("id")
    .match({ folder_id: folderId, item_id: jobId, item_type: "job" })
    .limit(1);

  if (existing && existing.length > 0) return { ok: true }; // already linked

  // Get next position
  const { data: posData } = await supabase
    .from("folder_items")
    .select("position")
    .eq("folder_id", folderId)
    .order("position", { ascending: false })
    .limit(1);

  const nextPos = posData && posData.length > 0 ? posData[0].position + 1 : 0;

  const { error } = await supabase
    .from("folder_items")
    .insert({ folder_id: folderId, item_type: "job", item_id: jobId, position: nextPos });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Add multiple jobs to a folder (via folder_items). Prevents duplicates.
 */
export async function addMultipleJobsToFolder(folderId: string, jobIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (jobIds.length === 0) return { ok: true };

  // Check existing
  const { data: existing } = await supabase
    .from("folder_items")
    .select("item_id")
    .eq("folder_id", folderId)
    .eq("item_type", "job")
    .in("item_id", jobIds);

  const existingSet = new Set((existing ?? []).map(e => e.item_id));
  const newIds = jobIds.filter(id => !existingSet.has(id));
  if (newIds.length === 0) return { ok: true };

  const { data: posData } = await supabase
    .from("folder_items")
    .select("position")
    .eq("folder_id", folderId)
    .order("position", { ascending: false })
    .limit(1);

  let nextPos = posData && posData.length > 0 ? posData[0].position + 1 : 0;

  const insertData = newIds.map(id => {
    const row = { folder_id: folderId, item_type: "job" as const, item_id: id, position: nextPos };
    nextPos++;
    return row;
  });

  const { error } = await supabase.from("folder_items").insert(insertData);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
