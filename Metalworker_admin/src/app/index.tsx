import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../services/supabase";

/**
 * Splash / boot gate.
 *
 * The session is now persisted in AsyncStorage (see services/supabase.ts), so a
 * returning admin arrives here with a stored session instead of a blank slate.
 * This screen waits for `getSession()` — which reads (and, if needed, refreshes)
 * that persisted session — before deciding where to go. It must never send
 * someone to /login just because the read has not finished yet.
 *
 * A storage read can fail on a damaged/locked device. That used to leave the
 * spinner up forever, so a failed read is retried a couple of times and only
 * then treated as "no session". Nothing is deleted from storage at any point.
 */
export default function Index() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [loading, setLoading] = useState(true);
  const navigatedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const go = (target: "/dashboard" | "/login") => {
      if (!mounted || navigatedRef.current) return;
      navigatedRef.current = true;
      router.replace(target);
      setLoading(false);
    };

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function checkSession() {
      // Retry a *failed* read (storage error), never a successful "no session".
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!mounted) return;
          go(session ? "/dashboard" : "/login");
          return;
        } catch {
          if (!mounted) return;
          if (attempt < 2) await sleep(400 * (attempt + 1));
        }
      }

      // The session could not be read at all. Login is the only safe screen;
      // a later explicit sign-in replaces any unreadable state with a new one.
      go("/login");
    }

    void checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_OUT") {
        go("/login");
      } else if (session && event !== "TOKEN_REFRESHED") {
        // INITIAL_SESSION / SIGNED_IN while the splash is still resolving.
        go("/dashboard");
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return null;
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
});

