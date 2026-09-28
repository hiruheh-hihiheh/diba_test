import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { supabase, usernameToEmail } from "../services/supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

export default function LoginScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordRef = useRef<TextInput>(null);

  async function handleLogin() {
    setError(null);
    const clean = username.trim().toLowerCase();

    if (!clean || !password) {
      setError("Enter username and password.");
      return;
    }

    setLoading(true);

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

    // 1. Get the authenticated user
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

    // 2. Query the profile. A single transient network/server failure must not
    //    throw a freshly-verified admin back out, so retry with backoff before
    //    giving up. Only definitive answers (auth rejection, missing profile
    //    row) sign the user out.
    let profile: { role: string; is_active: boolean } | null = null;
    let profileError: { message?: string; code?: string; status?: number } | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .single();
      const postgrestErr = res.error as
        | { message?: string; code?: string; status?: number }
        | null;

      if (!postgrestErr) {
        profile = res.data;
        break;
      }

      const status = postgrestErr.status ?? 0;
      const code = postgrestErr.code ?? "";
      const msg = (postgrestErr.message ?? "").toLowerCase();
      const definitive =
        status === 401 ||
        status === 403 ||
        code === "PGRST116" || // profile row does not exist
        msg.includes("jwt") ||
        msg.includes("no rows");

      if (definitive || attempt === 2) {
        profileError = postgrestErr;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }

    // 3. Validate the profile lookup. A definitive failure signs out; a
    //    transient one keeps the session and lets the dashboard gate (which
    //    re-verifies with retries) handle recovery.
    if (profileError) {
      const status = profileError.status ?? 0;
      const code = profileError.code ?? "";
      const msg = (profileError.message ?? "").toLowerCase();
      const definitive =
        status === 401 ||
        status === 403 ||
        code === "PGRST116" ||
        msg.includes("jwt") ||
        msg.includes("no rows");

      if (definitive) {
        await supabase.auth.signOut();
        setError("Unable to verify administrator access.");
      } else {
        // Transient after retries — keep the session and let the protected
        // gate re-verify instead of logging a valid admin out.
        router.replace("/dashboard");
      }
      setLoading(false);
      return;
    }

    if (!profile) {
      await supabase.auth.signOut();
      setError("Unable to verify administrator access.");
      setLoading(false);
      return;
    }

    // 4. Validate role
    if (profile.role !== "admin") {
      await supabase.auth.signOut();
      setError("Admin access only.");
      setLoading(false);
      return;
    }

    // 5. Validate active status
    if (!profile.is_active) {
      await supabase.auth.signOut();
      setError("Your admin account is inactive.");
      setLoading(false);
      return;
    }

    // Navigate on success. The auth-state listener in index.tsx acts as
    // a safety-net for token-refresh and deep-link edge-cases.
    router.replace("/dashboard");
    setLoading(false);
  }

  function clearErrorOnChange(text: string, setter: (v: string) => void) {
    setter(text);
    if (error) setError(null);
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          {/* ── Logo ─────────────────────────────── */}
          <View style={styles.logo}>
            <Text style={styles.logoText}>MW</Text>
          </View>

          <Text style={styles.title}>Admin Portal</Text>
          <Text style={styles.subtitle}>
            Restricted area — authorized administrators only.
          </Text>

          {/* ── Username ─────────────────────────── */}
          <Input
            label="USERNAME"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={(text: string) => clearErrorOnChange(text, setUsername)}
            placeholder="admin"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          {/* ── Password ─────────────────────────── */}
          <Input
            label="PASSWORD"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={(text: string) => clearErrorOnChange(text, setPassword)}
            placeholder="••••••••"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          <TouchableOpacity
            style={styles.togglePassword}
            onPress={() => setShowPassword((prev) => !prev)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          >
            <Text style={styles.togglePasswordText}>
              {showPassword ? "Hide password" : "Show password"}
            </Text>
          </TouchableOpacity>

          {/* ── Error ────────────────────────────── */}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* ── Submit ───────────────────────────── */}
          <Button
            title="Sign In"
            loading={loading}
            disabled={loading}
            onPress={handleLogin}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: theme.spacing.md,
  },
  logoText: {
    color: theme.colors.primaryButtonText,
    fontSize: theme.textSizes.lg,
    fontWeight: "800",
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    marginBottom: theme.spacing.lg,
  },
  togglePassword: {
    alignSelf: "flex-end",
    marginTop: -theme.spacing.sm,
    marginBottom: theme.spacing.md,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  togglePasswordText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    marginBottom: theme.spacing.md,
    textAlign: "center",
  },
});