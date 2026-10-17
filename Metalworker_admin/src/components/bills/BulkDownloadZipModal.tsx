// src/components/bills/BulkDownloadZipModal.tsx
//
// "Download ZIP" is not one action, it is a small choice: WHICH print copies the
// archive should hold. This is that choice.
//
// WHY A DIALOG AND NOT THREE ROWS IN THE BULK BAR
// A bottom sheet asks one question and keeps the bulk bar to commands. Three buttons
// per copy combination would crowd a screen that is already carrying Add to folder,
// Assign Logo, Remove Logo and Delete; and the count has to be read before the tap,
// not after a hundred files start moving.
//
// WHY THE COUNT IS SHOWN BEFORE STARTING
// The admin is about to pull hundreds of documents off a private bucket. "412 bills
// x 3 copies = up to 1236 PDFs" is the number that lets them narrow the filters
// first, and it belongs here rather than discovered from a progress bar.
//
// The count is the CEILING, not a promise: a bill whose copy was never generated is
// skipped, and the completion message reports what really went in. Saying "up to"
// here and the truth afterwards is the honest pair.

import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { BILL_COPIES, BILL_COPY_LABEL, type BillCopy } from "../../types/bill";
import { Button } from "../ui/Button";

export interface BulkDownloadZipModalProps {
  visible: boolean;
  onClose: () => void;
  /** How many bills are selected right now, across every page and filter. */
  count: number;
  /** True when the selection is the whole matching set; the bulk bar says this too. */
  allMatching?: boolean;
  /** `copies` is always in print order, never the order they were ticked. */
  onConfirm: (copies: BillCopy[]) => void;
}

/**
 * The dialog's contents.
 *
 * Split from the modal shell so that opening it REMOUNTS this entirely, exactly the
 * way `LogoPickerModal` does: the default ("original" only) comes back with a fresh
 * instance rather than an effect, so no frame can be painted offering a choice the
 * admin did not make and does not expect to be kept.
 */
function ZipBody({ onClose, count, allMatching, onConfirm }: Omit<BulkDownloadZipModalProps, "visible">) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [copies, setCopies] = useState<BillCopy[]>(["original"]);

  const toggle = (copy: BillCopy) => {
    setCopies((prev) => (prev.includes(copy) ? prev.filter((c) => c !== copy) : [...prev, copy]));
  };

  const chosen = BILL_COPIES.filter((c) => copies.includes(c));
  const maxDocuments = count * chosen.length;
  const billWord = count === 1 ? "bill" : "bills";

  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <Text style={styles.title}>Download as ZIP</Text>
        <Text style={styles.subtitle}>
          {count} {billWord} selected
          {allMatching ? ", every bill matching these filters" : ""}
        </Text>

        <Text style={styles.lead}>
          Choose the print copies to include. Each chosen copy is downloaded for{" "}
          <Text style={styles.bold}>every selected {billWord}</Text>.
        </Text>

        <View style={styles.rows}>
          {BILL_COPIES.map((copy) => {
            const checked = copies.includes(copy);
            return (
              <Pressable
                key={copy}
                onPress={() => toggle(copy)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={BILL_COPY_LABEL[copy]}
                style={({ pressed }) => [
                  styles.row,
                  checked ? styles.rowSelected : styles.rowIdle,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.box, checked && styles.boxChecked]}>
                  {checked ? <Text style={styles.tick}>✓</Text> : null}
                </View>
                <Text style={styles.rowLabel}>{BILL_COPY_LABEL[copy]}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.outcome}>
          <Text style={styles.outcomeLine}>
            <Text style={styles.bold}>{count}</Text> {billWord}
            {chosen.length > 0 ? (
              <>
                {" \u00d7 "}
                <Text style={styles.bold}>{chosen.length}</Text>{" "}
                {chosen.length === 1 ? "copy" : "copies"} = up to{" "}
                <Text style={styles.bold}>{maxDocuments}</Text>{" "}
                {maxDocuments === 1 ? "PDF" : "PDFs"}
              </>
            ) : (
              " \u2014 select at least one copy"
            )}
          </Text>
          <Text style={styles.mutedText}>
            Copies a bill does not have are skipped, and the result says how many went in.
            These are the PDFs already stored for each bill; nothing is re-generated.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button title="Cancel" variant="ghost" onPress={onClose} style={styles.action} />
          <Button
            title={
              maxDocuments === 1
                ? "Download 1 PDF"
                : chosen.length === 0
                  ? "Select a copy"
                  : `Download ${maxDocuments} PDFs`
            }
            onPress={() => onConfirm(chosen)}
            disabled={chosen.length === 0}
            style={styles.action}
          />
        </View>
      </View>
    </View>
  );
}

export function BulkDownloadZipModal(props: BulkDownloadZipModalProps) {
  /* Fresh instance per open — see the note on `ZipBody`. The counter advances only
     on the closed→open transition, so React unmounts the old body and mounts a new
     one, which resets the tick boxes with no effect and no stale frame. */
  const [openCount, setOpenCount] = useState(0);
  const [wasVisible, setWasVisible] = useState(props.visible);
  if (props.visible !== wasVisible) {
    setWasVisible(props.visible);
    if (props.visible) setOpenCount((n) => n + 1);
  }

  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={props.onClose}
    >
      <ZipBody key={openCount} onClose={props.onClose} count={props.count} allMatching={props.allMatching} onConfirm={props.onConfirm} />
    </Modal>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      borderTopWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
      maxHeight: "88%",
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
    },
    lead: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
    },
    bold: { color: theme.colors.text, fontWeight: "700" },
    rows: { gap: 6, paddingVertical: theme.spacing.xs },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
    },
    rowIdle: { borderColor: theme.colors.border, backgroundColor: "transparent" },
    rowSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primaryMuted,
    },
    box: {
      width: 22,
      height: 22,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    boxChecked: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary },
    tick: { color: "#fff", fontSize: 14, fontWeight: "800" },
    rowLabel: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
      flex: 1,
    },
    outcome: {
      gap: 2,
      paddingVertical: theme.spacing.xs,
    },
    outcomeLine: { color: theme.colors.text, fontSize: theme.textSizes.sm, lineHeight: 20 },
    mutedText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      lineHeight: 18,
    },
    actions: {
      flexDirection: "row",
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
    },
    action: { flex: 1 },
    pressed: { opacity: 0.85 },
  });

export default BulkDownloadZipModal;
