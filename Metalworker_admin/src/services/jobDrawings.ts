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
  // Set the target first: if the second write fails below, the job is left
  // with the requested primary (plus possibly a stale flag elsewhere), never
  // with *no* primary. Stray flags are resolved by the next successful call.
  const { error: setError } = await supabase
    .from(TABLE)
    .update({ is_primary: true })
    .eq("id", drawingId);

  if (setError) return { ok: false, error: setError.message };

  // Clear any other primary flags for this job, keeping the selected one.
  const { error: resetError } = await supabase
    .from(TABLE)
    .update({ is_primary: false })
    .eq("job_id", jobId)
    .neq("id", drawingId);

  if (resetError) {
    return {
      ok: false,
      error: `${resetError.message} (the selected drawing is primary, but clearing previous primaries failed.)`,
    };
  }

  return { ok: true };
}
