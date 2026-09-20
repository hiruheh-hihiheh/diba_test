import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "../../constants/theme";
import type { GroupPhoto } from "./GroupPhotoUploader";

interface GroupPhotoPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  date: string;
  fetchPhotos: () => Promise<GroupPhoto[]>;
}

export function GroupPhotoPreviewModal({
  visible,
  onClose,
  title,
  date,
  fetchPhotos,
}: GroupPhotoPreviewModalProps) {
  const [photos, setPhotos] = useState<GroupPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      loadPhotos();
    }
  }, [visible]);

  async function loadPhotos() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchPhotos();
      setPhotos(data.sort((a, b) => a.position - b.position));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load photos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.headerSubtitle}>
                {new Date(date).toLocaleDateString([], {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                {" • "}
                {!loading && !error
                  ? `${photos.length} Photo${photos.length !== 1 ? "s" : ""}`
                  : "..."}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.loadingText}>Loading details...</Text>
            </View>
          ) : error ? (
            <View style={styles.centerContainer}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>Unable to load item details.</Text>
              <Pressable style={styles.retryBtn} onPress={loadPhotos}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : photos.length === 0 ? (
            <View style={styles.centerContainer}>
              <Text style={styles.emptyIcon}>📷</Text>
              <Text style={styles.emptyText}>
                No photos uploaded for this bill group.
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {photos.map((photo, index) => (
                <View key={photo.id || index.toString()} style={styles.photoWrapper}>
                  <Text style={styles.photoLabel}>
                    Photo #{index + 1}
                  </Text>
                  <View style={styles.imageContainer}>
                    <Image
                      source={{ uri: photo.photo_url }}
                      style={styles.image}
                      resizeMode="contain"
                    />
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end", // or center if we want it centered
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    flex: 0.9,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  headerTitleContainer: {
    flex: 1,
    marginRight: theme.spacing.md,
  },
  headerTitle: {
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: "bold",
    color: theme.colors.text,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: theme.spacing.md,
  },
  errorText: {
    fontSize: theme.textSizes.md,
    color: theme.colors.danger,
    textAlign: "center",
    marginBottom: theme.spacing.lg,
  },
  retryBtn: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.md,
  },
  retryBtnText: {
    color: "#fff",
    fontWeight: "600",
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.md,
  },
  emptyText: {
    fontSize: theme.textSizes.md,
    color: theme.colors.textMuted,
    textAlign: "center",
  },
  scrollContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
  },
  photoWrapper: {
    marginBottom: theme.spacing.xl,
  },
  photoLabel: {
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
    textTransform: "uppercase",
  },
  imageContainer: {
    width: "100%",
    aspectRatio: 3 / 4, // 3:4 aspect ratio for typical bill photos
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
