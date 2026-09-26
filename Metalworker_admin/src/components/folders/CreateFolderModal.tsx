// src/components/folders/CreateFolderModal.tsx

import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface CreateFolderModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

export function CreateFolderModal({
  visible,
  onClose,
  onSave,
}: CreateFolderModalProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [name, setName] = useState("");
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
      setName("");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create folder."
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
            <Text style={styles.title}>New Folder</Text>
            <Text style={styles.desc}>
              Enter a name for the new folder.
            </Text>

            <Input
              label="FOLDER NAME *"
              value={name}
              onChangeText={setName}
              placeholder="e.g. September Stock"
              autoFocus
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              title="Create Folder"
              loading={saving}
              onPress={handleSave}
            />
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => {
                setName("");
                setError(null);
                onClose();
              }}
              style={styles.cancelBtn}
            />
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
  cancelBtn: {
    marginTop: theme.spacing.sm,
  },
});
