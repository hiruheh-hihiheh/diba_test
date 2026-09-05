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
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

import { theme } from "../constants/theme";
import { getTranslations, type Language } from "../constants/translations";
import { supabase } from "../services/supabase";
import { uploadDispatchPhoto } from "../services/cloudinary";
import { createDispatch, type MaterialType } from "../services/dispatch";

export default function DispatchScreen() {
  const [language, setLanguage] = useState<Language>("en");
  const t = getTranslations(language);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [materialType, setMaterialType] = useState<MaterialType | null>(null);
  
  const [locationStatus, setLocationStatus] = useState<"getting" | "captured" | "unavailable">("getting");
  const [locationData, setLocationData] = useState<{ latitude: number; longitude: number; name: string } | null>(null);
  
  const [currentTime, setCurrentTime] = useState(new Date());

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

  useEffect(() => {
    async function getLocation() {
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
          // Ignore geocoding errors; coordinates are still saved
        }

        setLocationData(coords);
        setLocationStatus("captured");
      } catch {
        setLocationStatus("unavailable");
      }
    }

    if (!loading) {
      getLocation();
    }
  }, [loading]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  async function handleTakePhoto() {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t.something_went_wrong, t.camera_error);
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch {
      Alert.alert(t.something_went_wrong, t.camera_error);
    }
  }

  function handleVehicleChange(text: string) {
    setVehicleNumber(text.toUpperCase().trim());
  }

  function handleSelectMaterial(type: MaterialType) {
    setMaterialType(type);
  }

  async function handleSubmit() {
    if (!photoUri) {
      Alert.alert(t.something_went_wrong, t.photo_required);
      return;
    }
    if (!vehicleNumber) {
      Alert.alert(t.something_went_wrong, t.vehicle_required);
      return;
    }
    if (!materialType) {
      Alert.alert(t.something_went_wrong, t.material_required);
      return;
    }

    setSubmitting(true);
    
    try {
      // 1. Upload to Cloudinary
      let uploadResult;
      try {
        uploadResult = await uploadDispatchPhoto(photoUri);
      } catch (err) {
        console.error("Cloudinary upload error:", err);
        Alert.alert(t.something_went_wrong, t.photo_upload_failed);
        setSubmitting(false);
        return;
      }

      // 2. Save to Supabase
      const dbResult = await createDispatch({
        vehicleNumber,
        materialType,
        photoUrl: uploadResult.secureUrl,
        photoPublicId: uploadResult.publicId,
        latitude: locationData?.latitude ?? null,
        longitude: locationData?.longitude ?? null,
        locationName: locationData?.name ?? null,
      });

      if (!dbResult.ok) {
        console.error("Supabase insert error:", dbResult.error);
        Alert.alert(t.something_went_wrong, t.dispatch_save_failed);
        setSubmitting(false);
        return;
      }

      // 3. Success
      Alert.alert(t.success_title, t.dispatch_submitted_successfully, [
        { text: "OK", onPress: () => router.replace("/dashboard") }
      ]);

    } catch (err) {
      console.error("Unexpected submit error:", err);
      Alert.alert(t.something_went_wrong, t.check_internet);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
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

        <Text style={styles.pageTitle}>{t.new_dispatch}</Text>

        {/* PHOTO SECTION */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.take_photo} *</Text>
          {photoUri ? (
            <View style={styles.photoContainer}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              <Pressable style={styles.retakeBtn} onPress={handleTakePhoto}>
                <Text style={styles.retakeBtnText}>{t.retake_photo}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.takePhotoBtn} onPress={handleTakePhoto}>
              <Text style={styles.takePhotoIcon}>📷</Text>
              <Text style={styles.takePhotoText}>{t.take_photo}</Text>
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
          />
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
                <Text
                  style={[
                    styles.materialOptionText,
                    materialType === opt.key && styles.materialOptionTextActive,
                  ]}
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
                <Text style={styles.infoIcon}>✅</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoText}>{t.location_captured}</Text>
                  {locationData?.name ? (
                    <Text style={styles.infoSubtext}>{locationData.name}</Text>
                  ) : null}
                </View>
              </View>
            )}
            {locationStatus === "unavailable" && (
              <View style={styles.infoRow}>
                <Text style={styles.infoIcon}>⚠️</Text>
                <Text style={styles.infoText}>{t.location_unavailable}</Text>
              </View>
            )}
          </View>
        </View>

        {/* DATE & TIME */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t.date_time}</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>🕒</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoText}>
                  {currentTime.toLocaleDateString()} {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
            <ReviewRow label={t.take_photo} value={photoUri ? "✅" : "❌"} />
            <ReviewRow label={t.vehicle_number} value={vehicleNumber || "-"} />
            <ReviewRow label={t.material_type} value={materialOptions.find(m => m.key === materialType)?.label || "-"} />
            <ReviewRow label={t.current_location} value={locationStatus === "captured" ? "✅" : "❌"} />
            <ReviewRow label={t.date_time} value={currentTime.toLocaleDateString()} />
          </View>
        </View>

        {/* SUBMIT */}
        <Pressable
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitBtnText}>{t.submit_dispatch}</Text>
          )}
        </Pressable>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue} numberOfLines={1}>{value}</Text>
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
    marginBottom: theme.spacing.md,
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
    padding: 2,
  },
  langBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
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
  pageTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
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
  photoContainer: {
    alignItems: "center",
  },
  photoPreview: {
    width: "100%",
    height: 200,
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
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  takePhotoIcon: {
    fontSize: 40,
    marginBottom: theme.spacing.sm,
  },
  takePhotoText: {
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 16,
    fontSize: 20,
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
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  materialOptionActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  materialOptionText: {
    fontSize: theme.textSizes.md,
    fontWeight: "700",
    color: theme.colors.text,
    textAlign: "center",
  },
  materialOptionTextActive: {
    color: "#FFFFFF",
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
  infoIcon: {
    fontSize: 20,
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  reviewLabel: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    fontWeight: "500",
    flex: 1,
  },
  reviewValue: {
    fontSize: theme.textSizes.md,
    color: theme.colors.text,
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
    opacity: 0.7,
  },
  submitBtnText: {
    color: "#FFFFFF",
    fontSize: theme.textSizes.lg,
    fontWeight: "800",
  },
});