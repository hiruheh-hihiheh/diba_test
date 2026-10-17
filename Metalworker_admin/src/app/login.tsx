import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { supabase, usernameToEmail } from "../services/supabase";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { IconButton } from "../components/ui/IconButton";
import { Input } from "../components/ui/Input";
import { Reveal } from "../components/ui/Reveal";

export default function LoginScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

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
      {/* Soft copper halos keep the empty space from feeling flat without a
          gradient dependency. They are purely decorative and ignore touches. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.haloTop} />
        <View style={styles.haloBottom} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 28,
            paddingBottom: insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Reveal style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Icon name="hammer" size={21} color={theme.colors.primaryButtonText} />
            </View>
            <View>
              <Text style={styles.brandName}>MetalWorker</Text>
              <Text style={styles.brandSub}>ADMIN CONSOLE</Text>
            </View>
          </View>

          <Text style={styles.title}>Welcome back.</Text>
          <Text style={styles.subtitle}>
            Sign in to manage bills, jobs, dispatches and your team.
          </Text>
        </Reveal>

        <Reveal delay={90} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Icon name="lock" size={17} color={theme.colors.primary} />
            </View>
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Administrator sign in</Text>
              <Text style={styles.cardHint}>Authorized accounts only</Text>
            </View>
          </View>

          <Input
            label="Username"
            icon="users"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={(text: string) => clearErrorOnChange(text, setUsername)}
            placeholder="e.g. admin"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <Input
            label="Password"
            icon="lock"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={(text: string) => clearErrorOnChange(text, setPassword)}
            placeholder="Enter your password"
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            rightAccessory={
              <IconButton
                icon={showPassword ? "eyeOff" : "eye"}
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                onPress={() => setShowPassword((prev) => !prev)}
                variant="ghost"
                size={32}
                iconSize={17}
              />
            }
          />

          {error ? (
            <View style={styles.errorBox} accessibilityLiveRegion="polite">
              <Icon name="alert" size={15} color={theme.colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            title="Sign in"
            trailingIcon="arrowRight"
            loading={loading}
            disabled={loading}
            onPress={handleLogin}
            fullWidth
          />

          <View style={styles.footerRow}>
            <Icon name="info" size={12} color={theme.colors.textMuted} />
            <Text style={styles.footerText}>
              Restricted area for authorized administrators.
            </Text>
          </View>
        </Reveal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
      overflow: "hidden",
    },
    haloTop: {
      position: "absolute",
      top: -150,
      right: -120,
      width: 330,
      height: 330,
      borderRadius: 165,
      borderWidth: 1,
      borderColor: theme.colors.primary + "30",
    },
    haloBottom: {
      position: "absolute",
      bottom: -170,
      left: -130,
      width: 310,
      height: 310,
      borderRadius: 155,
      borderWidth: 1,
      borderColor: theme.colors.primary + "1C",
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: theme.spacing.lg,
    },
    hero: { marginBottom: theme.spacing.xl },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: theme.spacing.xl,
    },
    brandMark: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: theme.colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    brandName: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "800",
      letterSpacing: -0.3,
    },
    brandSub: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1.4,
      marginTop: 1,
    },
    title: {
      color: theme.colors.text,
      fontSize: 34,
      lineHeight: 40,
      fontWeight: "800",
      letterSpacing: -1.2,
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
      marginTop: 8,
      maxWidth: 300,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      ...theme.elevation.raised,
    },
    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: theme.spacing.lg,
    },
    cardIcon: {
      width: 36,
      height: 36,
      borderRadius: 11,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    cardHeaderText: { flex: 1, minWidth: 0 },
    cardTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    cardHint: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 1,
    },
    errorBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 11,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.dangerMuted,
      borderWidth: 1,
      borderColor: theme.colors.danger + "45",
      marginBottom: theme.spacing.md,
    },
    errorText: {
      flex: 1,
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
    },
    footerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: theme.spacing.lg,
    },
    footerText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
    },
  });
