import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_STATUSES = new Set(["submitted", "reviewed", "approved", "rejected"]);
const ALLOWED_MATERIAL_TYPES = new Set(["scrap", "ferrous", "non_ferrous", "other"]);
const MAX_LIST_LIMIT = 5000;

/** True when `v` is a plain object (not null, not an array). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate and narrow an `input` payload for the `update` action, using the
 * same field list the client's `UpdateDispatchInput` declares. Unknown or
 * mistyped fields are rejected up-front rather than silently ignored.
 */
function validateUpdateInput(input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!isRecord(input)) {
    return { ok: false, error: "Input must be an object." };
  }

  const value: Record<string, unknown> = {};

  if ("vehicle_number" in input) {
    if (typeof input.vehicle_number !== "string" || input.vehicle_number.length > 60) {
      return { ok: false, error: "vehicle_number must be a string of at most 60 characters." };
    }
    value.vehicle_number = input.vehicle_number;
  }

  if ("material_type" in input) {
    if (typeof input.material_type !== "string" || !ALLOWED_MATERIAL_TYPES.has(input.material_type)) {
      return { ok: false, error: "material_type must be one of scrap, ferrous, non_ferrous, other." };
    }
    value.material_type = input.material_type;
  }

  if ("status" in input) {
    if (typeof input.status !== "string" || !ALLOWED_STATUSES.has(input.status)) {
      return { ok: false, error: "status must be one of submitted, reviewed, approved, rejected." };
    }
    value.status = input.status;
  }

  // location_name is nullable and only overwritten when the client actually
  // supplies the key, so an admin clearing the field (null) is honoured while
  // a stale JS `undefined` can no longer wipe the stored value.
  if ("location_name" in input) {
    if (input.location_name !== null && (typeof input.location_name !== "string" || input.location_name.length > 200)) {
      return { ok: false, error: "location_name must be a string of at most 200 characters or null." };
    }
    value.location_name = input.location_name;
  }

  if ("photo_url" in input) {
    if (typeof input.photo_url !== "string" || input.photo_url.length > 1024) {
      return { ok: false, error: "photo_url must be a string of at most 1024 characters." };
    }
    value.photo_url = input.photo_url;
  }

  if ("photo_public_id" in input) {
    if (typeof input.photo_public_id !== "string" || input.photo_public_id.length > 512) {
      return { ok: false, error: "photo_public_id must be a string of at most 512 characters." };
    }
    value.photo_public_id = input.photo_public_id;
  }

  if ("latitude" in input) {
    if (typeof input.latitude !== "number" || Number.isNaN(input.latitude) || input.latitude < -90 || input.latitude > 90) {
      return { ok: false, error: "latitude must be a number between -90 and 90." };
    }
    value.latitude = input.latitude;
  }

  if ("longitude" in input) {
    if (typeof input.longitude !== "number" || Number.isNaN(input.longitude) || input.longitude < -180 || input.longitude > 180) {
      return { ok: false, error: "longitude must be a number between -180 and 180." };
    }
    value.longitude = input.longitude;
  }

  return { ok: true, value };
}

/**
 * Best-effort Cloudinary asset destroy for a dispatch photo. Runs server-side
 * with the Cloudinary Admin API credentials from Deno env; if the credentials
 * are not configured (or the destroy fails), it only logs and never fails the
 * caller. Deletion of the DB row never depends on this succeeding.
 */
async function destroyDispatchPhoto(publicId: string | null | undefined): Promise<void> {
  if (!publicId) return;
  const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
  const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
  if (!cloudName || !apiKey || !apiSecret) {
    console.warn("Cloudinary credentials not configured; skipping asset destroy for:", publicId);
    return;
  }

  try {
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`;
    const basic = btoa(`${apiKey}:${apiSecret}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      body: JSON.stringify({ public_id: publicId }),
    });
    if (!res.ok) {
      console.warn(`Cloudinary destroy failed (HTTP ${res.status}) for:`, publicId);
    }
  } catch (err) {
    console.warn("Cloudinary destroy error for:", publicId, err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      console.error("Missing Supabase environment variables");
      return json({ ok: false, error: "Server configuration error." }, 500);
    }

    // ---- Authorization FIRST (identical to create-user / delete-worker /
    // ---- update-worker-username). Unauthenticated and non-admin callers are
    // ---- rejected before the request body is even parsed, so they cannot
    // ---- probe the endpoint's field and action surface.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "Not authenticated." }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ ok: false, error: "Not authenticated." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: adminProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !adminProfile) {
      console.error("Admin profile error:", profileError);
      return json({ ok: false, error: "Admin profile not found." }, 403);
    }

    if (adminProfile.role !== "admin") {
      return json({ ok: false, error: "Admin access only." }, 403);
    }

    if (!adminProfile.is_active) {
      return json({ ok: false, error: "Your admin account is inactive." }, 403);
    }

    // ---- Body only after authorization.
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    // Validate the action up-front so a malformed request can never fall
    // through to a default (previously `{}` silently became a `list`).
    const action = typeof body?.action === "string" ? body.action : "";
    const ALLOWED_ACTIONS = new Set(["list", "get", "update", "delete"]);
    if (!ALLOWED_ACTIONS.has(action)) {
      return json(
        { ok: false, error: "Invalid action. Must be list, get, update, or delete." },
        400
      );
    }

    if (action === "list") {
      // Optional server-side pagination. The current admin client does not
      // pass these, so the response is unchanged for it; bounded caps keep
      // the endpoint from ever loading an unbounded table into memory.
      let limit = 1000 as number | null;
      let offset = 0;
      if (body?.limit !== undefined) {
        if (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > MAX_LIST_LIMIT) {
          return json(
            { ok: false, error: `limit must be an integer between 1 and ${MAX_LIST_LIMIT}.` },
            400
          );
        }
        limit = body.limit;
      }
      if (body?.offset !== undefined) {
        if (typeof body.offset !== "number" || !Number.isInteger(body.offset) || body.offset < 0) {
          return json({ ok: false, error: "offset must be a non-negative integer." }, 400);
        }
        offset = body.offset;
      }

      let query = adminClient
        .from("dispatches")
        .select("*", { count: "exact" })
        .order("submitted_at", { ascending: false });

      if (limit !== null) {
        query = query.range(offset, offset + limit - 1);
      }

      const { data, count, error } = await query;

      if (error) {
        console.error("Dispatch list error:", error);
        return json({ ok: false, error: "Failed to load dispatches." }, 500);
      }

      return json({ ok: true, data: data ?? [], total: count ?? (data ?? []).length });
    }

    // get / update / delete all operate on a single UUID; validate it once.
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id || !UUID_REGEX.test(id)) {
      return json({ ok: false, error: "A valid dispatch ID (UUID) is required." }, 400);
    }

    if (action === "get") {
      const { data, error } = await adminClient
        .from("dispatches")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        console.error("Dispatch detail error:", error);
        return json({ ok: false, error: "Failed to load dispatch." }, 500);
      }

      if (!data) {
        return json({ ok: false, error: "Dispatch not found." }, 404);
      }

      return json({ ok: true, data });
    }

    if (action === "update") {
      const validated = validateUpdateInput(body?.input);
      if (!validated.ok) {
        return json({ ok: false, error: validated.error }, 400);
      }

      const { data, error } = await adminClient
        .from("dispatches")
        .update(validated.value)
        .eq("id", id)
        .select("*")
        .maybeSingle();

      if (error) {
        console.error("Dispatch update error:", error);
        return json({ ok: false, error: "Failed to update dispatch." }, 500);
      }

      if (!data) {
        return json({ ok: false, error: "Dispatch not found." }, 404);
      }

      return json({ ok: true, data });
    }

    if (action === "delete") {
      // Read the photo's Cloudinary public id BEFORE deleting the row so the
      // asset can be destroyed afterwards (never before — the asset must only
      // go away once nothing references it).
      const { data: existing, error: readError } = await adminClient
        .from("dispatches")
        .select("id, photo_public_id")
        .eq("id", id)
        .maybeSingle();

      if (readError) {
        console.error("Dispatch read error:", readError);
        return json({ ok: false, error: "Failed to load dispatch." }, 500);
      }

      if (!existing) {
        return json({ ok: false, error: "Dispatch not found." }, 404);
      }

      const { data, error } = await adminClient
        .from("dispatches")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("Dispatch delete error:", error);
        return json({ ok: false, error: "Failed to delete dispatch." }, 500);
      }

      if (!data) {
        return json({ ok: false, error: "Dispatch not found." }, 404);
      }

      // Server-side, best-effort cleanup — never blocks or fails the delete.
      await destroyDispatchPhoto(existing.photo_public_id);

      // Server-side audit trail (same table/policy as the admin app's helper):
      // deleting a dispatch from either admin app is recorded here where the
      // forged-row policy (0003) still applies to public clients.
      const auditRow = {
        actor_id: userData.user.id,
        actor_username: userData.user.user_metadata?.username ?? null,
        action: "dispatch.deleted",
        target_type: "dispatch",
        target_id: id,
      };
      const { error: auditError } = await adminClient
        .from("admin_audit_log")
        .insert(auditRow);
      if (auditError) {
        console.warn("Audit log write skipped:", auditError.message);
      }

      return json({ ok: true, data });
    }

    return json({ ok: false, error: "Invalid action." }, 400);
  } catch (error) {
    console.error("Unexpected get-admin-dispatches error:", error);
    return json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unexpected server error.",
      },
      500
    );
  }
});