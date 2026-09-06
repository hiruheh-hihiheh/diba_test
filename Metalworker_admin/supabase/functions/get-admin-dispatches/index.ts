// @ts-nocheck

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
      return json({ ok: false, error: "Method not allowed." }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    );

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing Supabase environment variables.");
      return json(
        {
          ok: false,
          error: "Server configuration error.",
        },
        500
      );
    }

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return json({ ok: false, error: "Not authenticated." }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: userData, error: userError } =
      await authClient.auth.getUser();

    if (userError || !userData.user) {
      console.error("Authentication error:", userError);
      return json({ ok: false, error: "Not authenticated." }, 401);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: adminProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !adminProfile) {
      console.error("Admin profile error:", profileError);
      return json(
        { ok: false, error: "Admin profile not found." },
        403
      );
    }

    if (adminProfile.role !== "admin") {
      return json({ ok: false, error: "Admin access only." }, 403);
    }

    if (!adminProfile.is_active) {
      return json(
        { ok: false, error: "Your admin account is inactive." },
        403
      );
    }

    // An empty body is valid for the dispatch-list request.
    const body = await req.json().catch(() => ({}));
    const dispatchId = typeof body.id === "string" ? body.id : null;

    // Detail request: POST { "id": "<dispatch UUID>" }
    if (dispatchId) {
      const { data: dispatch, error: dispatchError } = await adminClient
        .from("dispatches")
        .select("*")
        .eq("id", dispatchId)
        .maybeSingle();

      if (dispatchError) {
        console.error("Single dispatch fetch error:", dispatchError);
        return json({ ok: false, error: "Failed to fetch dispatch." }, 500);
      }

      if (!dispatch) {
        return json({ ok: false, error: "Dispatch not found." }, 404);
      }

      return json({ ok: true, data: dispatch });
    }

    // List request: POST {}
    const { data: dispatches, error: dispatchError } = await adminClient
      .from("dispatches")
      .select("*")
      .order("submitted_at", { ascending: false });

    if (dispatchError) {
      console.error("Dispatch list fetch error:", dispatchError);
      return json(
        {
          ok: false,
          error: "Failed to fetch dispatches from database.",
        },
        500
      );
    }

    return json({ ok: true, data: dispatches ?? [] });
  } catch (error) {
    console.error("Unexpected get-admin-dispatches error:", error);

    return json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",
      },
      500
    );
  }
});