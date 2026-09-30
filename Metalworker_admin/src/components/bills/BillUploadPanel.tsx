// src/components/bills/BillUploadPanel.tsx
//
// The upload flow: pick a workbook, watch it go through the seven server
// pipeline steps, get told precisely why it failed if it does.
//
// The step list is the real pipeline from the `process-bill-upload` edge
// function. The first steps happen on this device and are observed directly; the
// rest all happen inside one HTTP call whose response is a single JSON document,
// so their individual completion cannot be seen from here — they are advanced
// while the request is in flight and the *response* decides the final state.
// That is why this is a list of named steps and not a percentage: a bar would
// imply a precision the API does not offer.

import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  BillUploadError,
  pickBillWorkbook,
  uploadBillWorkbook,
  type PickedBillWorkbook,
} from "../../services/bills";
import {
  BILL_UPLOAD_STAGE_LABEL,
  BILL_UPLOAD_STAGE_ORDER,
  type BillUploadResult,
  type BillUploadStage,
} from "../../types/bill";
import { Button } from "../ui/Button";
import { notify } from "../../utils/notify";

/**
 * Steps shown before the file is chosen. `completed` has its own summary card.
 * Typed as the full union on purpose: `indexOf` must also accept "completed"
 * and "failed" so that those two states resolve to -1 rather than failing to
 * type-check against the narrowed result of `.filter()`.
 */
const ALL_STEPS: BillUploadStage[] = BILL_UPLOAD_STAGE_ORDER.filter((s) => s !== "completed");

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function BillUploadPanel({
  onUploaded,
  onClose,
}: {
  /** Called after a successful upload so the list behind the dialog refreshes. */
  onUploaded: () => void;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [picked, setPicked] = useState<PickedBillWorkbook | null>(null);
  const [picking, setPicking] = useState(false);
  const [stage, setStage] = useState<BillUploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BillUploadResult | null>(null);

  const finished = stage === "completed" || stage === "failed";
  const busy = stage !== null && !finished;

  function reset() {
    setPicked(null);
    setStage(null);
    setError(null);
    setResult(null);
  }

  async function choose() {
    if (busy) return;
    setPicking(true);
    setError(null);
    setResult(null);
    try {
      const file = await pickBillWorkbook();
      // `null` means the user dismissed the picker — do not treat that as a
      // failure or clear an error they were already reading.
      if (!file) return;
      setPicked(file);
    } catch (err) {
      setStage("failed");
      setError(
        err instanceof BillUploadError || err instanceof Error
          ? err.message
          : "That workbook could not be read. Please try again."
      );
    } finally {
      setPicking(false);
    }
  }

  async function start() {
    if (!picked || busy) return;
    setError(null);
    setStage("reading");
    try {
      const res = await uploadBillWorkbook(picked, { onStage: setStage });
      setResult(res);
      onUploaded();
      notify(
        `${res.invoice_count} ${res.invoice_count === 1 ? "bill" : "bills"} added`,
        `${res.base_name}_original.pdf, ${res.base_name}_duplicate.pdf and ${res.base_name}_triplicate.pdf are ready.`
      );
    } catch (err) {
      setStage("failed");
      setError(
        err instanceof BillUploadError || err instanceof Error
          ? err.message
          : "That workbook could not be processed. Please try again."
      );
    }
  }

  /* `completed` and `failed` are not in ALL_STEPS, so they resolve to -1, which
     is exactly what the "failed" and "all done" branches below want. */
  const currentIndex = stage ? ALL_STEPS.indexOf(stage) : -1;
  const failedAt = stage === "failed" ? Math.max(currentIndex, 0) : -1;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {/* ── Picker ─────────────────────────────────────────── */}
      {!picked && (
        <View style={styles.dropZone}>
          <View style={styles.dropIcon}>
            <Text style={styles.dropIconText}>XLS</Text>
          </View>
          <Text style={styles.dropTitle}>Choose an Excel workbook</Text>
          <Text style={styles.dropBody}>
            One .xlsx file holding every invoice. Each sheet becomes one bill, and
            the workbook produces three PDFs — original, duplicate and triplicate.
          </Text>
          <Button
            title={picking ? "Opening…" : "Choose workbook"}
            onPress={() => void choose()}
            loading={picking}
            style={styles.dropButton}
          />
          <Text style={styles.dropHint}>.xlsx only · up to 50 MB</Text>
        </View>
      )}

      {/* ── Chosen file + pipeline ──────────────────────────── */}
      {picked && (
        <>
          <View style={styles.fileRow}>
            <View style={styles.fileInfo}>
              <Text style={styles.fileName} numberOfLines={1}>
                {picked.name}
              </Text>
              <Text style={styles.fileSize}>{formatSize(picked.size)}</Text>
            </View>
            {!busy && stage !== "completed" && (
              <Pressable
                onPress={reset}
                accessibilityRole="button"
                accessibilityLabel="Choose a different workbook"
                style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
              >
                <Text style={styles.resetText}>Change</Text>
              </Pressable>
            )}
          </View>

          <View accessibilityLiveRegion="polite">
            {ALL_STEPS.map((step, i) => {
              const done = stage === "completed" || currentIndex > i;
              const active = busy && i === currentIndex;
              const failed = failedAt === i;

              return (
                <View key={step} style={styles.stepRow} accessibilityLiveRegion="polite">
                  <View style={styles.stepMark}>
                    {failed ? (
                      <Text style={[styles.stepMarkText, { color: theme.colors.danger }]}>
                        !
                      </Text>
                    ) : done ? (
                      <Text style={[styles.stepMarkText, { color: theme.colors.success }]}>
                        ✓
                      </Text>
                    ) : active ? (
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                    ) : (
                      <Text style={styles.stepMarkPending}>•</Text>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      active && styles.stepLabelActive,
                      done && styles.stepLabelDone,
                      !done && !active && !failed && styles.stepLabelPending,
                    ]}
                  >
                    {BILL_UPLOAD_STAGE_LABEL[step]}
                  </Text>
                </View>
              );
            })}
          </View>

          {error && (
            <View
              accessibilityLiveRegion="assertive"
              style={[
                styles.errorCard,
                { borderColor: theme.colors.danger, backgroundColor: theme.colors.danger + "14" },
              ]}
            >
              <Text style={styles.errorTitle}>The workbook was not accepted</Text>
              <Text style={styles.errorBody}>{error}</Text>
            </View>
          )}

          {result && (
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.resultCard,
                { borderColor: theme.colors.success, backgroundColor: theme.colors.success + "14" },
              ]}
            >
              <Text style={styles.resultTitle}>
                {result.invoice_count}{" "}
                {result.invoice_count === 1 ? "bill" : "bills"} created
              </Text>
              {result.bills.map((b) => (
                <Text key={b.id} style={styles.resultLine} numberOfLines={1}>
                  Sheet {b.sheet_name}
                </Text>
              ))}
            </View>
          )}
        </>
      )}

      {/* ── Actions ────────────────────────────────────────── */}
      <View style={styles.actions}>
        <Button
          title={result ? "Done" : "Close"}
          onPress={onClose}
          variant="ghost"
          style={styles.actionButton}
        />
        {picked && !result && (
          <Button
            title="Upload workbook"
            onPress={() => void start()}
            loading={busy}
            disabled={busy || stage === "failed"}
            style={styles.actionButton}
          />
        )}
      </View>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    dropZone: {
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceSecondary,
      borderRadius: theme.radius.lg,
      paddingVertical: theme.spacing.lg,
      paddingHorizontal: theme.spacing.md,
      alignItems: "center",
      gap: theme.spacing.sm,
    },
    dropIcon: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    dropIconText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "800",
    },
    dropTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
      textAlign: "center",
    },
    dropBody: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
      textAlign: "center",
    },
    dropButton: { alignSelf: "stretch" },
    dropHint: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
    },

    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceSecondary,
    },
    fileInfo: { flex: 1, minWidth: 0 },
    fileName: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    fileSize: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, marginTop: 2 },
    resetBtn: {
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: theme.radius.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    resetText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },

    stepRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
    stepMark: { width: 20, alignItems: "center", justifyContent: "center" },
    stepMarkText: { fontSize: theme.textSizes.md, fontWeight: "800" },
    stepMarkPending: { color: theme.colors.textMuted, fontSize: theme.textSizes.lg },
    stepLabel: { fontSize: theme.textSizes.sm },
    stepLabelActive: { color: theme.colors.text, fontWeight: "700" },
    stepLabelDone: { color: theme.colors.textSecondary },
    stepLabelPending: { color: theme.colors.textMuted },

    errorCard: { borderWidth: 1, borderRadius: theme.radius.md, padding: theme.spacing.md },
    errorTitle: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    errorBody: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
      marginTop: 2,
    },

    resultCard: { borderWidth: 1, borderRadius: theme.radius.md, padding: theme.spacing.md },
    resultTitle: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    resultLine: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.sm,
      marginTop: 2,
    },

    actions: { flexDirection: "row", gap: theme.spacing.sm, justifyContent: "flex-end" },
    actionButton: { flex: 1 },
    pressed: { opacity: 0.7 },
  });
