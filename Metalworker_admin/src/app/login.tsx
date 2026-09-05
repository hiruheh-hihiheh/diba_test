import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { theme } from "../constants/theme";
import { supabase, usernameToEmail } from "../services/supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    }

    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>MW</Text>
        </View>

        <Text style={styles.title}>Metal Worker</Text>
        <Text style={styles.subtitle}>Admin Portal</Text>

        <Input
          label="USERNAME"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          placeholder="admin"
        />

        <Input
          label="PASSWORD"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title="Sign In"
          loading={loading}
          onPress={handleLogin}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
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
    color: "#FFFFFF",
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
  error: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    marginBottom: theme.spacing.md,
    textAlign: "center",
  },
});