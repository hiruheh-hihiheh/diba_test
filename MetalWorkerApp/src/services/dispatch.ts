import { supabase } from "./supabase";
import type { TranslationDictionary } from "../constants/translations";

export type MaterialType = "scrap" | "ferrous" | "non_ferrous" | "other";
export type DispatchStatus = "submitted" | "reviewed" | "approved" | "rejected";

export interface Dispatch {
  id: string;
  worker_id: string | null;
  worker_username: string;
  vehicle_number: string;
  material_type: MaterialType;
  photo_url: string;
  photo_public_id: string | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  submitted_at: string;
  status: DispatchStatus;
  created_at: string;
}

export interface CreateDispatchInput {
  vehicleNumber: string;
  materialType: MaterialType;
  photoUrl: string;
  photoPublicId: string;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
}

/** Every data call returns the raw failure so the UI can classify it. */
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: unknown };

/**
 * The caller's own id, read from the locally stored session.
 *
 * This deliberately does NOT use `supabase.auth.getUser()`. That call is a
 * network round-trip to `/auth/v1/user` on *every* invocation - so scrolling to
 * page 3 of the history list, or tapping a dispatch row, each cost an extra
 * request purely to learn something already on disk. Worse, it fails outright
 * on a bad connection, which turned a perfectly valid session into a "your
 * session has expired" screen.
 *
 * `getSession()` reads the persisted session and only hits the network if the
 * access token actually needs refreshing. Authorisation is not weakened: the
 * `worker_id` filter below is a convenience, and row-level security still
 * decides what the server will actually return.
 */
async function currentUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function createDispatch(input: CreateDispatchInput): Promise<ServiceResult<null>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: new Error("Not authenticated") };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) return { ok: false, error: profileError };
  if (!profile) return { ok: false, error: new Error("Could not fetch worker profile") };

  const { error: insertError } = await supabase.from("dispatches").insert({
    worker_id: userId,
    worker_username: profile.username,
    vehicle_number: input.vehicleNumber,
    material_type: input.materialType,
    photo_url: input.photoUrl,
    photo_public_id: input.photoPublicId,
    latitude: input.latitude,
    longitude: input.longitude,
    location_name: input.locationName,
  });

  if (insertError) return { ok: false, error: insertError };
  return { ok: true, data: null };
}

export interface FetchDispatchesParams {
  limit?: number;
  offset?: number;
  /** Case-insensitive substring match on the vehicle number. */
  search?: string;
  status?: DispatchStatus | "all";
}

export interface FetchDispatchesResult {
  rows: Dispatch[];
  /** Total matching rows, or null when the server did not report a count. */
  total: number | null;
}

const DISPATCH_COLUMNS =
  "id, worker_id, worker_username, vehicle_number, material_type, photo_url, photo_public_id, latitude, longitude, location_name, submitted_at, status, created_at";

/**
 * One paged, searchable, filterable query used by the dashboard, the history
 * list and the detail screen. Keeping this in a single function means the
 * status filter and the search box can never disagree about what "all" means.
 */
export async function fetchMyDispatches(
  params: FetchDispatchesParams = {},
): Promise<ServiceResult<FetchDispatchesResult>> {
  const { limit = 20, offset = 0, search = "", status = "all" } = params;

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: new Error("Not authenticated") };

  let query = supabase
    .from("dispatches")
    .select(DISPATCH_COLUMNS, { count: "exact" })
    .eq("worker_id", userId)
    .order("submitted_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const trimmed = search.trim();
  if (trimmed) {
    // PostgREST's `ilike` uses `*` as its wildcard, NOT `%`. The previous code
    // wrapped the term in `%...%`, which is a literal, so the server searched
    // for the text "%KA 03%" and matched nothing - search was silently dead
    // against real Supabase.
    //
    // A `*` typed or pasted into the box is dropped as well, so the box cannot
    // be turned into a match-everything query, and the reserved characters that
    // would otherwise be parsed as filter syntax are neutralised.
    const safe = trimmed
      .replace(/[*%,()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (safe) query = query.ilike("vehicle_number", `*${safe}*`);
  }
  if (status !== "all") query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) return { ok: false, error };

  return { ok: true, data: { rows: (data ?? []) as Dispatch[], total: count ?? null } };
}

export async function fetchDispatchById(id: string): Promise<ServiceResult<Dispatch | null>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: new Error("Not authenticated") };

  const { data, error } = await supabase
    .from("dispatches")
    .select(DISPATCH_COLUMNS)
    .eq("id", id)
    .eq("worker_id", userId) // never let one worker open another's record
    .maybeSingle();

  if (error) return { ok: false, error };
  return { ok: true, data: (data as Dispatch | null) ?? null };
}

export function getMaterialLabelKey(type: MaterialType): keyof TranslationDictionary {
  switch (type) {
    case "scrap": return "scrap_metal";
    case "ferrous": return "ferrous_metal";
    case "non_ferrous": return "non_ferrous_metal";
    case "other": return "other";
    default: return "other";
  }
}

export function getStatusLabelKey(status: DispatchStatus): keyof TranslationDictionary {
  switch (status) {
    case "submitted": return "status_submitted";
    case "reviewed": return "status_reviewed";
    case "approved": return "status_approved";
    case "rejected": return "status_rejected";
    default: return "status_submitted";
  }
}

export const ALL_STATUSES: DispatchStatus[] = ["submitted", "reviewed", "approved", "rejected"];

/** Status tallies for the dashboard summary, derived from one page of rows. */
export function summarise(rows: Dispatch[]): {
  total: number;
  inReview: number;
  approved: number;
  rejected: number;
} {
  return rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.status === "submitted" || row.status === "reviewed") acc.inReview += 1;
      else if (row.status === "approved") acc.approved += 1;
      else if (row.status === "rejected") acc.rejected += 1;
      return acc;
    },
    { total: 0, inReview: 0, approved: 0, rejected: 0 },
  );
}
