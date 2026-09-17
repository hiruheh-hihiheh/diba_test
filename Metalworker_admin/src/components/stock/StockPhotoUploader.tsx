// src/components/stock/StockPhotoUploader.tsx
// Single-photo uploader with camera capture + gallery pick + Cloudinary upload

import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

import { theme } from "../../constants/theme";
import { uploadPhoto } from "../../services/cloudinary";

interface StockPhotoUploaderProps {
  label: string;
  photoUrl: string | null;
  onPhotoUploaded: (url: string, publicId: string) => void;
  onPhotoRemoved: () => void;
}

export function StockPhotoUploader({
  label,
  photoUrl,
  onPhotoUploaded,
  onPhotoRemoved,
}: StockPhotoUploaderProps) {
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
      setError("Camera permission is required to take photos.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await handleUpload(result.assets[0].uri);
    }
  }

  async function handlePickImage() {
    setError(null);
    const granted = await requestPermission("library");
    if (!granted) {
      setError("Photo library permission is required.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      await handleUpload(result.assets[0].uri);
    }
  }

  async function handleUpload(uri: string) {
    try {
      setUploading(true);
      setError(null);
      const { secureUrl, publicId } = await uploadPhoto(uri);
      onPhotoUploaded(secureUrl, publicId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload photo."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      {photoUrl ? (
        <View style={styles.previewContainer}>
          <Image source={{ uri: photoUrl }} style={styles.preview} />
          <View style={styles.previewActions}>
            <Pressable
              style={styles.retakeBtn}
              onPress={handleCapture}
              disabled={uploading}
            >
              <Text style={styles.retakeBtnText}>📷 Retake</Text>
            </Pressable>
            <Pressable
              style={styles.removeBtn}
              onPress={onPhotoRemoved}
              disabled={uploading}
            >
              <Text style={styles.removeBtnText}>✕ Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : (
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
              <Pressable style={styles.pickBtn} onPress={handlePickImage}>
                <Text style={styles.pickBtnIcon}>🖼️</Text>
                <Text style={styles.pickBtnText}>Gallery</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  uploadArea: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    borderStyle: "dashed",
    padding: theme.spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
  },
  buttonRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  captureBtn: {
    backgroundColor: theme.colors.primary + "20",
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    alignItems: "center",
    minWidth: 100,
  },
  captureBtnIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  captureBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  pickBtn: {
    backgroundColor: theme.colors.success + "20",
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    alignItems: "center",
    minWidth: 100,
  },
  pickBtnIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  pickBtnText: {
    color: theme.colors.success,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  uploadingState: {
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  uploadingText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },
  previewContainer: {
    borderRadius: theme.radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  preview: {
    width: "100%",
    height: 200,
    backgroundColor: theme.colors.surface,
  },
  previewActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
  },
  retakeBtn: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.primary + "15",
  },
  retakeBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  removeBtn: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.danger + "15",
  },
  removeBtnText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.xs,
    marginTop: theme.spacing.xs,
  },
});
