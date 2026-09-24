import { supabase } from "./supabase";
import type { JobDrawing, JobDrawingInput } from "../types/jobDrawing";

const TABLE = "job_drawings";

export async function fetchJobDrawings(jobId: string): Promise<JobDrawing[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as JobDrawing[];
}

export async function fetchJobDrawing(id: string): Promise<JobDrawing> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as JobDrawing;
}

export async function createJobDrawing(input: JobDrawingInput): Promise<{ ok: boolean; data?: JobDrawing; error?: string }> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert(input)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as JobDrawing };
}

export async function updateJobDrawing(id: string, input: JobDrawingInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(TABLE)
    .update(input)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteJobDrawing(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setPrimaryDrawing(jobId: string, drawingId: string): Promise<{ ok: boolean; error?: string }> {
  // First, set all drawings for this job to not primary
  const { error: resetError } = await supabase
    .from(TABLE)
    .update({ is_primary: false })
    .eq("job_id", jobId);

  if (resetError) return { ok: false, error: resetError.message };

  // Then, set the selected drawing to primary
  const { error: setError } = await supabase
    .from(TABLE)
    .update({ is_primary: true })
    .eq("id", drawingId);

  if (setError) return { ok: false, error: setError.message };

  return { ok: true };
}
