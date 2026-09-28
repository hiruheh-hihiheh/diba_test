import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";

import { theme } from "../../constants/theme";
import type { TranslationDictionary } from "../../constants/translations";
import { ConfirmDialog } from "../ui/ConfirmDialog";

export interface PhotoPickerProps {
  asset: ImagePicker.ImagePickerAsset | null;
  uri: string | null;
  onChange: (asset: ImagePicker.ImagePickerAsset | null, uri: string | null) => void;
  t: TranslationDictionary;
  /** Inline validation message rendered under the preview. */
  error?: string | null;
  disabled?: boolean;
}

type PermissionPrompt =
  | { kind: "camera"; canAskAgain: boolean }
  | { kind: "library"; canAskAgain: boolean }
  | null;

/**
 * The photo step of the dispatch form.
 *
 * Before, a denied permission produced a single generic line of red text and no
 * way forward. `canAskAgain === false` means the OS will no longer show a
 * prompt, so the only route is Settings — we say so and offer the button.
 */
export function PhotoPicker({ asset, uri, onChange, t, error, disabled = false }: PhotoPickerProps) {
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<PermissionPrompt>(null);
  const [openMenu, setOpenMenu] = useState(false);

  async function ensure(kind: "camera" | "library"): Promise<boolean> {
    const result =
      kind === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (result.granted) return true;

    setPrompt({ kind, canAskAgain: result.canAskAgain });
    return false;
  }

  async function capture() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      if (!(await ensure("camera"))) return;

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        // 0.7 keeps a phone photo well under the Cloudinary body limit while
        // staying readable for a reviewer checking the load.
        quality: 0.7,
        mediaTypes: ["images"],
      });

      if (result.canceled || !result.assets?.length) return;

      const next = result.assets[0];
      if (!next?.uri) return;
      onChange(next, next.uri);
    } catch {
      setPrompt({ kind: "camera", canAskAgain: true });
    } finally {
      setBusy(false);
    }
  }

  async function chooseFromLibrary() {
    if (busy || disabled) return;
    setBusy(true);
    try {
      if (!(await ensure("library"))) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
        mediaTypes: ["images"],
      });

      if (result.canceled || !result.assets?.length) return;

      const next = result.assets[0];
      if (!next?.uri) return;
      onChange(next, next.uri);
    } catch {
      setPrompt({ kind: "library", canAskAgain: true });
    } finally {
      setBusy(false);
    }
  }

  async function recoverFromPermission(kind: "camera" | "library") {
    if (kind === "library") {
      // No pre-prompt needed to open the OS picker; try it straight away.
      setPrompt(null);
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
        mediaTypes: ["images"],
      });
      if (result.canceled || !result.assets?.length) return;
      const next = result.assets[0];
      if (next?.uri) onChange(next, next.uri);
      return;
    }
    // The camera prompt is permanently blocked: only Settings can fix it.
    try {
      await Linking.openSettings();
    } catch {
      // Settings could not be opened (rare, e.g. some web browsers). The dialog
      // simply closes and the worker can try the camera button again.
    } finally {
      setPrompt(null);
    }
  }

  const promptBody =
    prompt?.kind === "library" ? t.photo_permission_body : t.camera_permission_body;
  const promptTitle = prompt?.kind === "library" ? t.photo_permission_title : t.camera_permission_title;

  if (uri) {
    return (
      <View>
        <View style={[styles.preview, error ? styles.previewError : null]}>
          <Image
            source={{ uri }}
            style={styles.previewImage}
            contentFit="cover"
            transition={120}
            accessibilityLabel={t.photo_label}
          />

          <View style={styles.previewActions}>
            <PhotoAction
              label={t.retake_photo}
              icon="📷"
              onPress={capture}
              disabled={disabled || busy}
              primary
            />
            <PhotoAction
              label={t.choose_photo}
              icon="🖼"
              onPress={chooseFromLibrary}
              disabled={disabled || busy}
            />
            <PhotoAction
              label={t.discard}
              icon="✕"
              onPress={() => onChange(null, null)}
              disabled={disabled || busy}
              destructive
            />
          </View>
        </View>

        {asset?.fileSize ? (
          <Text style={styles.meta}>
            {(asset.fileSize / 1024 / 1024).toFixed(1)} MB
            {asset.width && asset.height ? ` • ${asset.width}×${asset.height}` : ""}
          </Text>
        ) : null}

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <ConfirmDialog
          visible={prompt !== null}
          title={promptTitle}
          body={promptBody}
          confirmLabel={prompt?.canAskAgain ? t.retry : t.open_settings}
          cancelLabel={t.cancel}
          onConfirm={() => prompt && recoverFromPermission(prompt.kind)}
          onCancel={() => setPrompt(null)}
        />
      </View>
    );
  }

  return (
    <View>
      {/* Two explicit choices. One button silently guessing between camera and
          gallery is the single most common complaint about photo steps. */}
      <View style={styles.actions}>
        <PhotoAction label={t.take_photo} icon="📷" onPress={capture} disabled={disabled || busy} primary wide />
        <PhotoAction
          label={t.choose_photo}
          icon="🖼"
          onPress={chooseFromLibrary}
          disabled={disabled || busy}
          wide
        />
      </View>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <ConfirmDialog
        visible={prompt !== null}
        title={promptTitle}
        body={promptBody}
        confirmLabel={prompt?.canAskAgain ? t.retry : t.open_settings}
        cancelLabel={t.cancel}
        onConfirm={() => prompt && recoverFromPermission(prompt.kind)}
        onCancel={() => setPrompt(null)}
      />
    </View>
  );
}

function PhotoAction({
  label,
  icon,
  onPress,
  disabled,
  primary = false,
  destructive = false,
  wide = false,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  disabled: boolean;
  primary?: boolean;
  destructive?: boolean;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.action,
        wide && styles.actionWide,
        primary && styles.actionPrimary,
        destructive && styles.actionDestructive,
        pressed && !disabled && styles.actionPressed,
        disabled && styles.actionDisabled,
      ]}
    >
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text
        style={[styles.actionLabel, primary && styles.actionLabelPrimary, destructive && styles.actionLabelDestructive]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  preview: {
    borderRadius: theme.radius.md,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  previewError: { borderColor: theme.colors.danger },
  previewImage: { width: "100%", height: 220, backgroundColor: theme.colors.border },
  previewActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  actionWide: { flexGrow: 1, flexBasis: 140 },
  actionPrimary: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  actionDestructive: { borderColor: theme.colors.danger + "55" },
  actionPressed: { opacity: 0.85 },
  actionDisabled: { opacity: 0.45 },
  actionIcon: { fontSize: 17 },
  actionLabel: {
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
    color: theme.colors.text,
    textAlign: "center",
  },
  actionLabelPrimary: { color: "#FFFFFF" },
  actionLabelDestructive: { color: theme.colors.danger },
  meta: {
    marginTop: 6,
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
  },
  error: {
    marginTop: theme.spacing.sm,
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
  },
});
