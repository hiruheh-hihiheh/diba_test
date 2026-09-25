// src/components/jobs/JobDrawingModal.tsx
import { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  Platform,
  Linking,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { theme } from "../../constants/theme";
import type { Job } from "../../types/job";
import type { JobDrawing } from "../../types/jobDrawing";
import { fetchJobDrawings, createJobDrawing, deleteJobDrawing, setPrimaryDrawing } from "../../services/jobDrawings";
import { uploadPhoto } from "../../services/cloudinary";
import { getJobTypeLabel } from "../../types/job";

interface Props {
  visible: boolean;
  onClose: () => void;
  job: Job | null;
}

export function JobDrawingModal({ visible, onClose, job }: Props) {
  const [drawings, setDrawings] = useState<JobDrawing[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (job && visible) {
      loadDrawings();
    }
  }, [job, visible]);

  async function loadDrawings() {
    if (!job) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJobDrawings(job.id);
      setDrawings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drawings.");
    } finally {
      setLoading(false);
    }
  }

  if (!job) return null;

  async function requestPermission(): Promise<boolean> {
    if (Platform.OS === "web") return true;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    return status === "granted";
  }

  async function handlePickImage() {
    setError(null);
    const granted = await requestPermission();
    if (!granted) {
      setError("Photo library permission is required.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      await doUpload(asset.uri, asset.fileName || "photo.jpg", asset.mimeType || "image/jpeg");
    }
  }

  async function doUpload(uri: string, fileName: string, mimeType: string) {
    if (!job) return;
    try {
      setUploading(true);
      setError(null);
      const { secureUrl, publicId } = await uploadPhoto(uri);
      
      const isPrimary = drawings.length === 0;

      const dbRes = await createJobDrawing({
        job_id: job.id,
        file_url: secureUrl,
        public_id: publicId,
        file_name: fileName,
        file_type: mimeType,
        version: 1,
        is_primary: isPrimary,
        received_date: new Date().toISOString().split("T")[0]
      });

      if (!dbRes.ok) {
        throw new Error(dbRes.error || "Failed to save drawing record.");
      }

      await loadDrawings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(drawingId: string) {
    Alert.alert(
      "Confirm Delete",
      "Are you sure you want to delete this drawing?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setError(null);
            try {
              const res = await deleteJobDrawing(drawingId);
              if (!res.ok) throw new Error(res.error || "Failed to delete drawing.");
              
              Alert.alert("Success", "Drawing deleted. (Cloudinary cleanup deferred).");
              await loadDrawings();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to delete.");
            }
          }
        }
      ]
    );
  }

  async function handleMakePrimary(drawingId: string) {
    if (!job) return;
    setError(null);
    try {
      const res = await setPrimaryDrawing(job.id, drawingId);
      if (!res.ok) throw new Error(res.error || "Failed to set primary.");
      await loadDrawings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set primary.");
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>Drawings for {job.job_no || "Job"}</Text>
              <Text style={styles.subtitle}>
                Type: {getJobTypeLabel(job.job_type)} | DRG: {job.drawing_status || "—"}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Form Content */}
          <ScrollView contentContainerStyle={styles.content}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.subHeader}>
              <Text style={styles.countText}>
                {drawings.length} Drawing{drawings.length === 1 ? "" : "s"}
              </Text>
            </View>

            {loading ? (
              <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 40 }} />
            ) : drawings.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🖼️</Text>
                <Text style={styles.emptyTitle}>No drawing uploaded</Text>
                <Text style={styles.emptyDesc}>
                  Upload the first drawing for this job.
                </Text>
              </View>
            ) : (
              <View style={styles.grid}>
                {drawings.map((d, index) => {
                  const isImage = d.file_type?.startsWith("image/") || d.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i);
                  
                  return (
                    <View key={d.id} style={[styles.card, d.is_primary && styles.cardPrimary]}>
                      
                      <View style={styles.previewArea}>
                        {isImage ? (
                          <Image source={{ uri: d.file_url }} style={styles.previewImage} resizeMode="cover" />
                        ) : (
                          <View style={styles.previewPlaceholder}>
                            <Text style={styles.previewPlaceholderText}>📄</Text>
                          </View>
                        )}

                        {d.is_primary && (
                          <View style={styles.primaryBadge}>
                            <Text style={styles.primaryBadgeText}>✓ PRIMARY</Text>
                          </View>
                        )}
                        
                        <View style={styles.previewActions}>
                          <Pressable 
                            style={styles.previewBtn}
                            onPress={() => Linking.openURL(d.file_url)}
                          >
                            <Text style={styles.previewBtnText}>OPEN</Text>
                          </Pressable>
                        </View>
                      </View>

                      <View style={styles.cardDetails}>
                        <Text style={styles.fileName} numberOfLines={1}>{d.file_name || `Drawing ${index + 1}`}</Text>
                        <View style={styles.fileMeta}>
                          <Text style={styles.fileMetaText}>Ver: {d.version || 1}</Text>
                          <Text style={styles.fileMetaText}>{d.received_date || "No date"}</Text>
                        </View>

                        <View style={styles.cardActions}>
                          {!d.is_primary ? (
                            <Pressable onPress={() => handleMakePrimary(d.id)}>
                              <Text style={styles.setPrimaryBtn}>Set Primary</Text>
                            </Pressable>
                          ) : (
                            <Text style={styles.isPrimaryText}>Primary</Text>
                          )}
                          
                          <Pressable onPress={() => handleDelete(d.id)}>
                            <Text style={styles.deleteBtn}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Footer actions */}
          <View style={styles.footer}>
            <Pressable 
              style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]} 
              onPress={handlePickImage}
              disabled={uploading || loading}
            >
              {uploading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.uploadBtnText}>⬆ Upload Drawing</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    height: "85%", // Tall sheet
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: theme.textSizes.lg,
    fontWeight: "800",
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
  },
  closeBtnText: {
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    color: theme.colors.textMuted,
  },
  content: {
    padding: theme.spacing.lg,
  },
  errorText: {
    color: theme.colors.danger,
    backgroundColor: theme.colors.danger + "20",
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginBottom: theme.spacing.md,
    fontSize: theme.textSizes.sm,
  },
  subHeader: {
    marginBottom: theme.spacing.md,
  },
  countText: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.md,
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  emptyDesc: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
  },
  grid: {
    gap: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  cardPrimary: {
    borderColor: theme.colors.primary,
  },
  previewArea: {
    height: 160,
    backgroundColor: "#000",
    position: "relative",
  },
  previewImage: {
    width: "100%",
    height: "100%",
    opacity: 0.8,
  },
  previewPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  previewPlaceholderText: {
    fontSize: 40,
  },
  primaryBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.sm,
  },
  primaryBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
  previewActions: {
    position: "absolute",
    bottom: 8,
    right: 8,
  },
  previewBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
  },
  previewBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  cardDetails: {
    padding: theme.spacing.md,
  },
  fileName: {
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    color: theme.colors.text,
    marginBottom: 4,
  },
  fileMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },
  fileMetaText: {
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
  },
  cardActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
  },
  setPrimaryBtn: {
    color: theme.colors.primary,
    fontWeight: "700",
    fontSize: theme.textSizes.sm,
  },
  isPrimaryText: {
    color: theme.colors.textMuted,
    fontWeight: "700",
    fontSize: theme.textSizes.sm,
  },
  deleteBtn: {
    color: theme.colors.danger,
    fontWeight: "700",
    fontSize: theme.textSizes.sm,
  },
  footer: {
    padding: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  uploadBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadBtnDisabled: {
    opacity: 0.5,
  },
  uploadBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: theme.textSizes.md,
  },
});
