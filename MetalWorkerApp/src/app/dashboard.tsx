import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import {
  useEffect,
  useState,
} from "react";

import { useRouter } from "expo-router";

import { theme } from "../constants/theme";
import { supabase } from "../services/supabase";


export default function DashboardScreen() {

  const router = useRouter();

  const [loading, setLoading] =
    useState(true);

  const [username, setUsername] =
    useState("Worker");

  const [loggingOut, setLoggingOut] =
    useState(false);


  useEffect(() => {

    async function loadUser() {

      const {
        data: { session },
      } =
        await supabase.auth.getSession();


      if (!session) {

        router.replace("/login");

        return;
      }


      const email =
        session.user.email ?? "";


      const workerUsername =
        email.split("@")[0];


      if (workerUsername) {

        setUsername(workerUsername);

      }


      setLoading(false);
    }


    loadUser();

  }, [router]);


  async function handleLogout() {

    try {

      setLoggingOut(true);


      const { error } =
        await supabase.auth.signOut();


      if (error) {

        Alert.alert(
          "Logout Failed",
          error.message
        );

        return;
      }


      router.replace("/login");

    } catch {

      Alert.alert(
        "Error",
        "Unable to logout."
      );

    } finally {

      setLoggingOut(false);

    }

  }


  if (loading) {

    return (

      <View
        style={styles.loadingContainer}
      >

        <ActivityIndicator
          size="large"
          color={theme.colors.primary}
        />

      </View>

    );

  }


  return (

    <ScrollView
      style={styles.screen}
      contentContainerStyle={
        styles.content
      }
      showsVerticalScrollIndicator={false}
    >

      {/* HEADER */}

      <View style={styles.header}>

        <View style={styles.userInfo}>

          <Text style={styles.greeting}>
            Good Morning,
          </Text>

          <Text style={styles.username}>
            {username}
          </Text>

        </View>


        <TouchableOpacity
          onPress={handleLogout}
          disabled={loggingOut}
          style={styles.logoutButton}
        >

          <Text style={styles.logoutText}>

            {loggingOut
              ? "Logging out..."
              : "Logout"}

          </Text>

        </TouchableOpacity>

      </View>


      {/* STATUS */}

      <View style={styles.statusCard}>

        <View style={styles.statusIndicator}>

          <View style={styles.statusDot} />

          <Text style={styles.statusText}>
            Active & Online
          </Text>

        </View>

        <Text style={styles.statusSub}>
          You are ready to log dispatches.
        </Text>

      </View>


      {/* QUICK ACTIONS */}

      <Text style={styles.sectionTitle}>
        Quick Actions
      </Text>


      <View style={styles.grid}>

        <ActionCard
          title="New Dispatch"
          subtitle="Log a new metal sale"
          icon="🚛"
          primary
        />

        <ActionCard
          title="My History"
          subtitle="View past logs"
          icon="📋"
        />

        <ActionCard
          title="Scan QR"
          subtitle="Scan truck/item"
          icon="📷"
        />

        <ActionCard
          title="Profile"
          subtitle="Settings & info"
          icon="👤"
        />

      </View>


      {/* ACTIVITY */}

      <Text style={styles.sectionTitle}>
        Recent Activity
      </Text>


      <View style={styles.emptyCard}>

        <Text style={styles.emptyText}>
          No recent dispatches.
        </Text>

        <Text style={styles.emptySub}>
          Your submitted logs will appear here.
        </Text>

      </View>

    </ScrollView>

  );

}


function ActionCard({
  title,
  subtitle,
  icon,
  primary = false,
}: {
  title: string;
  subtitle: string;
  icon: string;
  primary?: boolean;
}) {

  return (

    <TouchableOpacity
      activeOpacity={0.7}

      style={[
        styles.actionCard,

        primary &&
          styles.actionCardPrimary,
      ]}
    >

      <Text style={styles.actionIcon}>
        {icon}
      </Text>


      <Text
        style={[
          styles.actionTitle,

          primary &&
            styles.actionTitlePrimary,
        ]}
      >
        {title}
      </Text>


      <Text
        style={[
          styles.actionSub,

          primary &&
            styles.actionSubPrimary,
        ]}
      >
        {subtitle}
      </Text>

    </TouchableOpacity>

  );

}


const styles = StyleSheet.create({

  screen: {
    flex: 1,
    backgroundColor:
      theme.colors.background,
  },


  content: {
    padding:
      theme.spacing.lg,

    paddingBottom:
      theme.spacing.xxl,
  },


  loadingContainer: {
    flex: 1,

    justifyContent:
      "center",

    alignItems:
      "center",

    backgroundColor:
      theme.colors.background,
  },


  header: {
    flexDirection: "row",

    alignItems: "center",

    justifyContent:
      "space-between",

    marginBottom:
      theme.spacing.lg,

    marginTop:
      theme.spacing.sm,
  },


  userInfo: {
    flex: 1,

    marginRight:
      theme.spacing.md,
  },


  greeting: {
    color:
      theme.colors.textMuted,

    fontSize:
      theme.textSizes.sm,

    fontWeight: "500",
  },


  username: {
    color:
      theme.colors.text,

    fontSize:
      theme.textSizes.xl,

    fontWeight: "800",

    marginTop: 2,

    textTransform:
      "capitalize",
  },


  logoutButton: {

    backgroundColor:
      "#FEF2F2",

    paddingHorizontal: 16,

    paddingVertical: 12,

    borderRadius: 12,

    borderWidth: 1,

    borderColor:
      "#FECACA",

    minHeight: 44,

    justifyContent:
      "center",

  },


  logoutText: {

    color:
      theme.colors.danger,

    fontSize:
      theme.textSizes.sm,

    fontWeight: "700",

  },


  statusCard: {

    backgroundColor:
      theme.colors.surface,

    borderRadius:
      theme.radius.lg,

    padding:
      theme.spacing.lg,

    borderWidth: 1,

    borderColor:
      theme.colors.border,

    marginBottom:
      theme.spacing.lg,

  },


  statusIndicator: {

    flexDirection: "row",

    alignItems: "center",

    marginBottom:
      theme.spacing.xs,

  },


  statusDot: {

    width: 8,
    height: 8,

    borderRadius: 4,

    backgroundColor:
      theme.colors.primary,

    marginRight:
      theme.spacing.sm,

  },


  statusText: {

    color:
      theme.colors.text,

    fontSize:
      theme.textSizes.md,

    fontWeight: "700",

  },


  statusSub: {

    color:
      theme.colors.textMuted,

    fontSize:
      theme.textSizes.sm,

  },


  sectionTitle: {

    color:
      theme.colors.text,

    fontSize:
      theme.textSizes.md,

    fontWeight: "700",

    marginBottom:
      theme.spacing.md,

    marginTop:
      theme.spacing.sm,

  },


  grid: {

    flexDirection: "row",

    flexWrap: "wrap",

    justifyContent:
      "space-between",

  },


  actionCard: {

    width: "48%",

    backgroundColor:
      theme.colors.surface,

    borderRadius:
      theme.radius.lg,

    padding:
      theme.spacing.md,

    borderWidth: 1,

    borderColor:
      theme.colors.border,

    marginBottom:
      theme.spacing.md,

    minHeight: 120,

    justifyContent:
      "flex-end",

  },


  actionCardPrimary: {

    backgroundColor:
      theme.colors.primary,

    borderColor:
      theme.colors.primary,

  },


  actionIcon: {

    fontSize: 26,

    marginBottom:
      theme.spacing.sm,

  },


  actionTitle: {

    color:
      theme.colors.text,

    fontSize:
      theme.textSizes.md,

    fontWeight: "700",

    marginBottom: 4,

  },


  actionTitlePrimary: {
    color: "#FFFFFF",
  },


  actionSub: {

    color:
      theme.colors.textMuted,

    fontSize:
      theme.textSizes.xs,

  },


  actionSubPrimary: {
    color: "#D1FAE5",
  },


  emptyCard: {

    backgroundColor:
      theme.colors.surface,

    borderRadius:
      theme.radius.lg,

    padding:
      theme.spacing.lg,

    borderWidth: 1,

    borderColor:
      theme.colors.border,

    alignItems:
      "center",

    paddingVertical:
      theme.spacing.xl,

  },


  emptyText: {

    color:
      theme.colors.text,

    fontSize:
      theme.textSizes.md,

    fontWeight: "600",

    marginBottom:
      theme.spacing.xs,

  },


  emptySub: {

    color:
      theme.colors.textMuted,

    fontSize:
      theme.textSizes.sm,

    textAlign: "center",

  },

});