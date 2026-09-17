// src/components/folders/RenameFolderModal.tsx

import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "../../constants/theme";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface RenameFolderModalProps {
  visible: boolean;
  currentName: string;
  onClose: () => void;
  onSave: (newName: string) => Promise<void>;
}

export function RenameFolderModal({
  visible,
  currentName,
  onClose,
  onSave,
}: RenameFolderModalProps) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Folder name is required.");
      return;
    }

    try {
      setSaving(true);
      await onSave(name.trim());
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to rename folder."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Rename Folder</Text>
            <Text style={styles.desc}>
              Enter a new name for &quot;{currentName}&quot;.
            </Text>

            <Input
              label="NEW NAME *"
              value={name}
              onChangeText={setName}
              placeholder="Enter folder name"
              autoFocus
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              title="Rename"
              loading={saving}
              onPress={handleSave}
            />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={onClose}
              style={styles.cancelBtn}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  cancelBtn: {
    marginTop: theme.spacing.sm,
  },
});
