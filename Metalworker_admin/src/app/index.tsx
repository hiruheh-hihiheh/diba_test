import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type { Session } from "@supabase/supabase-js";

import { AdminDashboardScreen } from "../components/screens/AdminDashboardScreen";
import { LoginScreen } from "../components/screens/LoginScreen";
import { theme } from "../constants/theme";
import { supabase } from "../services/supabase";

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={theme.colors.primary} size="large" />
      </View>
    );
  }

  return session ? (
    <AdminDashboardScreen session={session} />
  ) : (
    <LoginScreen />
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
});