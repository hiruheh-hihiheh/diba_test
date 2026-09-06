import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
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
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

import { theme } from "../constants/theme";
import { getTranslations, type Language } from "../constants/translations";
import { supabase } from "../services/supabase";
import { uploadDispatchPhoto } from "../services/cloudinary";
import { createDispatch, getMaterialLabelKey, type CreateDispatchInput, type MaterialType } from "../services/dispatch";

type SubmissionState = "idle" | "uploading" | "saving" | "success" | "error";

export default function DispatchScreen() {
  const [language, setLanguage] = useState<Language>("en");
  const t = getTranslations(language);

  const [loading, setLoading] = useState(true);
  
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoAsset, setPhotoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [materialType, setMaterialType] = useState<MaterialType | null>(null);
  
  const [locationStatus, setLocationStatus] = useState<"getting" | "captured" | "unavailable">("getting");
  const [locationData, setLocationData] = useState<{ latitude: number; longitude: number; name: string } | null>(null);
  
  const [currentTime] = useState(new Date());

  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [lastDispatch, setLastDispatch] = useState<CreateDispatchInput | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setLoading(false);
    }
    checkAuth();
  }, []);

  // Reusable location capture function
  const captureLocation = useCallback(async () => {
    setLocationStatus("getting");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocationStatus("unavailable");
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      const coords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        name: "",
      };

      try {
        const reverse = await Location.reverseGeocodeAsync(coords);
        if (reverse && reverse.length > 0) {
          const r = reverse[0];
          coords.name = [r.name, r.street, r.city, r.region].filter(Boolean).join(", ");
        }
      } catch {
        // Ignore geocoding errors
      }

      setLocationData(coords);
      setLocationStatus("captured");
    } catch {
      setLocationStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      captureLocation();
    }
  }, [loading, captureLocation]);

  async function handleTakePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        setErrorMessage(t.camera_error);
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setPhotoAsset(asset);
        setPhotoUri(asset.uri);
        setErrorMessage(null);
      }
    } catch {
      setErrorMessage(t.camera_error);
    }
  }

  function handleVehicleChange(text: string) {
    // Only uppercase while typing, don't trim yet
    setVehicleNumber(text.toUpperCase());
    setErrorMessage(null);
  }

  function handleSelectMaterial(type: MaterialType) {
    setMaterialType(type);
    setErrorMessage(null);
  }

  async function handleSubmit() {
    if (!photoAsset || !photoUri) {
      setErrorMessage(t.photo_required);
      return;
    }

    // Robust upload source handling
    let uploadSource: string | Blob | null = null;
    
    if (Platform.OS === "web") {
      // On web, prefer file object if available
      uploadSource = photoAsset.file || null;
    } else {
      // On native, use URI
      uploadSource = photoUri;
    }

    if (!uploadSource) {
      setErrorMessage(t.photo_required);
      return;
    }

    // Trim vehicle number only at submission time
    const trimmedVehicleNumber = vehicleNumber.trim();
    
    if (!trimmedVehicleNumber) {
      setErrorMessage(t.vehicle_required);
      return;
    }
    
    if (!materialType) {
      setErrorMessage(t.material_required);
      return;
    }

    setErrorMessage(null);
    setSubmissionState("uploading");
    
    try {
      let uploadResult;
      try {
        uploadResult = await uploadDispatchPhoto(uploadSource);
      } catch (err) {
        console.error("Cloudinary upload error:", err);
        setErrorMessage(t.photo_upload_failed);
        setSubmissionState("error");
        return;
      }

      setSubmissionState("saving");

      const dispatchData: CreateDispatchInput = {
        vehicleNumber: trimmedVehicleNumber,
        materialType,
        photoUrl: uploadResult.secureUrl,
        photoPublicId: uploadResult.publicId,
        latitude: locationData?.latitude ?? null,
        longitude: locationData?.longitude ?? null,
        locationName: locationData?.name ?? null,
      };

      const dbResult = await createDispatch(dispatchData);

      if (!dbResult.ok) {
        console.error("Supabase insert error:", dbResult.error);
        setErrorMessage(t.dispatch_save_failed);
        setSubmissionState("error");
        return;
      }

      setLastDispatch(dispatchData);
      setSubmissionState("success");

    } catch (err) {
      console.error("Unexpected submit error:", err);
      setErrorMessage(t.check_internet);
      setSubmissionState("error");
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (submissionState === "success" && lastDispatch) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={styles.successIconContainer}>
            <Text style={styles.successIcon}>✓</Text>
          </View>
          <Text style={styles.successTitle}>{t.dispatch_submitted}</Text>
          <Text style={styles.successMessage}>{t.your_dispatch_recorded}</Text>

          <View style={styles.successDetailsCard}>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>{t.vehicle_number}</Text>
              <Text style={styles.successValue} numberOfLines={1} ellipsizeMode="tail">
                {lastDispatch.vehicleNumber}
              </Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>{t.material_type}</Text>
              <Text style={styles.successValue} numberOfLines={1}>
                {t[getMaterialLabelKey(lastDispatch.materialType)]}
              </Text>
            </View>
            {lastDispatch.locationName && (
              <View style={styles.successRow}>
                <Text style={styles.successLabel}>{t.current_location}</Text>
                <Text style={styles.successValue} numberOfLines={2} ellipsizeMode="tail">
                  {lastDispatch.locationName}
                </Text>
              </View>
            )}
          </View>

          <Pressable
            style={styles.submitBtn}
            onPress={() => router.replace("/dashboard")}
          >
            <Text style={styles.submitBtnText}>{t.back_to_dashboard}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  const materialOptions: { key: MaterialType; label: string }[] = [
    { key: "scrap", label: t.scrap_metal },
    { key: "ferrous", label: t.ferrous_metal },
    { key: "non_ferrous", label: t.non_ferrous_metal },
    { key: "other", label: t.other },
  ];

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← {t.back}</Text>
          </Pressable>
          
          <View style={styles.langSwitch}>
            <Pressable
              style={[styles.langBtn, language === "en" && styles.langBtnActive]}
              onPress={() => setLanguage("en")}
            >
              <Text style={[styles.langText, language === "en" && styles.langTextActive]}>EN</Text>
            </Pressable>
            <Pressable
              style={[styles.langBtn, language === "hi" && styles.langBtnActive]}
              onPress={() => setLanguage("hi")}
            >
              <Text style={[styles.langText, language === "hi" && styles.langTextActive]}>हिं</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.titleSection}>
          <Text style={styles.pageTitle}>{t.new_dispatch}</Text>
          <Text style={styles.pageSubtitle}>
            {language === "hi" ? "नया डिस्पैच रिकॉर्ड बनाएं" : "Create a new dispatch record"}
          </Text>
        </View>

        {/* PHOTO SECTION */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.take_photo} *</Text>
          {photoUri ? (
            <View style={styles.photoContainer}>
              <Image
                source={{ uri: photoUri }}
                style={styles.photoPreview}
                resizeMode="cover"
              />
              <Pressable style={styles.retakeBtn} onPress={handleTakePhoto}>
                <Text style={styles.retakeBtnText}>{t.retake_photo}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.takePhotoBtn} onPress={handleTakePhoto}>
              <View style={styles.takePhotoIconContainer}>
                <Text style={styles.takePhotoIcon}>📷</Text>
              </View>
              <Text style={styles.takePhotoText}>{t.take_photo}</Text>
              <Text style={styles.takePhotoSubtext}>
                {language === "hi" ? "फोटो जरूरी है" : "Photo is required"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* VEHICLE NUMBER */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.vehicle_number} *</Text>
          <TextInput
            style={styles.input}
            placeholder={t.enter_vehicle_number}
            placeholderTextColor={theme.colors.textMuted}
            value={vehicleNumber}
            onChangeText={handleVehicleChange}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
          />
          <Text style={styles.helperText}>
            {language === "hi" ? "पंजीकृत वाहन नंबर दर्ज करें" : "Enter the registered vehicle number"}
          </Text>
        </View>

        {/* MATERIAL TYPE */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.material_type} *</Text>
          <View style={styles.materialGrid}>
            {materialOptions.map((opt) => (
              <Pressable
                key={opt.key}
                style={[
                  styles.materialOption,
                  materialType === opt.key && styles.materialOptionActive,
                ]}
                onPress={() => handleSelectMaterial(opt.key)}
              >
                {materialType === opt.key && (
                  <View style={styles.checkmark}>
                    <Text style={styles.checkmarkText}>✓</Text>
                  </View>
                )}
                <Text
                  style={[
                    styles.materialOptionText,
                    materialType === opt.key && styles.materialOptionTextActive,
                  ]}
                  numberOfLines={2}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* LOCATION */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.current_location}</Text>
          <View style={styles.infoCard}>
            {locationStatus === "getting" && (
              <View style={styles.infoRow}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.infoText}>{t.getting_location}</Text>
              </View>
            )}
            {locationStatus === "captured" && (
              <View style={styles.infoRow}>
                <View style={styles.infoIconContainer}>
                  <Text style={styles.infoIcon}>✓</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoText}>{t.location_captured}</Text>
                  {locationData?.name ? (
                    <Text style={styles.infoSubtext} numberOfLines={2} ellipsizeMode="tail">
                      {locationData.name}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}
            {locationStatus === "unavailable" && (
              <View>
                <View style={styles.infoRow}>
                  <View style={styles.infoIconContainer}>
                    <Text style={styles.warningIcon}>⚠️</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoText}>{t.location_unavailable}</Text>
                    <Text style={styles.infoSubtext}>
                      {language === "hi"
                        ? "आप बिना स्थान के भी जमा कर सकते हैं"
                        : "You can still submit without location"}
                    </Text>
                  </View>
                </View>
                <Pressable style={styles.retryLocationBtn} onPress={captureLocation}>
                  <Text style={styles.retryLocationBtnText}>
                    {language === "hi" ? "स्थान पुनः प्राप्त करें" : "Retry Location"}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>

        {/* DATE & TIME */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.date_time}</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoIconContainer}>
                <Text style={styles.infoIcon}>🕒</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoText}>
                  {currentTime.toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })} • {currentTime.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <Text style={styles.infoSubtext}>{t.auto_captured}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* REVIEW */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.review_dispatch}</Text>
          <View style={styles.reviewCard}>
            <ReviewRow
              label={t.take_photo}
              value={photoUri ? "✓" : "✕"}
              valueColor={photoUri ? theme.colors.primary : theme.colors.danger}
            />
            <ReviewRow
              label={t.vehicle_number}
              value={vehicleNumber.trim() || "-"}
              valueColor={theme.colors.text}
            />
            <ReviewRow
              label={t.material_type}
              value={materialType ? t[getMaterialLabelKey(materialType)] : "-"}
              valueColor={theme.colors.text}
            />
            <ReviewRow
              label={t.current_location}
              value={locationStatus === "captured" ? "✓" : "✕"}
              valueColor={locationStatus === "captured" ? theme.colors.primary : theme.colors.textMuted}
            />
          </View>
        </View>

        {/* SUBMIT & STATES */}
        {submissionState === "uploading" || submissionState === "saving" ? (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="small" color="#FFF" />
            <Text style={styles.processingText}>
              {submissionState === "uploading" ? t.uploading_photo : t.saving_dispatch}
            </Text>
          </View>
        ) : (
          <>
            {errorMessage && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                {submissionState === "error" && (
                  <Pressable style={styles.retryBtn} onPress={handleSubmit}>
                    <Text style={styles.retryBtnText}>{t.retry}</Text>
                  </Pressable>
                )}
              </View>
            )}
            <Pressable
              style={[
                styles.submitBtn,
                submissionState !== "idle" && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={submissionState !== "idle"}
            >
              <Text style={styles.submitBtnText}>{t.submit_dispatch}</Text>
            </Pressable>
          </>
        )}
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ReviewRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor: string;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.reviewValue, { color: valueColor }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.background,
  },
  
  scrollContent: {
    padding: theme.spacing.lg,
  },
  
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.lg,
  },
  
  backBtn: {
    padding: 8,
  },
  
  backText: {
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    color: theme.colors.primary,
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
  
  titleSection: {
    marginBottom: theme.spacing.xl,
  },
  
  pageTitle: {
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    color: theme.colors.text,
    marginBottom: 4,
  },
  
  pageSubtitle: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
  },
  
  section: {
    marginBottom: theme.spacing.lg,
  },
  
  sectionLabel: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  
  sectionTitle: {
    fontSize: theme.textSizes.lg,
    fontWeight: "800",
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  
  helperText: {
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
    marginTop: 6,
  },
  
  photoContainer: {
    alignItems: "center",
  },
  
  photoPreview: {
    width: "100%",
    height: 220,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    marginBottom: theme.spacing.md,
  },
  
  retakeBtn: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  
  retakeBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  
  takePhotoBtn: {
    backgroundColor: theme.colors.surface,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderStyle: "dashed",
    borderRadius: theme.radius.lg,
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  
  takePhotoIconContainer: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: theme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.md,
  },
  
  takePhotoIcon: {
    fontSize: 32,
  },
  
  takePhotoText: {
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    color: theme.colors.primary,
    marginBottom: 4,
  },
  
  takePhotoSubtext: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
  },
  
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 16,
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    color: theme.colors.text,
    minHeight: 56,
  },
  
  materialGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  
  materialOption: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: theme.colors.surface,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 80,
    position: "relative",
  },
  
  materialOptionActive: {
    backgroundColor: theme.colors.primaryLight,
    borderColor: theme.colors.primary,
  },
  
  checkmark: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  
  checkmarkText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  
  materialOptionText: {
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
    color: theme.colors.text,
    textAlign: "center",
  },
  
  materialOptionTextActive: {
    color: theme.colors.primary,
  },
  
  infoCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 16,
  },
  
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  
  infoIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  
  infoIcon: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  
  warningIcon: {
    fontSize: 18,
  },
  
  infoText: {
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    color: theme.colors.text,
  },
  
  infoSubtext: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  
  retryLocationBtn: {
    marginTop: 12,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    alignItems: "center",
  },
  
  retryLocationBtnText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },
  
  reviewCard: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  
  reviewRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  
  reviewLabel: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    fontWeight: "500",
    flex: 1,
    marginRight: theme.spacing.md,
  },
  
  reviewValue: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    flex: 1.5,
    textAlign: "right",
  },
  
  submitBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.lg,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: theme.spacing.md,
    minHeight: 60,
  },
  
  submitBtnDisabled: {
    opacity: 0.6,
  },
  
  submitBtnText: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.lg,
    fontWeight: "800",
  },
  
  // Processing & Error
  processingContainer: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.lg,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: theme.spacing.md,
    minHeight: 60,
    flexDirection: "row",
    gap: 12,
  },
  
  processingText: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
  
  errorContainer: {
    backgroundColor: theme.colors.danger + "15",
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.danger + "30",
  },
  
  errorText: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: theme.spacing.sm,
  },
  
  retryBtn: {
    backgroundColor: theme.colors.danger,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
  },
  
  retryBtnText: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },

  // Success Screen
  successContent: {
    flex: 1,
    padding: theme.spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  
  successIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.lg,
  },
  
  successIcon: {
    fontSize: 48,
    fontWeight: "800",
    color: theme.colors.primary,
  },
  
  successTitle: {
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    textAlign: "center",
  },
  
  successMessage: {
    fontSize: theme.textSizes.md,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xl,
    textAlign: "center",
  },
  
  successDetailsCard: {
    width: "100%",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
  },
  
  successRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: theme.spacing.md,
  },
  
  successLabel: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    fontWeight: "600",
    flex: 1,
  },
  
  successValue: {
    fontSize: theme.textSizes.md,
    color: theme.colors.text,
    fontWeight: "700",
    flex: 2,
    textAlign: "right",
    marginLeft: theme.spacing.md,
  },
});