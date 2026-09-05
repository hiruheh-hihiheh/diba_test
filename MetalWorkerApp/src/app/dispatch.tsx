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

// Temporary fallback for keys not yet in translations.ts
const dt = (language: Language) => ({
  back: language === "hi" ? "वापस" : "Back",
  take_photo: language === "hi" ? "फोटो लें" : "Take Photo",
  retake_photo: language === "hi" ? "फोटो बदलें" : "Retake Photo",
  vehicle_number: language === "hi" ? "वाहन नंबर" : "Vehicle Number",
  enter_vehicle_number: language === "hi" ? "वाहन नंबर दर्ज करें" : "Enter vehicle number",
  material_type: language === "hi" ? "सामग्री का प्रकार" : "Material Type",
  select_material: language === "hi" ? "सामग्री चुनें" : "Select material",
  scrap_metal: language === "hi" ? "स्क्रेप धातु" : "Scrap Metal",
  ferrous_metal: language === "hi" ? "लोहे की धातु" : "Ferrous Metal",
  non_ferrous_metal: language === "hi" ? "गैर-लोहे की धातु" : "Non-Ferrous Metal",
  other: language === "hi" ? "अन्य" : "Other",
  current_location: language === "hi" ? "वर्तमान स्थान" : "Current Location",
  location_captured: language === "hi" ? "स्थान मिल गया" : "Location captured",
  getting_location: language === "hi" ? "स्थान खोजा जा रहा है..." : "Getting location...",
  location_unavailable: language === "hi" ? "स्थान नहीं मिला" : "Location unavailable",
  date_time: language === "hi" ? "दिनांक और समय" : "Date & Time",
  auto_captured: language === "hi" ? "स्वचालित रूप से लिया गया" : "Automatically captured",
  review_dispatch: language === "hi" ? "डिस्पैच की समीक्षा" : "Review Dispatch",
  submit_dispatch: language === "hi" ? "डिस्पैच जमा करें" : "Submit Dispatch",
  submitting: language === "hi" ? "जमा हो रहा है..." : "Submitting...",
  complete_required_fields: language === "hi" ? "कृपया सभी जरूरी जानकारी भरें" : "Please complete all required fields",
  photo_required: language === "hi" ? "फोटो जरूरी है" : "Photo required",
  vehicle_required: language === "hi" ? "वाहन नंबर जरूरी है" : "Vehicle number required",
  material_required: language === "hi" ? "सामग्री चुनना जरूरी है" : "Material type required",
  camera_error: language === "hi" ? "कैमरा चालू नहीं हो सका" : "Could not access camera",
  location_error: language === "hi" ? "स्थान की अनुमति नहीं मिली" : "Could not access location",
  coming_soon_title: language === "hi" ? "जल्द आ रहा है" : "Coming Soon",
  submission_coming_soon: language === "hi" ? "डिस्पैच जमा करने की सुविधा जल्द जोड़ी जाएगी।" : "Dispatch submission will be connected next.",
});

export default function DispatchScreen() {
  const [language, setLanguage] = useState<Language>("en");
  const t = getTranslations(language);
  const d = dt(language);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [materialType, setMaterialType] = useState<string | null>(null);
  
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

        // Try reverse geocoding for a human-readable name
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
        Alert.alert(t.something_went_wrong, d.camera_error);
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
      Alert.alert(t.something_went_wrong, d.camera_error);
    }
  }

  function handleVehicleChange(text: string) {
    // Normalize: uppercase and trim
    setVehicleNumber(text.toUpperCase().trim());
  }

  function handleSelectMaterial(type: string) {
    setMaterialType(type);
  }

  async function handleSubmit() {
    if (!photoUri) {
      Alert.alert(t.something_went_wrong, d.photo_required);
      return;
    }
    if (!vehicleNumber) {
      Alert.alert(t.something_went_wrong, d.vehicle_required);
      return;
    }
    if (!materialType) {
      Alert.alert(t.something_went_wrong, d.material_required);
      return;
    }

    setSubmitting(true);
    
    // Simulate network delay for UX
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setSubmitting(false);
    Alert.alert(d.coming_soon_title, d.submission_coming_soon);
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const materialOptions = [
    { key: "scrap", label: d.scrap_metal },
    { key: "ferrous", label: d.ferrous_metal },
    { key: "non_ferrous", label: d.non_ferrous_metal },
    { key: "other", label: d.other },
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
            <Text style={styles.backText}>← {d.back}</Text>
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
          <Text style={styles.sectionLabel}>{d.take_photo} *</Text>
          {photoUri ? (
            <View style={styles.photoContainer}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              <Pressable style={styles.retakeBtn} onPress={handleTakePhoto}>
                <Text style={styles.retakeBtnText}>{d.retake_photo}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.takePhotoBtn} onPress={handleTakePhoto}>
              <Text style={styles.takePhotoIcon}>📷</Text>
              <Text style={styles.takePhotoText}>{d.take_photo}</Text>
            </Pressable>
          )}
        </View>

        {/* VEHICLE NUMBER */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{d.vehicle_number} *</Text>
          <TextInput
            style={styles.input}
            placeholder={d.enter_vehicle_number}
            placeholderTextColor={theme.colors.textMuted}
            value={vehicleNumber}
            onChangeText={handleVehicleChange}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>

        {/* MATERIAL TYPE */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{d.material_type} *</Text>
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
          <Text style={styles.sectionLabel}>{d.current_location}</Text>
          <View style={styles.infoCard}>
            {locationStatus === "getting" && (
              <View style={styles.infoRow}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.infoText}>{d.getting_location}</Text>
              </View>
            )}
            {locationStatus === "captured" && (
              <View style={styles.infoRow}>
                <Text style={styles.infoIcon}>✅</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoText}>{d.location_captured}</Text>
                  {locationData?.name ? (
                    <Text style={styles.infoSubtext}>{locationData.name}</Text>
                  ) : null}
                </View>
              </View>
            )}
            {locationStatus === "unavailable" && (
              <View style={styles.infoRow}>
                <Text style={styles.infoIcon}>⚠️</Text>
                <Text style={styles.infoText}>{d.location_unavailable}</Text>
              </View>
            )}
          </View>
        </View>

        {/* DATE & TIME */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{d.date_time}</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoIcon}>🕒</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoText}>
                  {currentTime.toLocaleDateString()} {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={styles.infoSubtext}>{d.auto_captured}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* REVIEW */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{d.review_dispatch}</Text>
          <View style={styles.reviewCard}>
            <ReviewRow label={d.take_photo} value={photoUri ? "✅" : "❌"} />
            <ReviewRow label={d.vehicle_number} value={vehicleNumber || "-"} />
            <ReviewRow label={d.material_type} value={materialOptions.find(m => m.key === materialType)?.label || "-"} />
            <ReviewRow label={d.current_location} value={locationStatus === "captured" ? "✅" : "❌"} />
            <ReviewRow label={d.date_time} value={currentTime.toLocaleDateString()} />
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
            <Text style={styles.submitBtnText}>{d.submit_dispatch}</Text>
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
  
  // Photo
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

  // Input
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

  // Material
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

  // Info Cards (Location, Date)
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

  // Review
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

  // Submit
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