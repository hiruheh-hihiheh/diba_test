// src/components/stock/OwnerStockForm.tsx

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
import { StockPhotoUploader } from "./StockPhotoUploader";
import { DateTimeField } from "./DateTimeField";
import type { OwnerStock, OwnerStockInput } from "../../types/ownerStock";

interface OwnerStockFormProps {
  visible: boolean;
  onClose: () => void;
  onSave: (input: OwnerStockInput) => Promise<void>;
  editingItem?: OwnerStock | null;
}

export function OwnerStockForm({
  visible,
  onClose,
  onSave,
  editingItem,
}: OwnerStockFormProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const isEdit = !!editingItem;

  const [sourceOfMetal, setSourceOfMetal] = useState(
    editingItem?.source_of_metal ?? ""
  );
  const [folderNo, setFolderNo] = useState(editingItem?.folder_no ?? "");
  const [folioNumber, setFolioNumber] = useState(
    editingItem?.folio_number ?? ""
  );
  const [metalType, setMetalType] = useState(editingItem?.metal_type ?? "");
  const [tnNo, setTnNo] = useState(editingItem?.tn_no ?? "");
  const [paint, setPaint] = useState(editingItem?.paint ?? "");
  const [amountPurchase, setAmountPurchase] = useState(
    editingItem?.amount_purchase?.toString() ?? ""
  );

  // Photo state
  const [drawingPhotoUrl, setDrawingPhotoUrl] = useState(
    editingItem?.drawing_photo_url ?? ""
  );
  const [drawingPhotoPublicId, setDrawingPhotoPublicId] = useState(
    editingItem?.drawing_photo_public_id ?? ""
  );
  const [metalPhotoUrl, setMetalPhotoUrl] = useState(
    editingItem?.metal_photo_url ?? ""
  );
  const [metalPhotoPublicId, setMetalPhotoPublicId] = useState(
    editingItem?.metal_photo_public_id ?? ""
  );

  const [recordedTime, setRecordedTime] = useState(
    editingItem?.recorded_time
      ? new Date(editingItem.recorded_time).toISOString()
      : ""
  );
  const [processingStart, setProcessingStart] = useState(
    editingItem?.processing_start
      ? new Date(editingItem.processing_start).toISOString()
      : ""
  );
  const [processingEnd, setProcessingEnd] = useState(
    editingItem?.processing_end
      ? new Date(editingItem.processing_end).toISOString()
      : ""
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!sourceOfMetal.trim()) return "Source of Metal is required.";
    if (
      processingStart &&
      processingEnd &&
      new Date(processingStart) > new Date(processingEnd)
    ) {
      return "Processing start must be before processing end.";
    }
    return null;
  }

  async function handleSave() {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const input: OwnerStockInput = {
      source_of_metal: sourceOfMetal.trim(),
      folder_no: folderNo.trim() || undefined,
      folio_number: folioNumber.trim() || undefined,
      metal_type: metalType.trim() || undefined,
      tn_no: tnNo.trim() || undefined,
      paint: paint.trim() || undefined,
      amount_purchase: amountPurchase ? parseFloat(amountPurchase) : undefined,
      drawing_photo_url: drawingPhotoUrl || undefined,
      drawing_photo_public_id: drawingPhotoPublicId || undefined,
      metal_photo_url: metalPhotoUrl || undefined,
      metal_photo_public_id: metalPhotoPublicId || undefined,
      recorded_time: recordedTime
        ? new Date(recordedTime).toISOString()
        : undefined,
      processing_start: processingStart
        ? new Date(processingStart).toISOString()
        : undefined,
      processing_end: processingEnd
        ? new Date(processingEnd).toISOString()
        : undefined,
    };

    try {
      setSaving(true);
      await onSave(input);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save record."
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
            <Text style={styles.title}>
              {isEdit ? "Edit Owner Stock" : "Add Owner Stock"}
            </Text>
            <Text style={styles.desc}>
              {isEdit
                ? "Update the stock record details below."
                : "Fill in the details to add a new owner stock record."}
            </Text>

            <Input
              label="SOURCE OF METAL *"
              value={sourceOfMetal}
              onChangeText={setSourceOfMetal}
              placeholder="e.g. Local Market"
            />
            <Input
              label="FOLDER NO"
              value={folderNo}
              onChangeText={setFolderNo}
              placeholder="e.g. F-101"
            />
            <Input
              label="FOLIO NUMBER"
              value={folioNumber}
              onChangeText={setFolioNumber}
              placeholder="e.g. 001"
            />
            <Input
              label="METAL TYPE"
              value={metalType}
              onChangeText={setMetalType}
              placeholder="e.g. Steel, Iron, Aluminum"
            />
            <Input
              label="TN NO"
              value={tnNo}
              onChangeText={setTnNo}
              placeholder="e.g. TN-1234"
            />
            <Input
              label="PAINT"
              value={paint}
              onChangeText={setPaint}
              placeholder="e.g. Red, Blue"
            />
            <Input
              label="AMOUNT PURCHASE"
              value={amountPurchase}
              onChangeText={setAmountPurchase}
              placeholder="e.g. 5000"
              keyboardType="numeric"
            />

            <StockPhotoUploader
              label="DRAWING PHOTO"
              photoUrl={drawingPhotoUrl || null}
              onPhotoUploaded={(url, publicId) => {
                setDrawingPhotoUrl(url);
                setDrawingPhotoPublicId(publicId);
              }}
              onPhotoRemoved={() => {
                setDrawingPhotoUrl("");
                setDrawingPhotoPublicId("");
              }}
            />

            <StockPhotoUploader
              label="METAL PHOTO"
              photoUrl={metalPhotoUrl || null}
              onPhotoUploaded={(url, publicId) => {
                setMetalPhotoUrl(url);
                setMetalPhotoPublicId(publicId);
              }}
              onPhotoRemoved={() => {
                setMetalPhotoUrl("");
                setMetalPhotoPublicId("");
              }}
            />

            {/* Date/Time Fields */}
            <View style={styles.dateSection}>
              <DateTimeField
                label="RECORDED TIME"
                value={recordedTime}
                onChange={setRecordedTime}
                placeholder="Select recorded time"
              />
            </View>

            <View style={styles.dateSection}>
              <Text style={styles.sectionLabel}>PROCESSING TIMELINE</Text>
              <DateTimeField
                label="START"
                value={processingStart}
                onChange={setProcessingStart}
                placeholder="Select start date & time"
              />
              <DateTimeField
                label="END"
                value={processingEnd}
                onChange={setProcessingEnd}
                placeholder="Select end date & time"
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              title={isEdit ? "Save Changes" : "Add Stock"}
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
  dateSection: {
    marginBottom: theme.spacing.sm,
  },
  dateLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  sectionLabel: {
    color: theme.colors.primary,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.sm,
    textAlign: "center",
    marginBottom: theme.spacing.md,
  },
  gap: { height: theme.spacing.sm },
});
