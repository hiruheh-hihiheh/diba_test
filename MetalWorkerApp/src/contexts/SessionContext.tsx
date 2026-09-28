import { useRouter, useSegments } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { supabase } from "../services/supabase";
import { readableError, type ReadableError } from "../utils/readableError";
import type { UserRole } from "../types/profile";

export type SessionStatus =
  /** Reading persisted auth state. Show a splash, not an error. */
  | "restoring"
  /** No usable session. This is the only state that sends the user to /login. */
  | "signedOut"
  /** Session + profile both resolved and the account is usable. */
  | "signedIn"
  /**
   * A session exists but the profile could not be read — almost always a dead
   * connection. Critically this is NOT the same as "signed out": we must never
   * sign a worker out because their signal dropped mid-shift.
   */
  | "unreachable";

interface SessionContextValue {
  status: SessionStatus;
  role: UserRole | null;
  username: string;
  fullName: string;
  isActive: boolean;
  userId: string | null;
  /** Populated when `status === "unreachable"`, or when a profile check was rejected. */
  error: ReadableError | null;
  /** True while a profile retry is in flight. */
  retrying: boolean;
  /** Re-read the profile. Safe to call on a dead connection. */
  refresh: () => Promise<void>;
  /** Sign out and return to /login. Reports failures instead of swallowing them. */
  signOut: () => Promise<{ ok: boolean; error?: ReadableError }>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const PUBLIC_ROUTES = new Set(["/login"]);

export function homeForRole(role: UserRole | null): "/dashboard" | "/processor-dashboard" {
  return role === "processor" ? "/processor-dashboard" : "/dashboard";
}

function displayNameFrom(sessionUser: { user_metadata?: Record<string, unknown>; email?: string } | null): string {
  const meta = sessionUser?.user_metadata?.full_name;
  if (typeof meta === "string" && meta.trim()) return meta.trim();
  const emailName = sessionUser?.email?.split("@")[0];
  return emailName || "";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();

  const [status, setStatusState] = useState<SessionStatus>("restoring");
  const [role, setRole] = useState<UserRole | null>(null);
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<ReadableError | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Guards against a stale async profile read writing over a newer auth state.
  const authEpoch = useRef(0);
  /**
   * The session we have already loaded a profile for.
   *
   * On boot `applySession` is reached twice: once from the restore effect and
   * once from supabase's `INITIAL_SESSION` event. Each triggered its own
   * `profiles` query, and because a failed/redirected render could re-run it
   * again, a single screen load was issuing the same identical request up to
   * six times. Remembering the session's access token collapses that to one
   * request per real session, and a genuinely new token still re-reads.
   */
  const loadedForToken = useRef<string | null>(null);
  const loadingProfile = useRef(false);
  // Mirrors `status` for use inside a stable callback: reading it through a ref
  // keeps `applySession`'s identity constant, so the restore effect and the auth
  // subscription are not torn down and rebuilt on every state change.
  const statusRef = useRef<SessionStatus>("restoring");

  /**
   * Single writer for `status`, so the mirror above can never drift.
   * A context that reports "signed in" while its own ref says "restoring" is
   * exactly the kind of bug that only shows up on a real phone, weeks later.
   */
  const setStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const loadProfile = useCallback(async (uid: string, sessionUser: Parameters<typeof displayNameFrom>[0], token?: string) => {
    if (loadingProfile.current) return;
    loadingProfile.current = true;
    const epoch = ++authEpoch.current;

    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("username, full_name, role, is_active")
      .eq("id", uid)
      .maybeSingle();

    loadingProfile.current = false;

    if (epoch !== authEpoch.current) return;

    if (queryError) {
      // The row may exist and we simply could not read it. Do not sign anyone out.
      setError(readableError(queryError));
      setStatus("unreachable");
      return;
    }

    if (!data) {
      // Genuinely no profile row for this auth user: the account is unusable.
      setError({ kind: "notFound", retryable: false, message: "no_profile" });
      setStatus("unreachable");
      return;
    }

    const nextRole = (data.role ?? null) as UserRole | null;
    const isWorkerish = nextRole === "worker" || nextRole === "processor";

    setUsername(data.username ?? "");
    setFullName(data.full_name || displayNameFrom(sessionUser));
    setIsActive(Boolean(data.is_active));
    setRole(nextRole);
    setError(null);

    if (token) loadedForToken.current = token;

    if (!data.is_active) {
      setStatus("unreachable"); // screen shows the "account inactive" copy
      return;
    }
    if (!isWorkerish) {
      // Admins must not use the mobile app; login screen already refuses them.
      setStatus("unreachable");
      return;
    }
    setStatus("signedIn");
  }, []);

  const applySession = useCallback(
    async (session: { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } } | null) => {
      if (!session) {
        authEpoch.current++;
        setStatus("signedOut");
        setRole(null);
        setUserId(null);
        setError(null);
        loadedForToken.current = null;
        return;
      }

      // One profile read per session, not one per caller.
      const token =
        (session as unknown as { access_token?: string }).access_token ?? null;
      if (token && loadedForToken.current === token && statusRef.current === "signedIn") return;

      setUserId(session.user.id);
      await loadProfile(session.user.id, session.user, token ?? undefined);
    },
    [loadProfile],
  );

  // --- initial restore -----------------------------------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!alive) return;

      if (sessionError) {
        // Could not read storage at all — treat as recoverable, not as "logged out".
        setError(readableError(sessionError));
        setStatus("unreachable");
        return;
      }
      await applySession(data.session);
    })();

    return () => {
      alive = false;
    };
  }, [applySession]);

  // --- live auth changes (expiry, sign-out from another device) -----------
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Never await inside the handler — supabase-js serialises these callbacks.
      if (event === "TOKEN_REFRESHED") return;

      if (event === "SIGNED_OUT") {
        authEpoch.current++;
        // Forget the memoised session, or signing back in as the same user
        // would skip the profile read and land on a screen with no name on it.
        loadedForToken.current = null;
        setStatus("signedOut");
        setRole(null);
        setUserId(null);
        setError(null);
        return;
      }
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED") {
        void applySession(session as Parameters<typeof applySession>[0]);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [applySession]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setStatus("signedOut");
      return;
    }
    // An explicit retry is the user saying "that didn't work, try again", so it
    // must bypass the one-per-session memo and really re-read the profile.
    loadedForToken.current = null;
    setRetrying(true);
    try {
      await applySession(data.session);
    } finally {
      setRetrying(false);
    }
  }, [applySession]);

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) return { ok: false, error: readableError(signOutError) };
    return { ok: true };
  }, []);

  // --- route guard ---------------------------------------------------------
  const pathname = segments.join("/");
  const onPublicRoute = PUBLIC_ROUTES.has(`/${pathname}`);

  useEffect(() => {
    if (status === "restoring") return;

    if (status === "signedOut") {
      if (!onPublicRoute) router.replace("/login");
      return;
    }

    if (status === "signedIn" && onPublicRoute) {
      router.replace(homeForRole(role));
    }
  }, [status, role, onPublicRoute, router]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      role,
      username,
      fullName,
      isActive,
      userId,
      error,
      retrying,
      refresh,
      signOut,
    }),
    [status, role, username, fullName, isActive, userId, error, retrying, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
