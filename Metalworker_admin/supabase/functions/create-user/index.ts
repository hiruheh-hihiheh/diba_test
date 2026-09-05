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
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return json(
        { error: "Method not allowed" },
        405
      );
    }

    // =====================================
    // GET SUPABASE ENVIRONMENT VARIABLES
    // =====================================

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const supabaseAnonKey =
      Deno.env.get("SUPABASE_ANON_KEY");

    const supabaseServiceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !supabaseServiceRoleKey
    ) {
      console.error(
        "Missing Supabase environment variables"
      );

      return json(
        {
          error:
            "Server configuration error. Missing Supabase environment variables.",
        },
        500
      );
    }

    // =====================================
    // GET AUTHORIZATION TOKEN
    // =====================================

    const authHeader =
      req.headers.get("Authorization");

    if (!authHeader) {
      return json(
        { error: "Not authenticated" },
        401
      );
    }

    // =====================================
    // CLIENT TO IDENTIFY CALLING USER
    // =====================================

    const authClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    );

    const {
      data: userData,
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !userData.user) {
      console.error(
        "Authentication error:",
        userError
      );

      return json(
        { error: "Not authenticated" },
        401
      );
    }

    // =====================================
    // ADMIN CLIENT
    // =====================================

    const adminClient = createClient(
      supabaseUrl,
      supabaseServiceRoleKey
    );

    // =====================================
    // CHECK ADMIN PROFILE
    // =====================================

    const {
      data: adminProfile,
      error: profileError,
    } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", userData.user.id)
      .single();

    if (profileError || !adminProfile) {
      console.error(
        "Admin profile error:",
        profileError
      );

      return json(
        {
          error:
            "Admin profile not found.",
        },
        403
      );
    }

    if (adminProfile.role !== "admin") {
      return json(
        {
          error:
            "Admin access only.",
        },
        403
      );
    }

    if (!adminProfile.is_active) {
      return json(
        {
          error:
            "Your admin account is inactive.",
        },
        403
      );
    }

    // =====================================
    // READ REQUEST DATA
    // =====================================

    const body = await req.json();

    const username = String(
      body?.username ?? ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      body?.password ?? ""
    );

    // =====================================
    // VALIDATE USERNAME
    // =====================================

    if (
      !/^[a-z0-9._-]{3,30}$/.test(username)
    ) {
      return json(
        {
          error:
            "Username must be 3-30 characters and can only contain letters, numbers, dots, underscores, or hyphens.",
        },
        400
      );
    }

    // =====================================
    // VALIDATE PASSWORD
    // =====================================

    if (password.length < 6) {
      return json(
        {
          error:
            "Password must be at least 6 characters.",
        },
        400
      );
    }

    if (username === "admin") {
      return json(
        {
          error:
            "This username is reserved.",
        },
        400
      );
    }

    // =====================================
    // CHECK IF USERNAME EXISTS
    // =====================================

    const {
      data: existingProfile,
      error: existingError,
    } = await adminClient
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingError) {
      console.error(
        "Username check error:",
        existingError
      );

      return json(
        {
          error:
            existingError.message,
        },
        500
      );
    }

    if (existingProfile) {
      return json(
        {
          error:
            "Username already exists.",
        },
        409
      );
    }

    // =====================================
    // CREATE AUTH USER
    // =====================================

    const email =
      `${username}@metalworker.local`;

    const {
      data: createdData,
      error: createError,
    } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        role: "worker",
      },
    });

    if (createError || !createdData.user) {
      console.error(
        "User creation error:",
        createError
      );

      return json(
        {
          error:
            createError?.message ??
            "Failed to create worker.",
        },
        400
      );
    }

    const workerId =
      createdData.user.id;

    // =====================================
    // CREATE / UPDATE PROFILE
    // =====================================

    const {
      error: workerProfileError,
    } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: workerId,
          username,
          role: "worker",
          is_active: true,
        },
        {
          onConflict: "id",
        }
      );

    if (workerProfileError) {
      console.error(
        "Profile creation error:",
        workerProfileError
      );

      // Remove Auth user so we don't leave
      // a broken/incomplete account behind
      await adminClient.auth.admin.deleteUser(
        workerId
      );

      return json(
        {
          error:
            "Worker authentication account was created, but the profile could not be created: " +
            workerProfileError.message,
        },
        500
      );
    }

    // =====================================
    // SUCCESS
    // =====================================

    console.log(
      `Worker created successfully: ${username}`
    );

    return json({
      ok: true,
      message:
        "Worker created successfully.",
      worker: {
        id: workerId,
        username,
        role: "worker",
        is_active: true,
      },
    });

  } catch (error) {
    console.error(
      "Unexpected create-user error:",
      error
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error.",
      },
      500
    );
  }
});