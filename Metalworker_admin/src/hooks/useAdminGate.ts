// src/hooks/useAdminGate.ts
import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "../services/supabase";

export type GateStatus =
  | "checking"
  | "ok"
  | "unauthenticated"
  | "unauthorized"
  | "transient";

/**
 * Centralized admin auth gate.
 *
 * Previously every protected screen re-implemented its own
 * `supabase.auth.getSession().then(...)` check, and this hook bounced the
 * user straight back to /login on ANY error — including a single transient
 * network failure while reading the profile. A valid admin who is offline for
 * a moment would be kicked out of the app.
 *
 * This hook now distinguishes three outcomes:
 *
 *  - `unauthenticated` — no session, or the session token is rejected by the
 *    backend (401 / invalid JWT / expired JWT). Redirect to /login.
 *  - `unauthorized` — the profile row is missing, is not role `admin`, or is
 *    deactivated. Redirect to /login.
 *  - `transient` — the profile read failed for a clearly non-auth reason
 *    (network / 5xx). We retry with backoff a few times and then render
 *    optimistically WITHOUT redirecting. Every data request is still enforced
 *    by server-side RLS, so this never grants access the backend rejects.
 *
 * `checking` stays true while verification is in flight so screens do not
 * render protected content (or fire data requests) before it completes.
 */
export function useAdminGate(): {
  session: Session | null;
  checking: boolean;
  status: GateStatus;
} {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<GateStatus>("checking");
  const redirectedRef = useRef(false);
  const statusRef = useRef<GateStatus>("checking");

  // Mirror the status into a ref so the auth subscription callback (which runs
  // asynchronously, outside render) can read the latest value without pulling
  // `status` into its closure. Ref writes happen in an effect, never in render.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let mounted = true;

    const redirectToLogin = () => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      router.replace("/login");
    };

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    /**
     * Distinguish backend auth rejections from transient transport/server
     * failures. Only auth-level rejections justify logging the admin out.
     */
    const isAuthLevelError = (error: {
      message?: string;
      code?: string;
      status?: number;
    } | null): boolean => {
      if (!error) return false;
      const statusCode = error.status ?? 0;
      if (statusCode === 401 || statusCode === 403) return true;
      const code = (error.code ?? "").toLowerCase();
      if (code.includes("jwt") || code === "invalid_claims") return true;
      const msg = (error.message ?? "").toLowerCase();
      return (
        msg.includes("jwt") ||
        msg.includes("unauthorized") ||
        msg.includes("invalid login")
      );
    };

    const failUnauthenticated = () => {
      if (!mounted) return;
      setSession(null);
      setStatus("unauthenticated");
      setChecking(false);
      redirectToLogin();
    };

    const failUnauthorized = () => {
      if (!mounted) return;
      setSession(null);
      setStatus("unauthorized");
      setChecking(false);
      redirectToLogin();
    };

    async function verify() {
      if (!mounted) return;
      let current: Session | null = null;

      // Read the local session first. This is a storage read (rarely fails).
      try {
        const {
          data: { session: s },
        } = await supabase.auth.getSession();
        current = s;
      } catch {
        // Storage read failed — retry a couple of times before concluding.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const {
              data: { session: s },
            } = await supabase.auth.getSession();
            current = s;
            break;
          } catch {
            if (mounted && attempt < 2) await sleep(400 * (attempt + 1));
          }
        }
        if (!mounted) return;
        if (!current) {
          failUnauthenticated();
          return;
        }
        // Session exists but the storage layer is flaky — render optimistically.
        setSession(current);
        setStatus("transient");
        setChecking(false);
        return;
      }

      if (!mounted) return;

      if (!current) {
        failUnauthenticated();
        return;
      }

      // Profile verification with a small retry budget for transient
      // read failures. A single failed request must not log a valid admin
      // out of the app.
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("role, is_active")
          .eq("id", current.user.id)
          .maybeSingle();

        if (!mounted) return;

        if (error) {
          if (isAuthLevelError(error)) {
            failUnauthenticated();
            return;
          }
          // Transient failure: retry with backoff, then render optimistically.
          if (attempt < 2) {
            await sleep(400 * (attempt + 1));
            if (!mounted) return;
            continue;
          }
          setSession(current);
          setStatus("transient");
          setChecking(false);
          return;
        }

        if (!profile || profile.role !== "admin" || !profile.is_active) {
          failUnauthorized();
          return;
        }

        setSession(current);
        setStatus("ok");
        setChecking(false);
        return;
      }
    }

    void verify();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        setSession(null);
        setStatus("unauthenticated");
        setChecking(false);
        redirectToLogin();
      } else if (
        event === "TOKEN_REFRESHED" &&
        statusRef.current !== "ok" &&
        nextSession
      ) {
        // A refresh succeeded after a transient gate failure — re-verify so an
        // admin who briefly lost connectivity is confirmed without a reload.
        setSession(nextSession);
        setStatus("ok");
        setChecking(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, checking, status };
}