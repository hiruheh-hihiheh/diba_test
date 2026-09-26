// src/components/documents/GroupPhotoUploader.tsx
// Multi-photo uploader for bill/drawing groups

import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { uploadPhoto } from "../../services/cloudinary";

export interface GroupPhoto {
  id?: string;
  photo_url: string;
  photo_public_id: string;
  position: number;
}

interface GroupPhotoUploaderProps {
  photos: GroupPhoto[];
  onPhotoAdded: (url: string, publicId: string) => void;
  onPhotoRemoved: (index: number) => void;
  onPhotosReordered: (photos: GroupPhoto[]) => void;
}

export function GroupPhotoUploader({
  photos,
  onPhotoAdded,
  onPhotoRemoved,
  onPhotosReordered,
}: GroupPhotoUploaderProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestPermission(
    type: "camera" | "library"
  ): Promise<boolean> {
    if (Platform.OS === "web") return true;

    if (type === "camera") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      return status === "granted";
    } else {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      return status === "granted";
    }
  }

  async function handleCapture() {
    setError(null);
    const granted = await requestPermission("camera");
    if (!granted) {
      setError("Camera permission is required.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await doUpload(result.assets[0].uri);
    }
  }

  async function handlePickImages() {
    setError(null);
    const granted = await requestPermission("library");
    if (!granted) {
      setError("Photo library permission is required.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      for (const asset of result.assets) {
        await doUpload(asset.uri);
      }
    }
  }

  async function doUpload(uri: string) {
    try {
      setUploading(true);
      setError(null);
      const { secureUrl, publicId } = await uploadPhoto(uri);
      onPhotoAdded(secureUrl, publicId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload photo."
      );
    } finally {
      setUploading(false);
    }
  }

  function movePhoto(index: number, direction: "up" | "down") {
    const newPhotos = [...photos];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newPhotos.length) return;

    [newPhotos[index], newPhotos[targetIndex]] = [
      newPhotos[targetIndex],
      newPhotos[index],
    ];

    // Update positions
    const reordered = newPhotos.map((p, i) => ({ ...p, position: i }));
    onPhotosReordered(reordered);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>PHOTOS ({photos.length})</Text>

      {/* Photo Grid */}
      {photos.length > 0 && (
        <View style={styles.photoGrid}>
          {photos.map((photo, index) => (
            <View key={`${photo.photo_url}-${index}`} style={styles.photoCard}>
              <Image
                source={{ uri: photo.photo_url }}
                style={styles.photoThumb}
              />
              <View style={styles.photoActions}>
                <Pressable
                  onPress={() => movePhoto(index, "up")}
                  disabled={index === 0}
                  style={[
                    styles.moveBtn,
                    index === 0 && styles.moveBtnDisabled,
                  ]}
                >
                  <Text style={styles.moveBtnText}>↑</Text>
                </Pressable>
                <Text style={styles.positionText}>#{index + 1}</Text>
                <Pressable
                  onPress={() => movePhoto(index, "down")}
                  disabled={index === photos.length - 1}
                  style={[
                    styles.moveBtn,
                    index === photos.length - 1 && styles.moveBtnDisabled,
                  ]}
                >
                  <Text style={styles.moveBtnText}>↓</Text>
                </Pressable>
                <Pressable
                  onPress={() => onPhotoRemoved(index)}
                  style={styles.removePhotoBtn}
                >
                  <Text style={styles.removePhotoBtnText}>✕</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Upload buttons */}
      <View style={styles.uploadArea}>
        {uploading ? (
          <View style={styles.uploadingState}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.uploadingText}>Uploading...</Text>
          </View>
        ) : (
          <View style={styles.buttonRow}>
            <Pressable style={styles.captureBtn} onPress={handleCapture}>
              <Text style={styles.captureBtnIcon}>📷</Text>
              <Text style={styles.captureBtnText}>Camera</Text>
            </Pressable>
            <Pressable style={styles.pickBtn} onPress={handlePickImages}>
              <Text style={styles.pickBtnIcon}>🖼️</Text>
              <Text style={styles.pickBtnText}>Gallery</Text>
            </Pressable>
          </View>
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
  },
  photoGrid: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  photoCard: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  photoThumb: {
    width: 80,
    height: 80,
    backgroundColor: theme.colors.background,
  },
  photoActions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
  },
  moveBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  moveBtnDisabled: {
    opacity: 0.3,
  },
  moveBtnText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  positionText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    minWidth: 30,
    textAlign: "center",
  },
  removePhotoBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.danger + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  removePhotoBtnText: {
    color: theme.colors.danger,
    fontSize: 14,
    fontWeight: "700",
  },
  uploadArea: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderStyle: "dashed",
    padding: theme.spacing.md,
    alignItems: "center",
  },
  buttonRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  captureBtn: {
    backgroundColor: theme.colors.primary + "20",
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    alignItems: "center",
    minWidth: 90,
  },
  captureBtnIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  captureBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
  },
  pickBtn: {
    backgroundColor: theme.colors.success + "20",
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    alignItems: "center",
    minWidth: 90,
  },
  pickBtnIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  pickBtnText: {
    color: theme.colors.success,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
  },
  uploadingState: {
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  uploadingText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.xs,
    marginTop: theme.spacing.xs,
  },
});
