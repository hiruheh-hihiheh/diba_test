import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { theme } from "../constants/theme";
import {
  supabase,
  usernameToEmail,
} from "../services/supabase";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

export default function LoginScreen() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] =
    useState<string | null>(null);

  async function handleLogin() {
    setError(null);

    const cleanUsername =
      username.trim().toLowerCase();

    if (!cleanUsername || !password) {
      setError(
        "Please enter username and password."
      );
      return;
    }

    try {
      setLoading(true);

      const {
        data,
        error: signInError,
      } =
        await supabase.auth.signInWithPassword({
          email: usernameToEmail(
            cleanUsername
          ),
          password,
        });

      if (signInError) {
        setError(
          signInError.message ===
            "Invalid login credentials"
            ? "Wrong username or password."
            : signInError.message
        );

        return;
      }

      if (!data.session) {
        setError(
          "Login failed. Please try again."
        );
        return;
      }

      // SUCCESS
      // Go directly to dashboard
      router.replace("/dashboard");

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={
        Platform.OS === "ios"
          ? "padding"
          : undefined
      }
    >
      <View style={styles.topAccent} />

      <View style={styles.content}>

        <View style={styles.header}>

          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>
              MW
            </Text>
          </View>

          <Text style={styles.title}>
            Metal Worker
          </Text>

          <Text style={styles.subtitle}>
            Sign in to your worker account
          </Text>

        </View>


        <View style={styles.form}>

          <Input
            label="Username"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            placeholder="e.g. raju"
          />

          <Input
            label="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
          />

          {error ? (
            <Text style={styles.error}>
              {error}
            </Text>
          ) : null}


          <View style={styles.buttonWrap}>

            <Button
              title="Sign In"
              loading={loading}
              onPress={handleLogin}
            />

          </View>

        </View>

      </View>
    </KeyboardAvoidingView>
  );
}


const styles = StyleSheet.create({

  screen: {
    flex: 1,
    backgroundColor:
      theme.colors.background,
  },

  topAccent: {
    height: 120,
    backgroundColor:
      theme.colors.primary,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },

  content: {
    flex: 1,
    paddingHorizontal:
      theme.spacing.lg,
    paddingTop:
      theme.spacing.xxl,
  },

  header: {
    alignItems: "center",
    marginBottom:
      theme.spacing.xl,
  },

  logoContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,

    backgroundColor:
      theme.colors.surface,

    alignItems: "center",
    justifyContent: "center",

    marginBottom:
      theme.spacing.md,

    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },

  logoText: {
    color:
      theme.colors.primary,

    fontSize: 24,
    fontWeight: "800",
  },

  title: {
    color:
      theme.colors.text,

    fontSize:
      theme.textSizes.xl,

    fontWeight: "800",
    textAlign: "center",
  },

  subtitle: {
    color:
      theme.colors.textMuted,

    fontSize:
      theme.textSizes.sm,

    textAlign: "center",

    marginTop:
      theme.spacing.xs,
  },

  form: {
    backgroundColor:
      theme.colors.surface,

    borderRadius:
      theme.radius.lg,

    padding:
      theme.spacing.lg,

    borderWidth: 1,

    borderColor:
      theme.colors.border,
  },

  buttonWrap: {
    marginTop:
      theme.spacing.sm,
  },

  error: {
    color:
      theme.colors.danger,

    fontSize:
      theme.textSizes.sm,

    marginBottom:
      theme.spacing.md,

    textAlign: "center",

    backgroundColor:
      "#FEF2F2",

    padding:
      theme.spacing.sm,

    borderRadius:
      theme.radius.sm,
  },

});