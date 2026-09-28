import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { LanguageSwitch } from "../components/ui/LanguageSwitch";
import { Screen } from "../components/ui/Screen";
import { supabase, usernameToEmail } from "../services/supabase";
import { updateLastLogin } from "../services/profile";
import { theme } from "../constants/theme";
import { useLanguage } from "../contexts/LanguageContext";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { readableError } from "../utils/readableError";

export default function LoginScreen() {
  const { t } = useLanguage();
  const { isOffline } = useNetworkStatus();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second tap while the first request is in flight used to fire a second
  // sign-in; this keeps the button honest as well as disabled.
  const inFlight = useRef(false);

  async function handleLogin() {
    if (inFlight.current) return;

    const cleanUsername = username.trim().toLowerCase();

    if (!cleanUsername || !password) {
      setError(t.enter_username_password);
      return;
    }

    if (isOffline) {
      setError(t.no_connection);
      return;
    }

    inFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(cleanUsername),
        password,
      });

      if (signInError || !authData.user) {
        const raw = signInError?.message ?? "";
        const isBadCreds = /invalid login credentials/i.test(raw);

        if (isBadCreds) {
          setError(t.wrong_credentials);
        } else {
          const readable = readableError(signInError);
          setError(readable.kind === "offline" ? t.no_connection : t.could_not_sign_in);
        }
        return;
      }

      // A signed-in user still needs an active, non-admin profile. Doing this
      // here means a disabled or admin account never reaches a dashboard.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError) {
        // Do not sign out: the sign-in worked and a dead connection is not a
        // reason to throw the session away.
        setError(readableError(profileError).kind === "offline" ? t.no_connection : t.could_not_sign_in);
        return;
      }

      if (!profile) {
        await supabase.auth.signOut();
        setError(t.login_failed);
        return;
      }

      if (!profile.is_active) {
        await supabase.auth.signOut();
        setError(t.account_inactive);
        return;
      }

      if (profile.role === "admin") {
        await supabase.auth.signOut();
        setError(t.admin_login_unsupported);
        return;
      }

      // Best-effort: a missing RLS policy here must not block the sign-in.
      void updateLastLogin();
    } catch {
      setError(t.could_not_sign_in);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <Screen scroll center keyboardAware testID="login-screen">
      <View style={styles.top}>
        <LanguageSwitch />
      </View>

      <View style={styles.brand}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>MW</Text>
        </View>
        <Text style={styles.appName}>{t.app_name}</Text>
        <Text style={styles.subtitle}>{t.login_subtitle}</Text>
      </View>

      <View style={styles.form}>
        <Input
          label={t.username}
          value={username}
          onChangeText={(next) => {
            setUsername(next);
            // Clear the error as soon as the worker starts fixing it, rather
            // than leaving a stale red box under the field.
            if (error) setError(null);
          }}
          placeholder={t.enter_username}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          editable={!loading}
          hint={t.username_help}
        />

        <Input
          label={t.password}
          value={password}
          onChangeText={(next) => {
            setPassword(next);
            if (error) setError(null);
          }}
          placeholder={t.enter_password}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          secureTextEntry={!showPassword}
          editable={!loading}
          returnKeyType="go"
          onSubmitEditing={handleLogin}
          accessory={
            <Pressable
              onPress={() => setShowPassword((prev) => !prev)}
              // 48x48 so the toggle is not a 35px sliver beside the field.
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? t.hide_password : t.show_password}
              accessibilityState={{ selected: showPassword }}
              style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
            >
              <Text style={styles.toggleText}>{showPassword ? "🙈" : "👁"}</Text>
            </Pressable>
          }
        />

        {error ? (
          <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button
          title={loading ? t.logging_in : t.login}
          onPress={handleLogin}
          loading={loading}
          disabled={loading || (!username.trim() && !password)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingTop: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  brand: { alignItems: "center", marginBottom: theme.spacing.xl },
  logo: {
    width: 68,
    height: 68,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.md,
  },
  logoText: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.xl,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  appName: {
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: theme.spacing.lg,
    lineHeight: 19,
  },
  form: { width: "100%" },
  toggle: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -6,
  },
  togglePressed: { opacity: 0.6 },
  toggleText: { fontSize: 18 },
  errorBox: {
    backgroundColor: theme.colors.danger + "12",
    borderWidth: 1,
    borderColor: theme.colors.danger + "33",
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    lineHeight: 19,
  },
});
