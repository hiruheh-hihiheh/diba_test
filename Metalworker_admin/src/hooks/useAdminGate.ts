// src/hooks/useAdminGate.ts
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "../services/supabase";

/**
 * Centralized admin auth gate.
 *
 * Previously every protected screen re-implemented its own
 * `supabase.auth.getSession().then(...)` check. Several of those copies were
 * incomplete (dispatch.tsx spun forever without a session; dispatch-details.tsx
 * trusted the edge function only) and none re-verified that the signed-in
 * profile is still an *active admin* after login.
 *
 * This hook:
 *  - reads the current session once,
 *  - verifies the linked profile is role `admin` and `is_active`,
 *  - redirects to /login when the session is missing/expired or the profile is
 *    no longer an active admin,
 *  - reacts to SIGNED_OUT (e.g. token revoked from the dashboard).
 *
 * Use the returned `checking` flag to avoid rendering protected content (and
 * firing data requests) before verification completes.
 */
export function useAdminGate(): { session: Session | null; checking: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const redirectedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const redirectToLogin = () => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      router.replace("/login");
    };

    async function verify() {
      try {
        const {
          data: { session: current },
        } = await supabase.auth.getSession();
        if (!mounted) return;

        if (!current) {
          setSession(null);
          setChecking(false);
          redirectToLogin();
          return;
        }

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("role, is_active")
          .eq("id", current.user.id)
          .maybeSingle();

        if (!mounted) return;

        if (error || !profile || profile.role !== "admin" || !profile.is_active) {
          setSession(null);
          setChecking(false);
          redirectToLogin();
          return;
        }

        setSession(current);
        setChecking(false);
      } catch {
        if (!mounted) return;
        setSession(null);
        setChecking(false);
        redirectToLogin();
      }
    }

    verify();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        if (mounted) {
          setSession(null);
          setChecking(false);
        }
        redirectToLogin();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, checking };
}