// src/pages/Login.tsx

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Eye, EyeOff, Hexagon, Shield } from "lucide-react";
import { supabase, usernameToEmail } from "../lib/supabase";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const clean = username.trim().toLowerCase();
    if (!clean || !password) {
      setError("Enter username and password.");
      return;
    }

    setLoading(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(clean),
        password,
      });

      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "Wrong username or password."
            : signInError.message
        );
        setLoading(false);
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        await supabase.auth.signOut();
        setError("Unable to verify administrator access.");
        setLoading(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        setError("Unable to verify administrator access.");
        setLoading(false);
        return;
      }

      if (profile.role !== "admin") {
        await supabase.auth.signOut();
        setError("Admin access only.");
        setLoading(false);
        return;
      }

      if (!profile.is_active) {
        await supabase.auth.signOut();
        setError("Your admin account is inactive.");
        setLoading(false);
        return;
      }

      navigate("/", { replace: true });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      {/* Background gradient decorations */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-60 -right-60 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-60 -left-60 w-[500px] h-[500px] bg-purple/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/[0.02] rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-[460px] relative animate-fade-in">
        {/* Card */}
        <div className="bg-surface border border-border rounded-3xl p-10 shadow-2xl shadow-black/30">
          {/* Logo */}
          <div className="flex flex-col items-center mb-10">
            <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center mb-5 shadow-xl shadow-primary/30">
              <Hexagon size={40} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold text-text tracking-tight">Admin Portal</h1>
            <p className="text-[15px] text-text-muted mt-2 text-center leading-relaxed">
              Restricted area — authorized administrators only.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block text-[12px] font-bold text-text-muted tracking-[0.1em] mb-2.5 uppercase"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="admin"
                className="
                  w-full px-5 py-3.5 rounded-xl
                  bg-bg border border-border
                  text-text text-[15px] placeholder:text-text-muted/40
                  focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
                  transition-all duration-200
                "
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-[12px] font-bold text-text-muted tracking-[0.1em] mb-2.5 uppercase"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="••••••••"
                  className="
                    w-full px-5 py-3.5 pr-14 rounded-xl
                    bg-bg border border-border
                    text-text text-[15px] placeholder:text-text-muted/40
                    focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
                    transition-all duration-200
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="
                    absolute right-4 top-1/2 -translate-y-1/2
                    text-text-muted hover:text-text
                    transition-colors cursor-pointer p-1
                  "
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-danger-muted border border-danger/20 animate-scale-in">
                <Shield size={18} className="text-danger shrink-0" />
                <p className="text-[14px] text-danger font-medium">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="
                w-full py-4 px-5 rounded-xl
                bg-primary hover:bg-primary-hover
                text-white text-[15px] font-bold
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center justify-center gap-2.5
                shadow-xl shadow-primary/25
                cursor-pointer mt-2
              "
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-[13px] text-text-muted/40 mt-8 font-medium">
          MetalWorker Admin v2.0 — Browser Edition
        </p>
      </div>
    </div>
  );
}
