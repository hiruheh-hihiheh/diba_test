import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Session } from "@supabase/supabase-js";

import { theme } from "../constants/theme";
import {
  createWorkerUser,
  fetchWorkers,
} from "../services/admin";
import { supabase } from "../services/supabase";
import type { Profile } from "../types/profile";

import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";

interface AdminDashboardScreenProps {
  session: Session;
}

export function AdminDashboardScreen({
  session,
}: AdminDashboardScreenProps) {

  const [workers, setWorkers] =
    useState<Profile[]>([]);

  const [loadingList, setLoadingList] =
    useState(true);

  const [username, setUsername] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [creating, setCreating] =
    useState(false);

  const [message, setMessage] =
    useState<{
      type: "success" | "error";
      text: string;
    } | null>(null);

  const adminUsername =
    session.user.email?.split("@")[0] ??
    "admin";

  /*
    ============================
    LOAD WORKERS
    ============================
  */

  const loadWorkers = useCallback(
    async () => {

      try {
        setLoadingList(true);

        const list =
          await fetchWorkers();

        setWorkers(list);

      } catch (error) {

        setMessage({
          type: "error",
          text:
            error instanceof Error
              ? error.message
              : "Failed to load workers.",
        });

      } finally {

        setLoadingList(false);

      }
    },
    []
  );

  /*
    ============================
    INITIAL LOAD
    ============================
  */

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  /*
    ============================
    CREATE WORKER
    ============================
  */

  async function handleCreate() {

    setMessage(null);

    const cleanUsername =
      username
        .trim()
        .toLowerCase();

    /*
      FRONTEND VALIDATION
    */

    if (!cleanUsername) {

      setMessage({
        type: "error",
        text:
          "Please enter a username.",
      });

      return;
    }

    if (
      !/^[a-z0-9._-]{3,30}$/.test(
        cleanUsername
      )
    ) {

      setMessage({
        type: "error",
        text:
          "Username must be 3-30 characters and can only contain letters, numbers, dots, underscores, or hyphens.",
      });

      return;
    }

    if (cleanUsername === "admin") {

      setMessage({
        type: "error",
        text:
          "The username 'admin' is reserved.",
      });

      return;
    }

    if (password.length < 6) {

      setMessage({
        type: "error",
        text:
          "Password must contain at least 6 characters.",
      });

      return;
    }

    try {

      setCreating(true);

      const result =
        await createWorkerUser(
          cleanUsername,
          password
        );

      if (!result.ok) {

        setMessage({
          type: "error",
          text:
            result.error ??
            "Failed to create worker login.",
        });

        return;
      }

      /*
        SUCCESS
      */

      setMessage({
        type: "success",
        text:
          `Worker "${cleanUsername}" was created successfully.`,
      });

      setUsername("");
      setPassword("");

      /*
        Refresh worker list
      */

      await loadWorkers();

    } catch (error) {

      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Something went wrong.",
      });

    } finally {

      setCreating(false);

    }
  }

  /*
    ============================
    LOGOUT
    ============================
  */

  async function handleLogout() {

    const { error } =
      await supabase.auth.signOut();

    if (error) {

      Alert.alert(
        "Logout Failed",
        error.message
      );

    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >

      {/* HEADER */}

      <View style={styles.header}>

        <View style={styles.headerInfo}>

          <Text style={styles.headerTitle}>
            Admin Dashboard
          </Text>

          <Text style={styles.headerSub}>
            Signed in as {adminUsername}
          </Text>

        </View>

        <Button
          title="Logout"
          variant="ghost"
          onPress={handleLogout}
        />

      </View>


      {/* ADD WORKER */}

      <View style={styles.card}>

        <Text style={styles.cardTitle}>
          Add Worker Login
        </Text>

        <Text style={styles.cardDescription}>
          Create a username and password
          for a worker.
        </Text>

        <Input
          label="USERNAME"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          placeholder="e.g. raju"
        />

        <Input
          label="PASSWORD"
          value={password}
          onChangeText={setPassword}
          placeholder="Minimum 6 characters"
        />

        <Button
          title="Create Worker Login"
          loading={creating}
          onPress={handleCreate}
        />

        {message && (

          <Text
            style={
              message.type === "success"
                ? styles.success
                : styles.error
            }
          >
            {message.text}
          </Text>

        )}

      </View>


      {/* WORKER LIST */}

      <View style={styles.card}>

        <View style={styles.workerHeader}>

          <Text style={styles.cardTitle}>
            Workers ({workers.length})
          </Text>

          <Button
            title="Refresh"
            variant="ghost"
            onPress={loadWorkers}
          />

        </View>


        {loadingList ? (

          <Text style={styles.muted}>
            Loading workers...
          </Text>

        ) : workers.length === 0 ? (

          <Text style={styles.muted}>
            No workers yet. Create your
            first worker login above.
          </Text>

        ) : (

          workers.map((worker) => (

            <View
              key={worker.id}
              style={styles.workerRow}
            >

              <View style={styles.avatar}>

                <Text style={styles.avatarText}>
                  {worker.username
                    .charAt(0)
                    .toUpperCase()}
                </Text>

              </View>


              <View style={styles.workerInfo}>

                <Text style={styles.workerName}>
                  {worker.username}
                </Text>

                <Text style={styles.muted}>

                  Added{" "}

                  {new Date(
                    worker.created_at
                  ).toLocaleDateString()}

                </Text>

              </View>

            </View>

          ))

        )}

      </View>

    </ScrollView>
  );
}


const styles = StyleSheet.create({

  screen: {
    flex: 1,
    backgroundColor:
      theme.colors.background,
  },

  content: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },


  /* HEADER */

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },

  headerInfo: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },

  headerTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
  },

  headerSub: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginTop: 3,
  },


  /* CARD */

  card: {
    backgroundColor:
      theme.colors.surface,

    borderRadius:
      theme.radius.lg,

    borderWidth: 1,

    borderColor:
      theme.colors.border,

    padding:
      theme.spacing.md,

    marginBottom:
      theme.spacing.md,
  },

  cardTitle: {
    color: theme.colors.text,
    fontSize:
      theme.textSizes.md,
    fontWeight: "700",
  },

  cardDescription: {
    color:
      theme.colors.textMuted,

    fontSize:
      theme.textSizes.sm,

    marginTop: 4,

    marginBottom:
      theme.spacing.md,
  },


  /* MESSAGE */

  success: {
    marginTop:
      theme.spacing.sm,

    color:
      theme.colors.success,

    fontSize:
      theme.textSizes.sm,

    textAlign: "center",
  },

  error: {
    marginTop:
      theme.spacing.sm,

    color:
      theme.colors.danger,

    fontSize:
      theme.textSizes.sm,

    textAlign: "center",
  },


  /* WORKERS */

  workerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent:
      "space-between",

    marginBottom:
      theme.spacing.md,
  },

  muted: {
    color:
      theme.colors.textMuted,

    fontSize:
      theme.textSizes.sm,
  },

  workerRow: {
    flexDirection: "row",

    alignItems: "center",

    paddingVertical:
      theme.spacing.md,

    borderBottomWidth: 1,

    borderBottomColor:
      theme.colors.border,
  },

  avatar: {
    width: 44,
    height: 44,

    borderRadius: 22,

    backgroundColor:
      theme.colors.primary,

    alignItems: "center",

    justifyContent: "center",

    marginRight:
      theme.spacing.md,
  },

  avatarText: {
    color: "#FFFFFF",

    fontWeight: "700",

    fontSize: 17,
  },

  workerInfo: {
    flex: 1,
  },

  workerName: {
    color:
      theme.colors.text,

    fontSize:
      theme.textSizes.md,

    fontWeight: "600",

    marginBottom: 3,
  },

});