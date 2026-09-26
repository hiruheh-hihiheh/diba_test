import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { FolderItemType } from "../../types/folder";
import { fetchOwnerStock } from "../../services/ownerStock";
import { fetchCompanyStock } from "../../services/companyStock";
import { fetchBillGroup, fetchBillGroupPhotos } from "../../services/billGroups";
import { fetchDrawingGroup, fetchDrawingGroupPhotos } from "../../services/drawingGroups";
import type { GroupPhoto } from "../documents/GroupPhotoUploader";

interface ItemPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  itemType: FolderItemType;
  itemId: string;
  label: string;
}

const TYPE_TITLES: Record<FolderItemType, string> = {
  owner_stock: "Owner Stock",
  company_stock: "Company Stock",
  bill_group: "Bill Group",
  drawing_group: "Drawing Group",
  job: "Job",
};

export function ItemPreviewModal({
  visible,
  onClose,
  itemType,
  itemId,
  label,
}: ItemPreviewModalProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [details, setDetails] = useState<any>(null);
  const [photos, setPhotos] = useState<GroupPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      loadDetails();
    }
  }, [visible, itemId, itemType]);

  async function loadDetails() {
    try {
      setLoading(true);
      setError(null);
      setDetails(null);
      setPhotos([]);

      switch (itemType) {
        case "owner_stock": {
          const data = await fetchOwnerStock(itemId);
          setDetails(data);
          break;
        }
        case "company_stock": {
          const data = await fetchCompanyStock(itemId);
          setDetails(data);
          break;
        }
        case "bill_group": {
          const data = await fetchBillGroup(itemId);
          const p = await fetchBillGroupPhotos(itemId);
          setDetails(data);
          setPhotos(p.sort((a, b) => a.position - b.position));
          break;
        }
        case "drawing_group": {
          const data = await fetchDrawingGroup(itemId);
          const p = await fetchDrawingGroupPhotos(itemId);
          setDetails(data);
          setPhotos(p.sort((a, b) => a.position - b.position));
          break;
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load item details."
      );
    } finally {
      setLoading(false);
    }
  }

  function renderField(label: string, value: any) {
    if (value === null || value === undefined || value === "") return null;
    return (
      <View style={styles.fieldRow} key={label}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{String(value)}</Text>
      </View>
    );
  }

  function renderImage(label: string, uri: string | null | undefined) {
    if (!uri) return null;
    return (
      <View style={styles.imageSection} key={label}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <View style={styles.imageWrapper}>
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        </View>
      </View>
    );
  }

  function renderOwnerStock() {
    if (!details) return null;
    return (
      <>
        {renderField("Source of Metal", details.source_of_metal)}
        {renderField("Folder No.", details.folder_no)}
        {renderField("Folio No.", details.folio_number)}
        {renderField("Metal Type", details.metal_type)}
        {renderField("TN No.", details.tn_no)}
        {renderField("Paint", details.paint)}
        {renderField("Recorded Time", details.recorded_time)}
        {renderField("Purchase Amount", details.amount_purchase)}
        {renderField("Processing Start", details.processing_start)}
        {renderField("Processing End", details.processing_end)}

        {renderImage("Drawing", details.drawing_photo_url)}
        {renderImage("Metal Photo", details.metal_photo_url)}
      </>
    );
  }

  function renderCompanyStock() {
    if (!details) return null;
    return (
      <>
        {renderField("Company Name", details.company_name)}
        {renderField("Product Name", details.product_name)}
        {renderField("Metal Type", details.metal_type)}
        {renderField("Processed Metal Type", details.processed_metal_type)}
        {renderField("Folder No.", details.folder_no)}
        {renderField("Folio No.", details.folio_number)}
        {renderField("Recorded Time", details.recorded_time)}
        {renderField("Processing Start", details.processing_start)}
        {renderField("Processing End", details.processing_end)}

        {renderImage("Drawing", details.drawing_photo_url)}
        {renderImage("Metal Photo", details.metal_photo_url)}
      </>
    );
  }

  function renderGroupPhotos() {
    if (!details) return null;
    return (
      <>
        {renderField("Group Name", details.name)}
        {renderField(
          "Group Date",
          details.group_date
            ? new Date(details.group_date).toLocaleDateString()
            : null
        )}
        {renderField("Total Photos", photos.length)}

        {photos.length > 0 ? (
          photos.map((photo, index) =>
            renderImage(`Photo #${index + 1}`, photo.photo_url)
          )
        ) : (
          <Text style={styles.emptyPhotosText}>
            No photos uploaded for this group.
          </Text>
        )}
      </>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <Text style={styles.headerSubtitle}>{TYPE_TITLES[itemType]}</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {label}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Content */}
          {loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.loadingText}>Loading details...</Text>
            </View>
          ) : error ? (
            <View style={styles.centerContainer}>
              <Text style={styles.errorText}>
                {error.includes("Row not found") || error.includes("JSON object requested")
                  ? "This item no longer exists."
                  : "Unable to load item details."}
              </Text>
              {!error.includes("Row not found") && !error.includes("JSON object requested") && (
                <Pressable style={styles.retryBtn} onPress={loadDetails}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.card}>
                {itemType === "owner_stock" && renderOwnerStock()}
                {itemType === "company_stock" && renderCompanyStock()}
                {(itemType === "bill_group" || itemType === "drawing_group") &&
                  renderGroupPhotos()}
              </View>

              <Pressable style={styles.bottomCloseBtn} onPress={onClose}>
                <Text style={styles.bottomCloseBtnText}>Close</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    flex: 0.9,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  headerTitleContainer: {
    flex: 1,
    marginRight: theme.spacing.md,
  },
  headerTitle: {
    fontSize: theme.textSizes.lg,
    fontWeight: "700",
    color: theme.colors.text,
  },
  headerSubtitle: {
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    color: theme.colors.textMuted,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: "bold",
    color: theme.colors.text,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  loadingText: {
    marginTop: theme.spacing.md,
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
  },
  errorText: {
    fontSize: theme.textSizes.md,
    color: theme.colors.danger,
    textAlign: "center",
    marginBottom: theme.spacing.lg,
  },
  retryBtn: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.md,
  },
  retryBtnText: {
    color: "#fff",
    fontWeight: "600",
  },
  scrollContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  fieldRow: {
    flexDirection: "row",
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.background,
  },
  fieldLabel: {
    flex: 1,
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
  },
  fieldValue: {
    flex: 2,
    fontSize: theme.textSizes.sm,
    color: theme.colors.text,
    fontWeight: "500",
    textAlign: "right",
  },
  sectionLabel: {
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    color: theme.colors.textMuted,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    textTransform: "uppercase",
  },
  imageSection: {
    marginTop: theme.spacing.sm,
  },
  imageWrapper: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  emptyPhotosText: {
    marginTop: theme.spacing.md,
    color: theme.colors.textMuted,
    fontStyle: "italic",
    fontSize: theme.textSizes.sm,
  },
  bottomCloseBtn: {
    backgroundColor: theme.colors.border,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  bottomCloseBtnText: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    fontWeight: "700",
  },
});
