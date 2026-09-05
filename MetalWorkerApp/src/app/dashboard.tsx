import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useCallback, useEffect, useState } from "react";

import { useRouter, useFocusEffect } from "expo-router";

import { theme } from "../constants/theme";
import { supabase } from "../services/supabase";
import { getTranslations, type Language } from "../constants/translations";
import { ActionCard } from "../components/dashboard/ActionCard";
import {
  fetchMyRecentDispatches,
  getMaterialLabelKey,
  getStatusLabelKey,
  getStatusColor,
  type Dispatch,
} from "../services/dispatch";

export default function DashboardScreen() {
  const router = useRouter();

  const [language, setLanguage] = useState<Language>("en");
  const t = getTranslations(language);

  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("Worker");
  const [loggingOut, setLoggingOut] = useState(false);

  // Recent Dispatches State
  const [recentDispatches, setRecentDispatches] = useState<Dispatch[]>([]);
  const [loadingDispatches, setLoadingDispatches] = useState(true);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const email = session.user.email ?? "";
      const workerUsername = email.split("@")[0];

      if (workerUsername) {
        setUsername(workerUsername);
      }

      setLoading(false);
    }

    loadUser();
  }, [router]);

  // Fetch recent dispatches every time the screen comes into focus
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      
      async function loadRecent() {
        setLoadingDispatches(true);
        const res = await fetchMyRecentDispatches(5);
        
        if (isActive && res.ok && res.data) {
          setRecentDispatches(res.data);
        }
        if (isActive) {
          setLoadingDispatches(false);
        }
      }
      
      loadRecent();
      
      return () => {
        isActive = false;
      };
    }, [])
  );

  async function handleLogout() {
    try {
      setLoggingOut(true);

      const { error } = await supabase.auth.signOut();

      if (error) {
        Alert.alert(t.logout_failed, error.message);
        return;
      }

      router.replace("/login");
    } catch {
      Alert.alert(t.logout_failed, t.unable_to_logout);
    } finally {
      setLoggingOut(false);
    }
  }

  function showComingSoon(enMsg: string, hiMsg: string) {
    Alert.alert(
      language === "hi" ? "जल्द आ रहा है" : "Coming Soon",
      language === "hi" ? hiMsg : enMsg
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <Text style={styles.greeting}>{t.good_morning},</Text>
          <Text style={styles.username}>{username}</Text>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.langSwitch}>
            <TouchableOpacity
              style={[styles.langBtn, language === "en" && styles.langBtnActive]}
              onPress={() => setLanguage("en")}
            >
              <Text style={[styles.langText, language === "en" && styles.langTextActive]}>
                EN
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langBtn, language === "hi" && styles.langBtnActive]}
              onPress={() => setLanguage("hi")}
            >
              <Text style={[styles.langText, language === "hi" && styles.langTextActive]}>
                हिं
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleLogout}
            disabled={loggingOut}
            style={styles.logoutButton}
          >
            <Text style={styles.logoutText}>
              {loggingOut ? t.logging_out : t.logout}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* STATUS */}
      <View style={styles.statusCard}>
        <View style={styles.statusIndicator}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>{t.active_online}</Text>
        </View>
        <Text style={styles.statusSub}>{t.ready_to_log}</Text>
      </View>

      {/* QUICK ACTIONS */}
      <Text style={styles.sectionTitle}>{t.quick_actions}</Text>

      <View style={styles.grid}>
        <ActionCard
          title={t.new_dispatch}
          subtitle={t.log_new_sale}
          icon="🚛"
          primary
          onPress={() => router.push("/dispatch")}
        />

        <ActionCard
          title={t.my_history}
          subtitle={t.view_past_logs}
          icon="📋"
          onPress={() =>
            showComingSoon(
              "Your dispatch history will appear here.",
              "आपकी पुरानी एंट्री यहाँ दिखाई देंगी।"
            )
          }
        />

        <ActionCard
          title={t.scan_qr}
          subtitle={t.scan_truck_item}
          icon="📷"
          onPress={() =>
            showComingSoon(
              "QR scanning will be available soon.",
              "QR स्कैन की सुविधा जल्द उपलब्ध होगी।"
            )
          }
        />

        <ActionCard
          title={t.profile}
          subtitle={t.settings_info}
          icon="👤"
          onPress={() =>
            showComingSoon(
              "Profile settings will be available soon.",
              "प्रोफाइल सेटिंग्स जल्द उपलब्ध होंगी।"
            )
          }
        />
      </View>

      {/* ACTIVITY */}
      <Text style={styles.sectionTitle}>{t.recent_activity}</Text>

      {loadingDispatches ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      ) : recentDispatches.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>{t.no_recent_dispatches}</Text>
          <Text style={styles.emptySub}>{t.submitted_logs_appear_here}</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {recentDispatches.map((d) => (
            <View key={d.id} style={styles.dispatchRow}>
              <View style={styles.dispatchInfo}>
                <Text style={styles.dispatchVehicle}>{d.vehicle_number}</Text>
                <Text style={styles.dispatchMaterial}>
                  {t[getMaterialLabelKey(d.material_type)]}
                </Text>
                <Text style={styles.dispatchDate}>
                  {new Date(d.submitted_at).toLocaleString()}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(d.status) + "20" }]}>
                <Text style={[styles.statusTextBadge, { color: getStatusColor(d.status) }]}>
                  {t[getStatusLabelKey(d.status)]}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
      
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },

  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },

  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.background,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.lg,
    marginTop: theme.spacing.sm,
  },

  userInfo: {
    flex: 1,
    marginRight: theme.spacing.md,
  },

  greeting: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    fontWeight: "500",
  },

  username: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    marginTop: 2,
    textTransform: "capitalize",
  },

  headerRight: {
    alignItems: "flex-end",
    gap: theme.spacing.sm,
  },

  langSwitch: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 2,
  },

  langBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
  },

  langBtnActive: {
    backgroundColor: theme.colors.primary,
  },

  langText: {
    fontSize: theme.textSizes.xs,
    fontWeight: "700",
    color: theme.colors.textMuted,
  },

  langTextActive: {
    color: "#FFFFFF",
  },

  logoutButton: {
    backgroundColor: "#FEF2F2",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
    minHeight: 44,
    justifyContent: "center",
  },

  logoutText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },

  statusCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.lg,
  },

  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.xs,
  },

  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.primary,
    marginRight: theme.spacing.sm,
  },

  statusText: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },

  statusSub: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },

  sectionTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  emptyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    paddingVertical: theme.spacing.xl,
  },

  emptyText: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    marginBottom: theme.spacing.xs,
  },

  emptySub: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
  },

  // Recent Dispatches List Styles
  listCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  dispatchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  dispatchInfo: {
    flex: 1,
  },
  dispatchVehicle: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
  },
  dispatchMaterial: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  dispatchDate: {
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: theme.spacing.md,
  },
  statusTextBadge: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
});