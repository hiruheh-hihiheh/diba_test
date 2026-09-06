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

      // Priority: full_name from metadata > email username > "Worker"
      const fullName = session.user.user_metadata?.full_name;
      const email = session.user.email ?? "";
      const emailUsername = email.split("@")[0];
      
      const displayName = fullName || emailUsername || "Worker";
      setUsername(displayName);

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

  // Helper function to format date nicely
  function formatDispatchDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dispatchDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const timeStr = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (dispatchDate.getTime() === today.getTime()) {
      return `${language === "hi" ? "आज" : "Today"} • ${timeStr}`;
    }
    
    if (dispatchDate.getTime() === yesterday.getTime()) {
      return `${language === "hi" ? "कल" : "Yesterday"} • ${timeStr}`;
    }

const formattedDate = date.toLocaleDateString([], {
  month: "short",
  day: "numeric",
});

return `${formattedDate} • ${timeStr}`;
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
        <View style={styles.headerTop}>
          <View style={styles.userInfo}>
            <Text style={styles.greeting}>{t.good_morning},</Text>
            <Text style={styles.username} numberOfLines={1} ellipsizeMode="tail">
              {username}
            </Text>
          </View>

          <View style={styles.headerActions}>
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
          </View>
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

      {/* STATUS */}
      <View style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <View style={styles.statusDot} />
          <Text style={styles.statusLabel}>
            {language === "hi" ? "स्थिति" : "STATUS"}
          </Text>
        </View>
        <Text style={styles.statusText}>{t.active_online}</Text>
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
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : recentDispatches.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyText}>{t.no_recent_dispatches}</Text>
          <Text style={styles.emptySub}>{t.submitted_logs_appear_here}</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {recentDispatches.map((d, index) => (
            <View
              key={d.id}
              style={[
                styles.dispatchRow,
                index === recentDispatches.length - 1 && styles.dispatchRowLast,
              ]}
            >
              <View style={styles.dispatchInfo}>
                <View style={styles.dispatchHeader}>
                  <Text
                    style={styles.dispatchVehicle}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {d.vehicle_number}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(d.status) + "20" }]}>
                    <Text
                      style={[styles.statusTextBadge, { color: getStatusColor(d.status) }]}
                      numberOfLines={1}
                    >
                      {t[getStatusLabelKey(d.status)]}
                    </Text>
                  </View>
                </View>
                <Text
                  style={styles.dispatchMaterial}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t[getMaterialLabelKey(d.material_type)]}
                </Text>
                <Text style={styles.dispatchDate}>
                  {formatDispatchDate(d.submitted_at)}
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
    marginBottom: theme.spacing.lg,
    marginTop: theme.spacing.sm,
  },

  headerTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },

  userInfo: {
    flex: 1,
    marginRight: theme.spacing.md,
  },

  greeting: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    marginBottom: 4,
  },

  username: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    textTransform: "capitalize",
  },

  headerActions: {
    alignItems: "flex-end",
  },

  langSwitch: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 3,
  },

  langBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.sm,
    minWidth: 44,
    alignItems: "center",
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
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },

  logoutText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },

  statusCard: {
    backgroundColor: theme.colors.primaryLight,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.primary + "30",
  },

  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: theme.spacing.sm,
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
    marginRight: theme.spacing.sm,
  },

  statusLabel: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.xs,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  statusText: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "800",
    marginBottom: 4,
  },

  statusSub: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    opacity: 0.8,
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

  emptyIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.md,
    opacity: 0.6,
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
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  
  dispatchRowLast: {
    borderBottomWidth: 0,
  },
  
  dispatchInfo: {
    flex: 1,
  },
  
  dispatchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  
  dispatchVehicle: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  
  dispatchMaterial: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    marginBottom: 4,
  },
  
  dispatchDate: {
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: 100,
  },
  
  statusTextBadge: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
});