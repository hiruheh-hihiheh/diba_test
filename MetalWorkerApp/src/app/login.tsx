import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";

import { theme } from "../constants/theme";
import { getTranslations, type Language } from "../constants/translations";
import { supabase, usernameToEmail } from "../services/supabase";
import { updateLastLogin } from "../services/profile";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

export default function LoginScreen() {
  // TODO: To persist language choice across app restarts, install 
  // @react-native-async-storage/async-storage and replace this state 
  // with AsyncStorage.getItem/setItem logic.
  const [language, setLanguage] = useState<Language>("en");
  const t = getTranslations(language);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    const cleanUsername = username.trim().toLowerCase();

    if (!cleanUsername || !password) {
      setError(t.enter_username_password);
      return;
    }

    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(cleanUsername),
      password,
    });

    if (signInError) {
      const isInvalidCreds = signInError.message
        .toLowerCase()
        .includes("invalid login credentials");
      
      setError(isInvalidCreds ? t.wrong_credentials : t.something_went_wrong);
      setLoading(false);
      return;
    }

    // Update last login in the background. 
    // We do not block navigation if this fails, as the user is already authenticated.
    updateLastLogin().catch((err) => {
      console.warn("Failed to update last_login_at:", err);
    });

    router.replace("/dashboard");
    setLoading(false);
  }

  function clearErrorOnChange(text: string, setter: (v: string) => void) {
    setter(text);
    if (error) setError(null);
  }

  const togglePasswordText = showPassword
    ? language === "hi"
      ? "छिपाएँ"
      : "Hide"
    : language === "hi"
    ? "दिखाएँ"
    : "Show";

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Language Switcher */}
        <View style={styles.languageRow}>
          <TouchableOpacity
            style={[
              styles.langButton,
              language === "en" && styles.langButtonActive,
            ]}
            onPress={() => setLanguage("en")}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.langText,
                language === "en" && styles.langTextActive,
              ]}
            >
              English
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.langButton,
              language === "hi" && styles.langButtonActive,
            ]}
            onPress={() => setLanguage("hi")}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.langText,
                language === "hi" && styles.langTextActive,
              ]}
            >
              हिंदी
            </Text>
          </TouchableOpacity>
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appName}>{t.app_name}</Text>
          <Text style={styles.subtitle}>{t.login_subtitle}</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Input
            label={t.username}
            placeholder={t.enter_username}
            value={username}
            onChangeText={(text: string) => clearErrorOnChange(text, setUsername)}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <View style={styles.passwordContainer}>
            <Input
              label={t.password}
              placeholder={t.enter_password}
              value={password}
              onChangeText={(text: string) => clearErrorOnChange(text, setPassword)}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              style={styles.togglePassword}
              onPress={() => setShowPassword((prev) => !prev)}
              activeOpacity={0.7}
            >
              <Text style={styles.togglePasswordText}>{togglePasswordText}</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Button
            title={loading ? t.logging_in : t.login}
            loading={loading}
            disabled={loading}
            onPress={handleLogin}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.lg,
    justifyContent: "center",
  },
  languageRow: {
    flexDirection: "row",
    alignSelf: "flex-end",
    marginBottom: theme.spacing.xl,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 4,
  },
  langButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
  },
  langButtonActive: {
    backgroundColor: theme.colors.primary,
  },
  langText: {
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    color: theme.colors.textMuted,
  },
  langTextActive: {
    color: "#FFFFFF",
  },
  header: {
    alignItems: "center",
    marginBottom: theme.spacing.xl,
  },
  appName: {
    fontSize: 32,
    fontWeight: "800",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontSize: theme.textSizes.md,
    color: theme.colors.textMuted,
    textAlign: "center",
  },
  form: {
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
  },
  passwordContainer: {
    position: "relative",
    marginBottom: theme.spacing.md,
  },
  togglePassword: {
    position: "absolute",
    right: 12,
    top: 42, // Adjusts to align with the input text area
    padding: 8,
  },
  togglePasswordText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.md,
    textAlign: "center",
    marginBottom: theme.spacing.md,
    fontWeight: "500",
  },
});