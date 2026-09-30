import { supabase } from "./supabase";
import type { Job, JobInput, JobType } from "../types/job";
import { logAudit } from "./auditLog";
import { destroyCloudinaryAsset } from "./cloudinary";

const TABLE = "jobs";

export async function fetchJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export interface JobPage {
  items: Job[];
  total: number;
  hasMore: boolean;
  /** Number of rows fetched so far (for the UI count it is more honest than items.length across pages). */
  loadedCount: number;
}

/**
 * Server-paginated job list.
 *
 * The admin job tables can grow to thousands of rows; fetching every job and
 * filtering on the client does not scale. This moves pagination, ordering and
 * text search to PostgREST: only one bounded page is downloaded and the total
 * count comes back as an exact count (when the table is indexed).
 */
export async function fetchJobsPage(
  type: JobType,
  opts: { page?: number; pageSize?: number; search?: string } = {}
): Promise<JobPage> {
  const { page = 0, pageSize = 50, search = "" } = opts;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // Columns an admin would reasonably search for by hand.
  const searchable: (keyof Job)[] = [
    "job_no",
    "po_status",
    "tool_description",
    "tool_part",
    "quantity",
    "current_machining_status",
    "status",
    "drawing_status",
    "model_status",
    "expected_completion_note",
  ];

  let query = supabase
    .from(TABLE)
    .select("*", { count: "exact" })
    .eq("job_type", type);

  // Strip characters that would break the PostgREST `or` filter grammar
  // (commas, parens, quotes). A colon on its own is harmless but we keep the
  // sanitizer conservative — users searching for everything get all results.
  const q = search.trim().replace(/[(),"%]/g, "").slice(0, 60);
  if (q) {
    const orClause = searchable.map((c) => `${c}.ilike.%${q}%`).join(",");
    query = query.or(orClause);
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  const items = (data ?? []) as Job[];
  const total = count ?? items.length;
  return {
    items,
    total,
    hasMore: from + items.length < total,
    loadedCount: from + items.length,
  };
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
  void logAudit({
    action: "job.created",
    targetType: "job",
    targetId: data.id,
    detail: { job_no: input.job_no ?? null, job_type: input.job_type ?? null },
  });
  return { ok: true, data: data as Job };
}

export async function updateJob(id: string, input: JobInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from(TABLE)
    .update(input)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  void logAudit({
    action: "job.updated",
    targetType: "job",
    targetId: id,
    detail: { fields: Object.keys(input) },
  });
  return { ok: true };
}

export async function deleteJob(id: string): Promise<{ ok: boolean; error?: string }> {
  // Collect the drawing asset ids first — once the job row is gone they are
  // unrecoverable and the Cloudinary uploads are orphaned.
  const { data: drawings, error: drawingsReadError } = await supabase
    .from("job_drawings")
    .select("public_id")
    .eq("job_id", id);

  if (drawingsReadError) {
    return {
      ok: false,
      error: `Failed to read job drawings: ${drawingsReadError.message}`,
    };
  }

  // Folder associations first: leaving them behind would show a dangling entry
  // in every folder that referenced this job.
  const { error: linksError } = await supabase
    .from("folder_items")
    .delete()
    .eq("item_type", "job")
    .eq("item_id", id);

  if (linksError) {
    return { ok: false, error: `Failed to remove folder links: ${linksError.message}` };
  }

  // Then the drawings themselves. If this fails the job is NOT deleted, so the
  // drawings never become orphans and the reported failure is honest.
  const { error: drawingsError } = await supabase
    .from("job_drawings")
    .delete()
    .eq("job_id", id);

  if (drawingsError) {
    return {
      ok: false,
      error: `Failed to remove job drawings: ${drawingsError.message}`,
    };
  }

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  // Assets are destroyed only now that no row references them; best-effort and
  // server-side so it cannot fail the delete.
  for (const d of drawings ?? []) {
    void destroyCloudinaryAsset(d.public_id, "job drawing");
  }

  void logAudit({
    action: "job.deleted",
    targetType: "job",
    targetId: id,
    detail: { drawings_removed: (drawings ?? []).length },
  });
  return { ok: true };
}
