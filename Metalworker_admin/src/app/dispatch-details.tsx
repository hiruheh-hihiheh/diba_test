// src/app/dispatch-details.tsx
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "../constants/theme";
import {
  fetchDispatchById,
  updateDispatch,
  deleteDispatch,
  getMaterialLabel,
  getStatusColor,
} from "../services/dispatch";
import type { Dispatch, DispatchStatus, MaterialType, UpdateDispatchInput } from "../types/dispatch";

export default function DispatchDetailsScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
const dispatchId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [dispatch, setDispatch] = useState<Dispatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Edit form state
  const [editVehicleNumber, setEditVehicleNumber] = useState("");
  const [editMaterialType, setEditMaterialType] = useState<MaterialType>("scrap");
  const [editLocationName, setEditLocationName] = useState("");

  const [editStatus, setEditStatus] = useState<DispatchStatus>("submitted");

  useEffect(() => {
    if (dispatchId) {
      loadDispatch();
    }
  }, [dispatchId]);

  const loadDispatch = async () => {
    if (!dispatchId) return;

    try {
      setLoading(true);
      setError(null);
      const res = await fetchDispatchById(dispatchId);

      if (res.ok && res.data) {
        setDispatch(res.data);
        setEditVehicleNumber(res.data.vehicle_number);
        setEditMaterialType(res.data.material_type);
        setEditLocationName(res.data.location_name || "");

        setEditStatus(res.data.status);
      } else {
        setError(res.error || "Failed to load dispatch");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dispatch");
    } finally {
      setLoading(false);
    }
  };

  const startEditing = () => {
    setIsEditing(true);
  };

  const cancelEditing = () => {
    if (dispatch) {
      setEditVehicleNumber(dispatch.vehicle_number);
      setEditMaterialType(dispatch.material_type);
      setEditLocationName(dispatch.location_name || "");

      setEditStatus(dispatch.status);
    }
    setIsEditing(false);
  };

  const saveChanges = async () => {
    if (!dispatch || !dispatchId) return;

    const trimmedVehicle = editVehicleNumber.trim();
    if (!trimmedVehicle) {
      Alert.alert("Validation Error", "Vehicle number is required");
      return;
    }



    try {
      setSaving(true);
      const updateData: UpdateDispatchInput = {
        vehicle_number: trimmedVehicle,
        material_type: editMaterialType,
location_name: editLocationName.trim() || null,
status: editStatus,
      };

      const res = await updateDispatch(dispatchId, updateData);

      if (res.ok) {
        Alert.alert("Success", "Dispatch updated successfully", [
          {
            text: "OK",
            onPress: () => {
              setIsEditing(false);
              loadDispatch();
            },
          },
        ]);
      } else {
        Alert.alert("Error", res.error || "Failed to update dispatch");
      }
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to update dispatch"
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete Dispatch",
      "Are you sure you want to delete this dispatch? This action cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: performDelete,
        },
      ]
    );
  };

  const performDelete = async () => {
    if (!dispatchId) return;

    try {
      setDeleting(true);
      const res = await deleteDispatch(dispatchId);

      if (res.ok) {
        Alert.alert("Success", "Dispatch deleted successfully", [
          {
            text: "OK",
            onPress: () => router.back(),
          },
        ]);
      } else {
        Alert.alert("Error", res.error || "Failed to delete dispatch");
      }
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to delete dispatch"
      );
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer} edges={["top", "left", "right"]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  if (error || !dispatch) {
    return (
      <SafeAreaView style={styles.errorContainer} edges={["top", "left", "right"]}>
        <Text style={styles.errorText}>{error || "Dispatch not found"}</Text>
        <Pressable style={styles.retryBtn} onPress={loadDispatch}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const materialOptions: { key: MaterialType; label: string }[] = [
    { key: "scrap", label: "Scrap" },
    { key: "ferrous", label: "Ferrous Metal" },
    { key: "non_ferrous", label: "Non-Ferrous Metal" },
    { key: "other", label: "Other" },
  ];

  const statusOptions: { key: DispatchStatus; label: string }[] = [
    { key: "submitted", label: "Submitted" },
    { key: "reviewed", label: "Reviewed" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* HEADER */}
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <View style={styles.headerTitleContainer}>
              <Text style={styles.headerTitle}>Dispatch Details</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          {/* PHOTO */}
          {dispatch.photo_url ? (
            <Image
              source={{ uri: dispatch.photo_url }}
              style={styles.dispatchPhoto}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.noPhotoContainer}>
              <Text style={styles.noPhotoText}>No photo available</Text>
            </View>
          )}

          {/* VIEW MODE */}
          {!isEditing ? (
            <>
              <View style={styles.detailCard}>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionTitle}>
                    Dispatch Information
                  </Text>

                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelContainer}>
                      <Text style={styles.detailIcon}>👤</Text>
                      <Text style={styles.detailLabel}>Worker</Text>
                    </View>
                    <Text style={styles.detailValue}>
                      {dispatch.worker_username}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelContainer}>
                      <Text style={styles.detailIcon}>🚛</Text>
                      <Text style={styles.detailLabel}>Vehicle Number</Text>
                    </View>
                    <Text style={styles.detailValue}>
                      {dispatch.vehicle_number}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelContainer}>
                      <Text style={styles.detailIcon}>📦</Text>
                      <Text style={styles.detailLabel}>Material</Text>
                    </View>
                    <Text style={styles.detailValue}>
                      {getMaterialLabel(dispatch.material_type)}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelContainer}>
                      <Text style={styles.detailIcon}>📍</Text>
                      <Text style={styles.detailLabel}>Location</Text>
                    </View>
                    <View style={styles.detailValueContainer}>
                      <Text style={styles.detailValue}>
                        {dispatch.location_name || "Unknown"}
                      </Text>
                      {dispatch.latitude && dispatch.longitude && (
                        <Text style={styles.detailSubValue}>
                          {dispatch.latitude.toFixed(4)},{" "}
                          {dispatch.longitude.toFixed(4)}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelContainer}>
                      <Text style={styles.detailIcon}>🕒</Text>
                      <Text style={styles.detailLabel}>Submitted At</Text>
                    </View>
                    <Text style={styles.detailValue}>
                      {formatDate(dispatch.submitted_at)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.statusCard}>
                <View style={styles.detailLabelContainer}>
                  <Text style={styles.detailIcon}>✓</Text>
                  <Text style={styles.detailLabel}>Status</Text>
                </View>
                <View
                  style={[
                    styles.statusBadgeLarge,
                    {
                      backgroundColor: getStatusColor(dispatch.status) + "20",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusTextLarge,
                      { color: getStatusColor(dispatch.status) },
                    ]}
                  >
                    {dispatch.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* ACTION BUTTONS */}
              <View style={styles.actionButtons}>
                <Pressable style={styles.editBtn} onPress={startEditing}>
                  <Text style={styles.editBtnText}>Edit Dispatch</Text>
                </Pressable>
                <Pressable
                  style={styles.deleteBtn}
                  onPress={confirmDelete}
                  disabled={deleting}
                >
                  <Text style={styles.deleteBtnText}>
                    {deleting ? "Deleting..." : "Delete Dispatch"}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              {/* EDIT MODE */}
              <View style={styles.editCard}>
                <Text style={styles.editSectionTitle}>Edit Dispatch</Text>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Vehicle Number *</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editVehicleNumber}
                    onChangeText={setEditVehicleNumber}
                    placeholder="Enter vehicle number"
                    placeholderTextColor={theme.colors.textMuted}
                    autoCapitalize="characters"
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Material Type</Text>
                  <View style={styles.materialGrid}>
                    {materialOptions.map((opt) => (
                      <Pressable
                        key={opt.key}
                        style={[
                          styles.materialOption,
                          editMaterialType === opt.key && styles.materialOptionActive,
                        ]}
                        onPress={() => setEditMaterialType(opt.key)}
                      >
                        <Text
                          style={[
                            styles.materialOptionText,
                            editMaterialType === opt.key && styles.materialOptionTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Status</Text>
                  <View style={styles.statusGrid}>
                    {statusOptions.map((opt) => (
                      <Pressable
                        key={opt.key}
                        style={[
                          styles.statusOption,
                          editStatus === opt.key && {
                            backgroundColor: getStatusColor(opt.key) + "20",
                            borderColor: getStatusColor(opt.key),
                          },
                        ]}
                        onPress={() => setEditStatus(opt.key)}
                      >
                        <Text
                          style={[
                            styles.statusOptionText,
                            editStatus === opt.key && {
                              color: getStatusColor(opt.key),
                            },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Location Name</Text>
                  <TextInput
                    style={styles.formInput}
                    value={editLocationName}
                    onChangeText={setEditLocationName}
                    placeholder="Enter location name"
                    placeholderTextColor={theme.colors.textMuted}
                  />
                </View>
              </View>

              {/* EDIT ACTION BUTTONS */}
              <View style={styles.actionButtons}>
                <Pressable
                  style={styles.saveBtn}
                  onPress={saveChanges}
                  disabled={saving}
                >
                  <Text style={styles.saveBtnText}>
                    {saving ? "Saving..." : "Save Changes"}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={cancelEditing}
                  disabled={saving}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.background,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
  },
  errorText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: theme.spacing.lg,
  },
  retryBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },

  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  keyboard: {
    flex: 1,
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
    marginBottom: theme.spacing.xl,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    color: theme.colors.primary,
    fontSize: 20,
    fontWeight: "600",
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
  },
  headerSpacer: {
    width: 40,
  },

  /* DISPATCH PHOTO */
  dispatchPhoto: {
    width: "100%",
    height: 250,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.border,
    marginBottom: theme.spacing.lg,
  },
  noPhotoContainer: {
    width: "100%",
    height: 150,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.lg,
  },
  noPhotoText: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
  },

  /* DETAIL CARD */
  detailCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  detailSection: {
    marginBottom: 0,
  },
  detailSectionTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: theme.spacing.md,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: theme.spacing.md,
  },
  detailLabelContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  detailIcon: {
    fontSize: 16,
    marginRight: theme.spacing.xs,
  },
  detailLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
  detailValue: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },
  detailValueContainer: {
    flex: 1,
    alignItems: "flex-end",
  },
  detailSubValue: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    marginTop: 2,
  },

  /* STATUS CARD */
  statusCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.lg,
  },
  statusBadgeLarge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  statusTextLarge: {
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase",
  },

  /* ACTION BUTTONS */
  actionButtons: {
    gap: theme.spacing.sm,
  },
  editBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: "center",
  },
  editBtnText: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  deleteBtn: {
    backgroundColor: theme.colors.danger + "15",
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.danger + "30",
  },
  deleteBtnText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },

  /* EDIT MODE */
  editCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
  },
  editSectionTitle: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    marginBottom: theme.spacing.md,
  },
  formField: {
    marginBottom: theme.spacing.md,
  },
  formRow: {
    flexDirection: "row",
  },
  formLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    marginBottom: 6,
  },
  formInput: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 12,
    fontSize: theme.textSizes.md,
    color: theme.colors.text,
  },
  materialGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  materialOption: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: theme.colors.background,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  materialOptionActive: {
    backgroundColor: theme.colors.primary + "20",
    borderColor: theme.colors.primary,
  },
  materialOptionText: {
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    color: theme.colors.text,
  },
  materialOptionTextActive: {
    color: theme.colors.primary,
  },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  statusOption: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: theme.colors.background,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    alignItems: "center",
  },
  statusOptionText: {
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    color: theme.colors.textMuted,
  },
  saveBtn: {
    backgroundColor: theme.colors.success,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  cancelBtn: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cancelBtnText: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
});