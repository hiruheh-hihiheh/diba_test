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

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return json({ ok: false, error: "Server configuration error." }, 500);
    }

    const { action = "list", id, input } = await req.json().catch(() => ({}));

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ ok: false, error: "Not authenticated." }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return json({ ok: false, error: "Not authenticated." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Admin profile lookup failed:", profileError);
      return json({ ok: false, error: "Unable to verify admin access." }, 500);
    }

    if (!profile || profile.role !== "admin" || !profile.is_active) {
      return json({ ok: false, error: "Admin access required." }, 403);
    }

    if (action === "update") {
  if (!id || !input) {
    return json({ ok: false, error: "Dispatch ID and update data are required." }, 400);
  }

  const { data: updatedDispatch, error: updateError } = await adminClient
    .from("dispatches")
    .update({
      vehicle_number: input.vehicle_number,
      material_type: input.material_type,
      location_name: input.location_name,
      status: input.status,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    console.error("Dispatch update failed:", updateError);
    return json({ ok: false, error: "Failed to update dispatch." }, 500);
  }

  if (!updatedDispatch) {
    return json({ ok: false, error: "Dispatch not found." }, 404);
  }

  return json({ ok: true, data: updatedDispatch });
}

    if (action === "get" && id) {
      const { data: dispatch, error: dispatchError } = await adminClient
        .from("dispatches")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (dispatchError) {
        console.error("Dispatch detail lookup failed:", dispatchError);
        return json({ ok: false, error: "Failed to load dispatch." }, 500);
      }

      if (!dispatch) {
        return json({ ok: false, error: "Dispatch not found." }, 404);
      }

      return json({ ok: true, data: dispatch });
    }

    const { data: dispatches, error: dispatchesError } = await adminClient
      .from("dispatches")
      .select("*")
      .order("submitted_at", { ascending: false });

    if (dispatchesError) {
      console.error("Dispatch list lookup failed:", dispatchesError);
      return json({ ok: false, error: "Failed to load dispatches." }, 500);
    }

    return json({ ok: true, data: dispatches ?? [] });
  } catch (error) {
    console.error("Unexpected get-admin-dispatches error:", error);
    return json({ ok: false, error: "Unexpected server error." }, 500);
  }
});