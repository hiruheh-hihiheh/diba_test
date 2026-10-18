// src/pages/Login.tsx
//
// Admin sign-in.
//
// What was wrong and what changed:
//  * The show/hide password button had `tabIndex={-1}`, which removed it from the
//    tab order entirely — a keyboard user could never reveal the password they
//    had just typed to check it. It is focusable now, labelled, and reports its
//    pressed state.
//  * "Enter username and password." was a single error for two different
//    problems, attached to nothing. Validation is per field, marks the field, and
//    moves focus to it.
//  * "Unable to verify administrator access." was used for three unrelated
//    failures (no session, no profile row, query error) and gave the user
//    nothing to act on. Each now says what happened and what to do.
//  * "Something went wrong. Please try again." swallowed the real reason. The
//    underlying message is shown and a retry is offered.
//  * "Admin access only." did not say what the account actually is. It now
//    names the role.
//  * Sign-in is a four-step round trip (authenticate, read the session, read the
//    profile, check the role). The button reported nothing beyond "Signing in…",
//    which on a slow connection looked like a hang. The current step is shown.
//  * The card was `p-10` inside `min-h-screen items-center` with no overflow
//    handling, so on a short window the Sign In button was pushed off screen
//    with no way to scroll to it. The page scrolls now.
//  * Nothing was focused on load, so a keyboard user had to Tab from the
//    browser chrome to reach the first field.
//  * The error banner was not announced, because it mounts after the form.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  Eye,
  EyeOff,
  Hexagon,
  Shield,
  AlertTriangle,
  UserX,
  KeyRound,
} from "lucide-react";
import { supabase, usernameToEmail } from "../lib/supabase";
import { readableError } from "../utils/readableError";

type Stage = "idle" | "credentials" | "session" | "account";

const STAGE_TEXT: Record<Exclude<Stage, "idle">, string> = {
  credentials: "Checking your username and password…",
  session: "Confirming your sign-in…",
  account: "Checking administrator access…",
};

const inputCls =
  "field h-11 py-0 text-[14px] bg-bg";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const errorRef = useRef<HTMLDivElement>(null);

  const loading = stage !== "idle";
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  function validate(): boolean {
    const next: { username?: string; password?: string } = {};
    if (!username.trim()) {
      next.username = "Enter your username.";
    } else if (!/^[a-z0-9._-]{3,30}$/i.test(username.trim())) {
      next.username = "Usernames use letters, numbers, dots, underscores or hyphens.";
    }
    if (!password) {
      next.password = "Enter your password.";
    }
    setFieldErrors(next);
    if (next.username) usernameRef.current?.focus();
    else if (next.password) passwordRef.current?.focus();
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!validate()) return;

    const clean = username.trim().toLowerCase();

    try {
      setStage("credentials");
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(clean),
        password,
      });

      if (signInError) {
        setError(
          /invalid login credentials/i.test(signInError.message)
            ? "That username and password combination was not recognised. Check for typos, or ask an administrator to reset your password."
            : `Sign-in failed: ${signInError.message}`
        );
        setStage("idle");
        passwordRef.current?.select();
        return;
      }

      setStage("session");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        await supabase.auth.signOut();
        setError(
          "You signed in but the session could not be confirmed, so you have been signed back out. This is usually a connection problem — check your network and try again."
        );
        setStage("idle");
        return;
      }

      setStage("account");
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, is_active, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        await supabase.auth.signOut();
        setError(
          `Your account exists but its details could not be read: ${profileError.message}. Ask an administrator to check the profiles table.`
        );
        setStage("idle");
        return;
      }

      if (!profile) {
        await supabase.auth.signOut();
        setError(
          `“${clean}” signed in successfully, but there is no profile attached to it, so admin access cannot be granted. Ask an administrator to create the profile row.`
        );
        setStage("idle");
        return;
      }

      if (profile.role !== "admin") {
        await supabase.auth.signOut();
        setError(
          `“${clean}” is a ${profile.role === "processor" ? "processor" : "labour"} account. This portal is for administrators only — sign in through the main app instead.`
        );
        setStage("idle");
        return;
      }

      if (!profile.is_active) {
        await supabase.auth.signOut();
        setError(
          `The admin account “${clean}” has been deactivated. Reactivate it from the admin users list, or ask another administrator to do so.`
        );
        setStage("idle");
        return;
      }

      navigate("/", { replace: true });
    } catch (err) {
      setError(
        readableError(err, {
          subject: "sign-in",
          fallback:
            "Sign-in could not be completed because of an unexpected error. Please try again.",
          byKind: {
            connection:
              "Could not reach the sign-in server. Check your internet connection and try again.",
            forbidden:
              "Sign-in was rejected. Check the username and password, then try again.",
          },
        }).message
      );
      setStage("idle");
    }
  }

  return (
    <div className="min-h-dvh-fallback bg-bg flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Background: one warm wash from the copper accent and a faint grid, so the
          page has depth without a stack of blurred blobs. Both are decorative. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-[28rem] left-1/2 -translate-x-1/2 w-[62rem] h-[46rem] rounded-full bg-primary/[0.07] blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--color-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(ellipse at 50% 0%, black, transparent 72%)",
            WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black, transparent 72%)",
          }}
        />
      </div>

      <div className="w-full max-w-[27rem] relative animate-fade-in my-auto">
        <div className="bg-surface border border-border rounded-2xl p-7 sm:p-8 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.7),0_2px_8px_-2px_rgba(0,0,0,0.35)]">
          {/* Brand */}
          <div className="flex items-center gap-2.5 mb-7">
            <div className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center shadow-[0_8px_20px_-10px_rgba(201,128,82,0.9)]">
              <Hexagon size={18} className="text-[var(--theme-primary-text)]" strokeWidth={2.4} />
            </div>
            <div className="leading-none">
              <p className="text-[12px] font-bold text-text tracking-[0.16em]">METALWORKER</p>
              <p className="text-[9.5px] font-semibold text-text-muted/80 tracking-[0.18em] mt-1.5">
                ADMIN CONSOLE
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h1 className="text-[21px] font-semibold text-text tracking-[-0.02em] leading-tight">
              Sign in
            </h1>
            <p className="text-[12.5px] text-text-muted mt-1.5 leading-relaxed">
              Restricted area — administrator access only.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="label"
              >
                Username <span className="text-danger">*</span>
              </label>
              <input
                ref={usernameRef}
                id="username"
                name="username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
                required
                value={username}
                disabled={loading}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError(null);
                  setFieldErrors((p) => ({ ...p, username: undefined }));
                }}
                placeholder="admin"
                aria-invalid={fieldErrors.username ? true : undefined}
                aria-describedby={
                  fieldErrors.username ? "username-error" : "username-hint"
                }
                className={`${inputCls} ${
                  fieldErrors.username ? "border-danger focus:ring-danger" : "border-border"
                }`}
              />
              {fieldErrors.username ? (
                <p
                  id="username-error"
                  role="alert"
                  className="text-xs text-danger font-semibold mt-1.5 flex items-center gap-1.5"
                >
                  <AlertTriangle size={12} />
                  {fieldErrors.username}
                </p>
              ) : (
                <p id="username-hint" className="text-xs text-text-muted mt-1.5">
                  Lowercase letters, numbers, dots, underscores and hyphens.
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="label"
              >
                Password <span className="text-danger">*</span>
              </label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  disabled={loading}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                    setFieldErrors((p) => ({ ...p, password: undefined }));
                  }}
                  placeholder="••••••••"
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
                  className={`${inputCls} pr-14 ${
                    fieldErrors.password ? "border-danger focus:ring-danger" : "border-border"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  disabled={loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors cursor-pointer p-2 rounded-lg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {fieldErrors.password && (
                <p
                  id="password-error"
                  role="alert"
                  className="text-xs text-danger font-semibold mt-1.5 flex items-center gap-1.5"
                >
                  <AlertTriangle size={12} />
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Error — role=alert and tabIndex so screen readers announce it. */}
            {error && (
              <div
                ref={errorRef}
                role="alert"
                tabIndex={-1}
                className="flex items-start gap-3 rounded-xl border border-danger/25 bg-danger-muted px-4 py-3 text-[13px] text-danger animate-scale-in"
              >
                <Shield size={18} className="text-danger shrink-0 mt-0.5" />
                <p className="text-sm text-danger font-medium leading-relaxed">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              aria-describedby={loading ? "signin-stage" : undefined}
              className="btn btn-primary w-full justify-center h-11 text-[14px] mt-1"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <KeyRound size={18} />
                  Sign In
                </>
              )}
            </button>

            {/* Which step of the round trip is in flight. */}
            <p
              id="signin-stage"
              role="status"
              aria-live="polite"
              className={`text-xs text-text-muted text-center transition-opacity ${
                loading ? "opacity-100" : "opacity-0 h-0"
              }`}
            >
              {loading ? STAGE_TEXT[stage as Exclude<Stage, "idle">] : " "}
            </p>
          </form>

          <p className="mt-6 pt-5 border-t border-border flex items-center justify-center gap-2 text-[11px] text-text-muted">
            <UserX size={12} />
            Labour and processor users sign in through the main app.
          </p>
        </div>

        <p className="text-center text-[10.5px] text-text-muted/60 mt-5 font-medium tracking-wide">
          MetalWorker Admin v2.0 — Browser Edition
        </p>
      </div>
    </div>
  );
}
