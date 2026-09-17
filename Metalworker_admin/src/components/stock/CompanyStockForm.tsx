// src/components/stock/CompanyStockForm.tsx

import { useState } from "react";
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

import { theme } from "../../constants/theme";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { StockPhotoUploader } from "./StockPhotoUploader";
import type { CompanyStock, CompanyStockInput } from "../../types/companyStock";

interface CompanyStockFormProps {
  visible: boolean;
  onClose: () => void;
  onSave: (input: CompanyStockInput) => Promise<void>;
  editingItem?: CompanyStock | null;
}

export function CompanyStockForm({
  visible,
  onClose,
  onSave,
  editingItem,
}: CompanyStockFormProps) {
  const isEdit = !!editingItem;

  const [metalType, setMetalType] = useState(editingItem?.metal_type ?? "");
  const [folderNo, setFolderNo] = useState(editingItem?.folder_no ?? "");
  const [folioNumber, setFolioNumber] = useState(
    editingItem?.folio_number ?? ""
  );
  const [processedMetalType, setProcessedMetalType] = useState(
    editingItem?.processed_metal_type ?? ""
  );
  const [companyName, setCompanyName] = useState(
    editingItem?.company_name ?? ""
  );
  const [productName, setProductName] = useState(
    editingItem?.product_name ?? ""
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

  // Date/time state
  const [recordedTime, setRecordedTime] = useState(
    editingItem?.recorded_time
      ? new Date(editingItem.recorded_time).toISOString().slice(0, 16)
      : ""
  );
  const [processingStart, setProcessingStart] = useState(
    editingItem?.processing_start
      ? new Date(editingItem.processing_start).toISOString().slice(0, 16)
      : ""
  );
  const [processingEnd, setProcessingEnd] = useState(
    editingItem?.processing_end
      ? new Date(editingItem.processing_end).toISOString().slice(0, 16)
      : ""
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!companyName.trim()) return "Company Name is required.";
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

    const input: CompanyStockInput = {
      metal_type: metalType.trim() || undefined,
      folder_no: folderNo.trim() || undefined,
      folio_number: folioNumber.trim() || undefined,
      processed_metal_type: processedMetalType.trim() || undefined,
      company_name: companyName.trim(),
      product_name: productName.trim() || undefined,
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
              {isEdit ? "Edit Company Stock" : "Add Company Stock"}
            </Text>
            <Text style={styles.desc}>
              {isEdit
                ? "Update the company stock record details below."
                : "Fill in the details to add a new company stock record."}
            </Text>

            <Input
              label="COMPANY NAME *"
              value={companyName}
              onChangeText={setCompanyName}
              placeholder="e.g. ABC Steel Ltd."
            />
            <Input
              label="PRODUCT NAME"
              value={productName}
              onChangeText={setProductName}
              placeholder="e.g. Steel Bars"
            />
            <Input
              label="METAL TYPE"
              value={metalType}
              onChangeText={setMetalType}
              placeholder="e.g. Steel, Iron"
            />
            <Input
              label="FOLDER NO"
              value={folderNo}
              onChangeText={setFolderNo}
              placeholder="e.g. F-205"
            />
            <Input
              label="FOLIO NUMBER"
              value={folioNumber}
              onChangeText={setFolioNumber}
              placeholder="e.g. 001"
            />
            <Input
              label="PROCESSED METAL TYPE"
              value={processedMetalType}
              onChangeText={setProcessedMetalType}
              placeholder="e.g. Rolled Steel"
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
              <Text style={styles.dateLabel}>RECORDED TIME</Text>
              <Input
                value={recordedTime}
                onChangeText={setRecordedTime}
                placeholder="YYYY-MM-DDTHH:MM"
              />
            </View>

            <View style={styles.dateSection}>
              <Text style={styles.sectionLabel}>PROCESSING TIMELINE</Text>
              <Input
                label="START"
                value={processingStart}
                onChangeText={setProcessingStart}
                placeholder="YYYY-MM-DDTHH:MM"
              />
              <Input
                label="END"
                value={processingEnd}
                onChangeText={setProcessingEnd}
                placeholder="YYYY-MM-DDTHH:MM"
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
