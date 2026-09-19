// @ts-nocheck

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    // =====================================
    // GET SUPABASE ENVIRONMENT VARIABLES
    // =====================================

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing Supabase environment variables");
      return json(
        { ok: false, error: "Server configuration error. Missing Supabase environment variables." },
        500
      );
    }

    // =====================================
    // GET AUTHORIZATION TOKEN
    // =====================================

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return json({ ok: false, error: "Not authenticated" }, 401);
    }

    // =====================================
    // CLIENT TO IDENTIFY CALLING USER
    // =====================================

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser();

    if (userError || !userData.user) {
      console.error("Authentication error:", userError);
      return json({ ok: false, error: "Not authenticated" }, 401);
    }

    // =====================================
    // ADMIN CLIENT
    // =====================================

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // =====================================
    // CHECK ADMIN PROFILE
    // =====================================

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

    // =====================================
    // READ AND VALIDATE REQUEST DATA
    // =====================================

    let body;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const id = String(body?.id ?? "").trim();
    const newUsername = String(body?.newUsername ?? "")
      .trim()
      .toLowerCase();

    if (!id || !newUsername) {
      return json({ ok: false, error: "Missing 'id' or 'newUsername' in request body" }, 400);
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return json({ ok: false, error: "Invalid UUID format" }, 400);
    }

    if (!/^[a-z0-9._-]{3,30}$/.test(newUsername)) {
      return json(
        {
          ok: false,
          error:
            "Username must be 3-30 characters and can only contain letters, numbers, dots, underscores, or hyphens.",
        },
        400
      );
    }

    if (newUsername === "admin") {
      return json({ ok: false, error: "This username is reserved." }, 400);
    }

    // =====================================
    // CHECK TARGET PROFILE
    // =====================================

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", id)
      .maybeSingle();

    if (targetError) {
      console.error("Target profile error:", targetError);
      return json({ ok: false, error: targetError.message }, 500);
    }

    if (!targetProfile) {
      return json({ ok: false, error: "Worker not found" }, 404);
    }

    if (targetProfile.role === "admin") {
      return json({ ok: false, error: "Cannot modify an admin account username." }, 409);
    }

    if (targetProfile.role === "processor" && !newUsername.endsWith("_processor")) {
      return json({ ok: false, error: "Processor usernames must end with _processor." }, 400);
    }

    if (targetProfile.role === "worker" && newUsername.endsWith("_processor")) {
      return json({ ok: false, error: "Worker usernames cannot end with _processor." }, 400);
    }

    // =====================================
    // CHECK IF NEW USERNAME EXISTS
    // =====================================

    const { data: existingProfile, error: existingError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("username", newUsername)
      .neq("id", id)
      .maybeSingle();

    if (existingError) {
      console.error("Username check error:", existingError);
      return json({ ok: false, error: existingError.message }, 500);
    }

    if (existingProfile) {
      return json({ ok: false, error: "Username already exists." }, 409);
    }

    // =====================================
    // UPDATE AUTH USER EMAIL AND METADATA
    // =====================================

    const newEmail = `${newUsername}@metalworker.local`;

    const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(id, {
      email: newEmail,
      user_metadata: {
        username: newUsername,
      },
    });

    if (updateAuthError) {
      console.error("Update auth user error:", updateAuthError);
      return json({ ok: false, error: "Failed to update auth credentials: " + updateAuthError.message }, 500);
    }

    // =====================================
    // UPDATE PROFILE USERNAME
    // =====================================

    const { error: updateProfileError } = await adminClient
      .from("profiles")
      .update({ username: newUsername })
      .eq("id", id);

    if (updateProfileError) {
      console.error("Update profile error:", updateProfileError);
      return json({ ok: false, error: "Failed to update profile username: " + updateProfileError.message }, 500);
    }

    // =====================================
    // SUCCESS
    // =====================================

    console.log(`Username updated successfully: ${id} to ${newUsername}`);

    return json({ ok: true });

  } catch (error) {
    console.error("Unexpected delete-worker error:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected server error.",
      },
      500
    );
  }
});