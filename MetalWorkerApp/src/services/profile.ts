import { supabase } from "./supabase";

/**
 * Updates the last_login_at timestamp for the currently authenticated user.
 * 
 * SECURITY NOTE: This relies on Row Level Security (RLS) policies in Supabase.
 * Ensure you have an RLS policy on the `profiles` table that allows a user to 
 * UPDATE their own row, for example:
 * 
 * CREATE POLICY "Users can update own profile"
 * ON public.profiles
 * FOR UPDATE
 * USING (auth.uid() = id);
 * 
 * If this policy is missing, this function will fail silently (caught and logged),
 * and you must add the policy or handle it via a secure Edge Function.
 */
export async function updateLastLogin(): Promise<{ ok: boolean; error?: string }> {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { ok: false, error: "Not authenticated" };
    }

    const { error } = await supabase
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error updating last login",
    };
  }
}