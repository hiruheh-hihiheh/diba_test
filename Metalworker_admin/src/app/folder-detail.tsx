// src/app/folder-detail.tsx
// Shows folder contents with drag-and-drop.
// Header is fixed; FolderContents manages its own scroll + DnD provider.

import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "../constants/theme";
import { supabase } from "../services/supabase";
import { FolderContents } from "../components/folders/FolderContents";

export default function FolderDetailScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; name?: string | string[] }>();
  const folderId = Array.isArray(params.id) ? params.id[0] : params.id;
  const folderName = Array.isArray(params.name) ? params.name[0] : params.name;

  const [, setSessionChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      setSessionChecked(true);
    });
  }, []);

  if (!folderId) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Folder not found.</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backBtnText}>← Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {/* ── Fixed Header ── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back to Folders</Text>
        </Pressable>
        <View style={styles.headerRow}>
          <View style={styles.folderIconWrap}>
            <Text style={styles.folderIcon}>📁</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {folderName || "Folder"}
          </Text>
        </View>
      </View>

      {/* ── Folder Contents (manages its own scroll + drag-drop) ── */}
      <FolderContents folderId={folderId} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backBtn: {
    marginBottom: theme.spacing.md,
  },
  backBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  folderIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  folderIcon: {
    fontSize: 26,
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.md,
    marginBottom: theme.spacing.md,
  },
});
