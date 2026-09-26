// src/components/documents/BillGroupForm.tsx

import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { GroupPhotoUploader, type GroupPhoto } from "./GroupPhotoUploader";
import type { BillGroup, BillGroupInput } from "../../types/billGroup";

interface BillGroupFormProps {
  visible: boolean;
  onClose: () => void;
  onSave: (input: BillGroupInput, photos: GroupPhoto[]) => Promise<void>;
  editingItem?: BillGroup | null;
  existingPhotos?: GroupPhoto[];
}

export function BillGroupForm({
  visible,
  onClose,
  onSave,
  editingItem,
  existingPhotos = [],
}: BillGroupFormProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const isEdit = !!editingItem;

  const [name, setName] = useState(editingItem?.name ?? "");
  const [groupDate, setGroupDate] = useState(
    editingItem?.group_date ?? new Date().toISOString().slice(0, 10)
  );
  const [photos, setPhotos] = useState<GroupPhoto[]>(existingPhotos);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!name.trim()) return "Group name is required.";
    if (!groupDate) return "Date is required.";
    return null;
  }

  async function handleSave() {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const input: BillGroupInput = {
      name: name.trim(),
      group_date: groupDate,
    };

    try {
      setSaving(true);
      await onSave(input, photos);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save bill group."
      );
    } finally {
      setSaving(false);
    }
  }

  function handlePhotoAdded(url: string, publicId: string) {
    setPhotos((prev) => [
      ...prev,
      {
        photo_url: url,
        photo_public_id: publicId,
        position: prev.length,
      },
    ]);
  }

  function handlePhotoRemoved(index: number) {
    setPhotos((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.map((p, i) => ({ ...p, position: i }));
    });
  }

  function handlePhotosReordered(reordered: GroupPhoto[]) {
    setPhotos(reordered);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>
              {isEdit ? "Edit Bill Group" : "Create Bill Group"}
            </Text>
            <Text style={styles.desc}>
              {isEdit
                ? "Update the bill group details and photos."
                : "Name your bill group, set the date, and add bill photos."}
            </Text>

            <Input
              label="GROUP NAME *"
              value={name}
              onChangeText={setName}
              placeholder="e.g. September Bills"
            />
            <Input
              label="DATE *"
              value={groupDate}
              onChangeText={setGroupDate}
              placeholder="YYYY-MM-DD"
            />

            <GroupPhotoUploader
              photos={photos}
              onPhotoAdded={handlePhotoAdded}
              onPhotoRemoved={handlePhotoRemoved}
              onPhotosReordered={handlePhotosReordered}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              title={isEdit ? "Save Changes" : "Create Group"}
              loading={saving}
              onPress={handleSave}
            />
            <View style={styles.gap} />
            <Button title="Cancel" variant="ghost" onPress={onClose} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  keyboard: { flex: 1 },
  content: {
    padding: theme.spacing.lg,
    flexGrow: 1,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    marginBottom: 4,
  },
  desc: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.sm,
    marginBottom: theme.spacing.lg,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    marginBottom: theme.spacing.md,
  },
  gap: { height: theme.spacing.sm },
});
