import { supabase } from "./supabase";
import type { JobDrawing, JobDrawingInput } from "../types/jobDrawing";
import { logAudit } from "./auditLog";
import { destroyCloudinaryAsset } from "./cloudinary";

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
  void logAudit({
    action: "drawing.created",
    targetType: "job_drawing",
    targetId: data.id,
    detail: { job_id: data.job_id, has_photo: !!data.public_id },
  });
  return { ok: true, data: data as JobDrawing };
}

export async function updateJobDrawing(id: string, input: JobDrawingInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(TABLE)
    .update(input)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "drawing.updated",
    targetType: "job_drawing",
    targetId: id,
    detail: { fields: Object.keys(input) },
  });
  return { ok: true };
}

export async function deleteJobDrawing(id: string): Promise<{ ok: boolean; error?: string }> {
  // Read the asset's Cloudinary public id BEFORE deleting the row. Without
  // this the row delete succeeds and the uploaded file is orphaned in
  // Cloudinary forever (and we can no longer tell which asset it was).
  const { data: existing, error: readError } = await supabase
    .from(TABLE)
    .select("public_id")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  // Destroy the asset only now that no row references it. Best-effort and
  // server-side (edge function holds the Cloudinary credentials): never
  // blocks or fails the delete.
  void destroyCloudinaryAsset(existing?.public_id, "job drawing");

  void logAudit({
    action: "drawing.deleted",
    targetType: "job_drawing",
    targetId: id,
    detail: { had_photo: !!existing?.public_id },
  });
  return { ok: true };
}

export async function setPrimaryDrawing(jobId: string, drawingId: string): Promise<{ ok: boolean; error?: string }> {
  // Preferred path: the transactional `set_primary_drawing` RPC (migration
  // 0002). Both writes happen in one transaction and the drawing is checked to
  // belong to the job, so a crash can never leave a job with zero or two
  // primaries, and a foreign drawing id can never be marked primary here.
  const { error: rpcError } = await supabase.rpc("set_primary_drawing", {
    p_job_id: jobId,
    p_drawing_id: drawingId,
  });

  if (!rpcError) {
    void logAudit({
      action: "drawing.set_primary",
      targetType: "job_drawing",
      targetId: drawingId,
      detail: { job_id: jobId, via: "rpc" },
    });
    return { ok: true };
  }

  // Fallback: the RPC is not deployed yet (migration pending). Keep the
  // previous two-step behaviour — set the target first so a second-write
  // failure never leaves the job with *no* primary — and scope the target
  // write to the job so a foreign id cannot be marked primary.
  const { error: setError } = await supabase
    .from(TABLE)
    .update({ is_primary: true })
    .eq("id", drawingId)
    .eq("job_id", jobId);

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

  void logAudit({
    action: "drawing.set_primary",
    targetType: "job_drawing",
    targetId: drawingId,
    detail: { job_id: jobId, via: "fallback" },
  });
  return { ok: true };
}
