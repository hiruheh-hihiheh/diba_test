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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    // ---------------- Environment ----------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
    const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
    const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing Supabase environment variables");
      return json(
        { ok: false, error: "Server configuration error. Missing Supabase environment variables." },
        500
      );
    }

    if (!cloudName || !apiKey || !apiSecret) {
      console.error("Missing Cloudinary environment variables");
      return json(
        {
          ok: false,
          error:
            "Server configuration error. Missing Cloudinary credentials (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).",
        },
        500
      );
    }

    // ---------------- Authorization FIRST ----------------
    // Identical to create-user / delete-worker / update-worker-username /
    // get-admin-dispatches: only an authenticated, ACTIVE admin may destroy
    // Cloudinary assets. Credentials never reach the client.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "Not authenticated" }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) {
      console.error("Authentication error:", userError);
      return json({ ok: false, error: "Not authenticated" }, 401);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

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

    // ---------------- Body (after authz) ----------------
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const publicId = String(body?.public_id ?? "").trim();

    if (!publicId) {
      return json({ ok: false, error: "Missing 'public_id' in request body" }, 400);
    }

    // Public ids are cloudinary paths (letters/digits/_/-//). Reject anything
    // that is not a plausible cloudinary public id instead of forwarding it.
    // eslint-disable-next-line no-useless-escape
    if (!/^[a-zA-Z0-9_/]+$/.test(publicId) || publicId.length > 512) {
      return json(
        { ok: false, error: "public_id contains invalid characters." },
        400
      );
    }

    // ---------------- Destroy ----------------
    try {
      const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`;
      const basic = btoa(`${apiKey}:${apiSecret}`);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ public_id: publicId }),
      });

      const result = (await res.json().catch(() => ({}))) as {
        result?: string;
        error?: { message?: string };
      };

      if (res.ok && result.result === "ok") {
        return json({ ok: true, result: "deleted" });
      }

      console.warn("Cloudinary destroy failed:", res.status, result);
      return json(
        {
          ok: false,
          error: result.error?.message ?? `Cloudinary destroy failed (HTTP ${res.status}).`,
          asset_intact: true,
        },
        502
      );
    } catch (err) {
      console.error("Unexpected Cloudinary destroy error:", err);
      return json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Unexpected Cloudinary error.",
          asset_intact: true,
        },
        502
      );
    }
  } catch (error) {
    console.error("Unexpected delete-cloudinary-asset error:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected server error.",
      },
      500
    );
  }
});