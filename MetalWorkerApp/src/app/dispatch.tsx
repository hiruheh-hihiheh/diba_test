import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as Linking from "expo-linking";

import { AppHeader } from "../components/ui/AppHeader";
import { Button } from "../components/ui/Button";
import { Card, Section } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input } from "../components/ui/Input";
import { NetworkBanner } from "../components/ui/NetworkBanner";
import { Screen } from "../components/ui/Screen";
import { useToast } from "../components/ui/Toast";
import { MaterialTypePicker } from "../components/dispatch/MaterialTypePicker";
import { PhotoPicker } from "../components/dispatch/PhotoPicker";
import { SessionGate } from "../components/SessionGate";
import { useLanguage } from "../contexts/LanguageContext";
import { format } from "../constants/translations";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import {
  createDispatch,
  getMaterialLabelKey,
  type CreateDispatchInput,
  type MaterialType,
} from "../services/dispatch";
import { uploadDispatchPhoto, type CloudinaryUploadResult } from "../services/cloudinary";
import { clockLabel, timeLabel } from "../utils/dateFormat";
import { readableError } from "../utils/readableError";
import { theme } from "../constants/theme";

type Phase = "form" | "submitting" | "success";
type LocationState =
  | { kind: "getting" }
  | { kind: "captured"; latitude: number; longitude: number; name: string | null }
  | { kind: "unavailable"; canAskAgain: boolean };

type FieldKey = "photo" | "vehicle" | "material";

export default function DispatchScreen() {
  return (
    <SessionGate allow={["worker"]}>
      <DispatchForm />
    </SessionGate>
  );
}

function DispatchForm() {
  const { t } = useLanguage();
  const { isOffline } = useNetworkStatus();
  const toast = useToast();

  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [materialType, setMaterialType] = useState<MaterialType | null>(null);
  const [location, setLocation] = useState<LocationState>({ kind: "getting" });

  const [phase, setPhase] = useState<Phase>("form");
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<CreateDispatchInput | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [locationPrompt, setLocationPrompt] = useState(false);

  const vehicleRef = useRef<TextInput>(null);
  const scrollerRef = useRef<ScrollView>(null);
  const submitInFlight = useRef(false);

  /** True once the worker has confirmed a discard, so the guard stands down. */
  const leavingRef = useRef(false);

  /** Measured from the real layout so "jump to the bad field" is exact. */
  const fieldOffsets = useRef<Partial<Record<FieldKey, number>>>({});

  /**
   * Cached Cloudinary result for the *current* photo.
   *
   * Before, a failed database insert on a weak connection re-uploaded the whole
   * image on every retry and left an orphan asset behind each time. Caching
   * means a retry only re-runs the insert.
   */
  const uploadedRef = useRef<{ uri: string; result: CloudinaryUploadResult } | null>(null);

  const [now, setNow] = useState(() => new Date());

  // ---- location -----------------------------------------------------------
  const captureLocation = useCallback(async () => {
    setLocation({ kind: "getting" });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocation({ kind: "unavailable", canAskAgain: permission.canAskAgain });
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      let name: string | null = null;
      try {
        const reverse = await Location.reverseGeocodeAsync({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        if (reverse?.length) {
          const r = reverse[0];
          name = [r.name, r.street, r.city, r.region].filter(Boolean).join(", ") || null;
        }
      } catch {
        // Geocoding is a nice-to-have; raw coordinates are still useful.
      }

      setLocation({
        kind: "captured",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        name,
      });
    } catch {
      setLocation({ kind: "unavailable", canAskAgain: true });
    }
  }, []);

  useEffect(() => {
    void captureLocation();
  }, [captureLocation]);

  // ---- ticking clock ------------------------------------------------------
  // The old screen froze this at mount via `useState(new Date())`, so a form
  // left open for an hour displayed an hour-stale time.
  useEffect(() => {
    if (phase !== "form") return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ---- validation ---------------------------------------------------------
  const missing = useMemo(() => {
    const list: FieldKey[] = [];
    if (!photoUri) list.push("photo");
    if (!vehicleNumber.trim()) list.push("vehicle");
    if (!materialType) list.push("material");
    return list;
  }, [photoUri, vehicleNumber, materialType]);

  const isDirty = Boolean(photoUri) || vehicleNumber.trim().length > 0 || materialType !== null;
  const busy = phase === "submitting";

  const fieldError = (key: FieldKey): string | null => {
    if (!showErrors || !missing.includes(key)) return null;
    switch (key) {
      case "photo":
        return t.photo_required;
      case "vehicle":
        return t.vehicle_required;
      case "material":
        return t.material_required;
    }
  };

  const scrollToField = useCallback((key: FieldKey, focus = false) => {
    const y = fieldOffsets.current[key];
    if (typeof y === "number") {
      scrollerRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }
    if (focus && key === "vehicle") {
      // Let the scroll settle before raising the keyboard, otherwise the two
      // fight and the field ends up half-hidden behind it.
      setTimeout(() => vehicleRef.current?.focus(), 220);
    }
  }, []);

  // ---- leaving ------------------------------------------------------------
  /**
   * `back()` is a documented no-op when there is nothing behind the current
   * screen, and `/dispatch` can be entered directly (deep link, cold start, a
   * notification). A Back button that silently does nothing is a dead end, so
   * fall back to the dashboard in that case.
   */
  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace("/dashboard");
  }

  // ---- unsaved changes ----------------------------------------------------
  // Catches the Android hardware back gesture as well as the header button.
  //
  // `leavingRef` is the part that matters. Once the worker has confirmed they
  // want to discard, this guard has to stand down — otherwise the navigation we
  // trigger is intercepted by this very hook, the dialog springs open again, and
  // the worker is stuck on a form they no longer want, pressing Back forever.
  usePreventRemove(isDirty && phase === "form" && !leavingRef.current, () => {
    setConfirmingLeave(true);
  });

  /** Header Back. Asks first only when there is genuinely something to lose. */
  function requestLeave() {
    if (!isDirty || phase !== "form") {
      leave();
      return;
    }
    setConfirmingLeave(true);
  }

  function confirmLeave() {
    setConfirmingLeave(false);
    leavingRef.current = true;
    // Deliberately `router.back()` rather than re-dispatching the captured
    // action: dispatching the raw GO_BACK did nothing under expo-router's
    // history, so "Discard" closed the dialog but left the worker on the form
    // with their data still filled in.
    leave();
  }

  // ---- submit -------------------------------------------------------------
  async function handleSubmit() {
    if (submitInFlight.current) return;

    if (missing.length > 0) {
      setShowErrors(true);
      setSubmitError(null);
      scrollToField(missing[0], true);
      return;
    }

    if (isOffline) {
      setSubmitError(t.offline_cannot_submit);
      return;
    }

    submitInFlight.current = true;
    setPhase("submitting");
    setSubmitError(null);

    try {
      const uri = photoUri!;
      let result: CloudinaryUploadResult;

      const cached = uploadedRef.current;
      if (cached && cached.uri === uri) {
        // Same photo, already uploaded: skip straight to the insert.
        result = cached.result;
      } else {
        // On web the picker hands back a real `File`; natively it is a URI.
        const source: string | Blob =
          Platform.OS === "web" ? ((asset?.file as Blob | undefined) ?? uri) : uri;

        try {
          result = await uploadDispatchPhoto(source);
        } catch (err) {
          setPhase("form");
          setSubmitError(
            readableError(err).kind === "offline" ? t.offline_cannot_upload : t.photo_upload_failed,
          );
          return;
        }
        uploadedRef.current = { uri, result };
      }

      const payload: CreateDispatchInput = {
        vehicleNumber: vehicleNumber.trim(),
        materialType: materialType!,
        photoUrl: result.secureUrl,
        photoPublicId: result.publicId,
        latitude: location.kind === "captured" ? location.latitude : null,
        longitude: location.kind === "captured" ? location.longitude : null,
        locationName: location.kind === "captured" ? location.name : null,
      };

      const saved = await createDispatch(payload);

      if (!saved.ok) {
        // The upload stays cached, so retrying does not re-send the image.
        setPhase("form");
        setSubmitError(
          readableError(saved.error).kind === "offline" ? t.no_connection : t.dispatch_save_failed,
        );
        return;
      }

      setSubmitted(payload);
      setSubmittedAt(new Date().toISOString());
      setPhase("success");
    } catch {
      setPhase("form");
      setSubmitError(t.dispatch_save_failed);
    } finally {
      submitInFlight.current = false;
    }
  }

  function clearSubmitError() {
    if (submitError) setSubmitError(null);
  }

  function resetForm() {
    setAsset(null);
    setPhotoUri(null);
    setVehicleNumber("");
    setMaterialType(null);
    setShowErrors(false);
    setSubmitError(null);
    setSubmitted(null);
    setSubmittedAt(null);
    setPhase("form");
    // The cached upload belongs to the previous photo; dropping it is what
    // stops the next dispatch from reusing the old image.
    uploadedRef.current = null;
    scrollerRef.current?.scrollTo({ y: 0, animated: false });
    void captureLocation();
  }

  // ---- success ------------------------------------------------------------
  if (phase === "success" && submitted) {
    return (
      <Screen
        scroll
        center
        footer={
          <View style={styles.footerStack}>
            {/* A worker logging a whole shift should not have to walk back
                through the dashboard for every single load. */}
            <Button title={t.log_another} onPress={resetForm} />
            <Button
              title={t.back_to_dashboard}
              onPress={() => {
                setSubmitted(null);
                uploadedRef.current = null;
                // `replace`, so hardware Back cannot land on a stale form.
                router.replace("/dashboard");
              }}
              variant="outline"
            />
          </View>
        }
      >
        <View style={styles.successBlock}>
          <View style={styles.successIcon}>
            <Text style={styles.successIconText}>✓</Text>
          </View>
          <Text style={styles.successTitle} accessibilityRole="header">
            {t.dispatch_submitted}
          </Text>
          <Text style={styles.successMessage}>{t.your_dispatch_recorded}</Text>

          <Card>
            <SummaryRow label={t.vehicle_number} value={submitted.vehicleNumber} />
            <SummaryRow label={t.material_type} value={t[getMaterialLabelKey(submitted.materialType)]} />
            {submitted.locationName ? (
              <SummaryRow label={t.current_location} value={submitted.locationName} />
            ) : null}
            {submittedAt ? (
              <SummaryRow label={t.submitted_at_label} value={timeLabel(submittedAt)} />
            ) : null}
          </Card>
        </View>
      </Screen>
    );
  }

  // ---- form ---------------------------------------------------------------
  const locationBlocked = location.kind === "unavailable" && !location.canAskAgain;

  return (
    <Screen
      scroll={false}
      keyboardAware
      footer={
        <View>
          {showErrors && missing.length > 0 ? (
            <View
              style={styles.alert}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              <Text style={styles.alertTitle}>
                {format(t.fields_missing, { count: missing.length })}
              </Text>
              <Text style={styles.alertBody}>{t.fix_fields_hint}</Text>
            </View>
          ) : null}

          {submitError ? (
            <View
              style={styles.alert}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              <Text style={styles.alertBody}>{submitError}</Text>
            </View>
          ) : null}

          <Button
            title={busy ? t.submitting : t.submit_dispatch}
            onPress={handleSubmit}
            loading={busy}
            // Only the busy state disables this. Previously the button was
            // disabled for any non-"idle" state, so after one failed submit
            // the worker could never try again and the Retry button had
            // already been unmounted with the error message.
            disabled={busy}
          />
        </View>
      }
    >
      <ScrollView
        ref={scrollerRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader title={t.new_dispatch} subtitle={t.log_new_sale} onBack={requestLeave} />

        {isOffline ? <NetworkBanner t={t} /> : null}

        {/* ---------------- photo ---------------- */}
        <View onLayout={(e) => void (fieldOffsets.current.photo = e.nativeEvent.layout.y)}>
          <Section title={t.photo_label} badge={{ label: t.required_label, tone: "required" }}>
            <PhotoPicker
              asset={asset}
              uri={photoUri}
              onChange={(nextAsset, nextUri) => {
                setAsset(nextAsset);
                setPhotoUri(nextUri);
                // A new photo invalidates any earlier upload.
                uploadedRef.current = null;
                if (showErrors && nextUri) setShowErrors(false);
                clearSubmitError();
              }}
              t={t}
              error={fieldError("photo")}
              disabled={busy}
            />
          </Section>
        </View>

        {/* ---------------- vehicle ---------------- */}
        <View onLayout={(e) => void (fieldOffsets.current.vehicle = e.nativeEvent.layout.y)}>
          <Section title={t.vehicle_number} badge={{ label: t.required_label, tone: "required" }}>
            <Input
              ref={vehicleRef}
              value={vehicleNumber}
              onChangeText={(next) => {
                setVehicleNumber(next.toUpperCase());
                if (showErrors && next.trim()) setShowErrors(false);
                clearSubmitError();
              }}
              placeholder={t.enter_vehicle_number}
              autoCapitalize="characters"
              autoCorrect={false}
              // Stops the OS injecting smart quotes or dashes into a plate.
              autoComplete="off"
              spellCheck={false}
              textContentType="none"
              returnKeyType="done"
              editable={!busy}
              error={fieldError("vehicle")}
              containerStyle={styles.flush}
            />
          </Section>
        </View>

        {/* ---------------- material ---------------- */}
        <View onLayout={(e) => void (fieldOffsets.current.material = e.nativeEvent.layout.y)}>
          <Section
            title={t.material_type}
            badge={{ label: t.required_label, tone: "required" }}
            hint={t.select_material}
          >
            <MaterialTypePicker
              value={materialType}
              onChange={(next) => {
                setMaterialType(next);
                if (showErrors) setShowErrors(false);
                clearSubmitError();
              }}
              t={t}
              disabled={busy}
              invalid={Boolean(fieldError("material"))}
            />
          </Section>
        </View>

        {/* ---------------- location (optional) ---------------- */}
        <Section
          title={t.current_location}
          badge={{ label: t.optional, tone: "optional" }}
          hint={t.location_permission_body}
        >
          <View style={styles.locationRow}>
            <View style={styles.locationText}>
              <Text style={styles.locationValue}>
                {location.kind === "getting"
                  ? t.getting_location
                  : location.kind === "captured"
                    ? (location.name ?? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`)
                    : t.location_unavailable}
              </Text>
              {location.kind === "captured" && location.name ? (
                <Text style={styles.locationCoords}>
                  {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                </Text>
              ) : null}
            </View>

            {location.kind !== "getting" ? (
              <Pressable
                onPress={() => {
                  // Once the OS prompt is permanently blocked, the only route is
                  // Settings — say so instead of re-requesting into a wall.
                  if (locationBlocked) setLocationPrompt(true);
                  else void captureLocation();
                }}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={locationBlocked ? t.open_settings : t.refresh}
                style={({ pressed }) => [styles.locationAction, pressed && styles.pressed]}
              >
                <Text style={styles.locationActionText}>
                  {locationBlocked ? t.open_settings : t.refresh}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Section>

        {/* ---------------- review ---------------- */}
        <Section title={t.review_dispatch} hint={t.tap_to_edit}>
          <Card style={styles.reviewCard}>
            <ReviewRow
              label={t.photo_label}
              ok={Boolean(photoUri)}
              required
              onPress={() => scrollToField("photo")}
            />
            <ReviewRow
              label={t.vehicle_number}
              value={vehicleNumber.trim() || undefined}
              ok={Boolean(vehicleNumber.trim())}
              required
              onPress={() => scrollToField("vehicle", true)}
            />
            <ReviewRow
              label={t.material_type}
              value={materialType ? t[getMaterialLabelKey(materialType)] : undefined}
              ok={Boolean(materialType)}
              required
              onPress={() => scrollToField("material")}
            />
            <ReviewRow
              label={t.current_location}
              value={location.kind === "captured" ? (location.name ?? t.location_captured) : undefined}
              ok={location.kind === "captured"}
              // Location is genuinely optional. The old checklist drew a grey
              // cross for it, which read as a failure.
              onPress={() => void captureLocation()}
            />
          </Card>
        </Section>

        {/* ---------------- date and time ---------------- */}
        <Section title={t.date_time} hint={t.auto_captured}>
          <Card>
            <Text style={styles.clock} accessibilityLiveRegion="polite">
              {clockLabel(now)}
            </Text>
          </Card>
        </Section>
      </ScrollView>

      <ConfirmDialog
        visible={confirmingLeave}
        title={t.discard_title}
        body={t.discard_body}
        confirmLabel={t.discard}
        cancelLabel={t.keep_editing}
        onConfirm={confirmLeave}
        onCancel={() => setConfirmingLeave(false)}
        destructive
      />

      <ConfirmDialog
        visible={locationPrompt}
        title={t.location_permission_title}
        body={t.location_permission_body}
        confirmLabel={t.open_settings}
        cancelLabel={t.cancel}
        onConfirm={async () => {
          setLocationPrompt(false);
          try {
            await Linking.openSettings();
          } catch {
            toast.show(t.something_went_wrong, "error");
          }
        }}
        onCancel={() => setLocationPrompt(false)}
      />
    </Screen>
  );
}

function ReviewRow({
  label,
  value,
  ok,
  required = false,
  onPress,
}: {
  label: string;
  value?: string;
  ok: boolean;
  required?: boolean;
  onPress?: () => void;
}) {
  const { t } = useLanguage();
  const summary = ok ? (value ?? t.ok) : required ? t.complete_required_fields : t.not_recorded;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${summary}`}
      accessibilityState={{ disabled: !onPress }}
      style={({ pressed }) => [styles.reviewRow, pressed && onPress ? styles.pressed : null]}
    >
      <View style={[styles.reviewMark, ok ? styles.reviewMarkOk : required ? styles.reviewMarkMissing : null]}>
        <Text style={[styles.reviewMarkText, ok && styles.reviewMarkTextOk]}>
          {ok ? "✓" : required ? "!" : "–"}
        </Text>
      </View>

      <View style={styles.reviewText}>
        <Text style={styles.reviewLabel}>
          {label}
          {required ? <Text style={styles.reviewRequired}> *</Text> : null}
        </Text>
        <Text style={[styles.reviewValue, !ok && required ? styles.reviewValueMissing : null]} numberOfLines={2}>
          {summary}
        </Text>
      </View>

      {onPress ? <Text style={styles.reviewChevron}>›</Text> : null}
    </Pressable>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  flush: { marginBottom: 0 },
  pressed: { opacity: 0.7 },
  footerStack: { gap: theme.spacing.sm },

  alert: {
    backgroundColor: theme.colors.danger + "12",
    borderWidth: 1,
    borderColor: theme.colors.danger + "40",
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm + 2,
    marginBottom: theme.spacing.sm,
  },
  alertTitle: { color: theme.colors.danger, fontSize: theme.textSizes.sm, fontWeight: "800" },
  alertBody: { color: theme.colors.danger, fontSize: theme.textSizes.xs, lineHeight: 16, marginTop: 2 },

  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  locationText: { flex: 1, minWidth: 0 },
  locationValue: { fontSize: theme.textSizes.sm, color: theme.colors.text, fontWeight: "600" },
  locationCoords: { fontSize: theme.textSizes.xs, color: theme.colors.textMuted, marginTop: 3 },
  locationAction: {
    // Was a 278x41 strip; now a real 48dp target.
    minHeight: 48,
    minWidth: 92,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.primary + "14",
    alignItems: "center",
    justifyContent: "center",
  },
  locationActionText: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.xs,
    fontWeight: "800",
    textAlign: "center",
  },

  reviewCard: { padding: 0, overflow: "hidden" },
  reviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  reviewMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.textMuted + "1F",
  },
  reviewMarkOk: { backgroundColor: theme.colors.primaryLight },
  reviewMarkMissing: { backgroundColor: theme.colors.danger + "22" },
  reviewMarkText: { fontSize: 13, fontWeight: "900", color: theme.colors.textMuted },
  reviewMarkTextOk: { color: "#065F46" },
  reviewText: { flex: 1, minWidth: 0 },
  reviewLabel: { fontSize: theme.textSizes.sm, color: theme.colors.text, fontWeight: "700" },
  reviewRequired: { color: theme.colors.danger },
  reviewValue: { fontSize: theme.textSizes.xs, color: theme.colors.textMuted, marginTop: 2 },
  reviewValueMissing: { color: theme.colors.danger, fontWeight: "700" },
  reviewChevron: { color: theme.colors.textMuted, fontSize: 22 },

  clock: {
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
  },

  successBlock: { alignItems: "center", width: "100%" },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: theme.colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing.md,
  },
  successIconText: { fontSize: 38, color: theme.colors.primary, fontWeight: "900" },
  successTitle: {
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    color: theme.colors.text,
    textAlign: "center",
  },
  successMessage: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    textAlign: "center",
    marginTop: 4,
    marginBottom: theme.spacing.lg,
    lineHeight: 19,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  summaryLabel: { fontSize: theme.textSizes.xs, color: theme.colors.textMuted, fontWeight: "700" },
  summaryValue: {
    flex: 1,
    fontSize: theme.textSizes.sm,
    color: theme.colors.text,
    fontWeight: "700",
    textAlign: "right",
  },
});
