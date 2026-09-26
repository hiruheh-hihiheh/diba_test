// src/components/jobs/JobEditModal.tsx
import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import type { Job, JobInput } from "../../types/job";
import { updateJob } from "../../services/jobs";
import { getJobTypeLabel } from "../../types/job";

interface Props {
  visible: boolean;
  onClose: () => void;
  job: Job | null;
  onSaved: () => void;
}

export function JobEditModal({ visible, onClose, job, onSaved }: Props) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [formData, setFormData] = useState<JobInput>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (job && visible) {
      setFormData({
        job_no: job.job_no,
        job_given_date: job.job_given_date,
        po_status: job.po_status,
        tool_description: job.tool_description,
        tool_part: job.tool_part,
        quantity: job.quantity,
        expected_completion_date: job.expected_completion_date,
        expected_completion_note: job.expected_completion_note,
        current_machining_status: job.current_machining_status,
        status: job.status,
        drawing_status: job.drawing_status,
        drawing_status_note: job.drawing_status_note,
        model_status: job.model_status,
      });
    }
  }, [job, visible]);

  if (!job) return null;

  async function handleSave() {
    setLoading(true);
    try {
      const res = await updateJob(job!.id, formData);
      if (!res.ok) {
        throw new Error(res.error || "Failed to update job.");
      }
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }

  function updateField(key: keyof JobInput, val: string) {
    setFormData((p) => ({ ...p, [key]: val }));
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Edit Job</Text>
              <Text style={styles.subtitle}>
                Job Type: {getJobTypeLabel(job.job_type)}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Form */}
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>JOB INFORMATION</Text>
              <Input
                placeholder="Job No"
                value={formData.job_no || ""}
                onChangeText={(val) => updateField("job_no", val)}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>SCHEDULING</Text>
              <Input
                placeholder="Job Given Date (YYYY-MM-DD)"
                value={formData.job_given_date || ""}
                onChangeText={(val) => updateField("job_given_date", val)}
              />
              <Input
                placeholder="Expected Completion Date (YYYY-MM-DD)"
                value={formData.expected_completion_date || ""}
                onChangeText={(val) => updateField("expected_completion_date", val)}
              />
              <Input
                placeholder="Expected Completion Note"
                value={formData.expected_completion_note || ""}
                onChangeText={(val) => updateField("expected_completion_note", val)}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PURCHASE / TOOL</Text>
              <Input
                placeholder="PO Status"
                value={formData.po_status || ""}
                onChangeText={(val) => updateField("po_status", val)}
              />
              <Input
                placeholder="Tool / Part"
                value={formData.tool_part || ""}
                onChangeText={(val) => updateField("tool_part", val)}
              />
              <Input
                placeholder="Tool Description"
                value={formData.tool_description || ""}
                onChangeText={(val) => updateField("tool_description", val)}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PRODUCTION</Text>
              <Input
                placeholder="Quantity"
                value={formData.quantity || ""}
                onChangeText={(val) => updateField("quantity", val)}
              />
              <Input
                placeholder="Status"
                value={formData.status || ""}
                onChangeText={(val) => updateField("status", val)}
              />
              <Input
                placeholder="Current Machining Status"
                value={formData.current_machining_status || ""}
                onChangeText={(val) => updateField("current_machining_status", val)}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>DOCUMENTATION</Text>
              <Input
                placeholder="DRG Status"
                value={formData.drawing_status || ""}
                onChangeText={(val) => updateField("drawing_status", val)}
              />
              <Input
                placeholder="Model Status"
                value={formData.model_status || ""}
                onChangeText={(val) => updateField("model_status", val)}
              />
              <Input
                placeholder="DRG Status Note"
                value={formData.drawing_status_note || ""}
                onChangeText={(val) => updateField("drawing_status_note", val)}
              />
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Button
                title="Cancel"
                onPress={onClose}
                disabled={loading}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Button
                title={loading ? "Saving..." : "Save Changes"}
                onPress={handleSave}
                disabled={loading}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    maxHeight: "90%",
    minHeight: "50%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: theme.textSizes.xl,
    fontWeight: "800",
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: theme.textSizes.sm,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
  },
  closeBtnText: {
    fontSize: theme.textSizes.md,
    fontWeight: "600",
    color: theme.colors.textMuted,
  },
  formContent: {
    padding: theme.spacing.lg,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    textTransform: "uppercase",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: 4,
  },
  footer: {
    flexDirection: "row",
    padding: theme.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
});
