// src/components/bills/BillCopyActions.tsx
//
// The three print copies of one bill, with the actions available on each.
//
// ORIGINAL / DUPLICATE / TRIPLICATE are three physical print copies of a single
// invoice, not three invoices. Every action here therefore operates on ONE copy
// of ONE bill, and the section never sums them together anywhere.

import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  billCopyPath,
  downloadBillPdf,
  printBillPdf,
  viewBillPdf,
  formatMoney,
} from "../../services/bills";
import { BILL_COPIES, BILL_COPY_LABEL, type Bill, type BillCopy } from "../../types/bill";
import { notify } from "../../utils/notify";

type BillSource = Pick<
  Bill,
  "original_pdf_path" | "duplicate_pdf_path" | "triplicate_pdf_path" | "base_name"
>;

/** Text glyphs instead of an icon font: no new dependency, and they scale. */
const ACTION_GLYPH: Record<"view" | "download" | "print", string> = {
  view: "Open",
  download: "Save",
  print: "Print",
};

/**
 * One row per copy, with View / Download / Print.
 *
 * A copy that was never generated shows as unavailable and its buttons are
 * disabled, rather than offering a button that mints a signed URL for an object
 * that does not exist and then fails with a 404.
 */
export function BillCopyActions({
  bill,
  layout = "row",
  showMoney = false,
}: {
  bill: BillSource & { invoice_no?: string | null; amount_after_tax?: number | null };
  layout?: "row" | "compact";
  showMoney?: boolean;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState<BillCopy | null>(null);

  async function run(copy: BillCopy, action: "view" | "download" | "print") {
    setBusy(copy);
    try {
      if (action === "view") await viewBillPdf(bill, copy);
      else if (action === "download") await downloadBillPdf(bill, copy);
      else await printBillPdf(bill, copy);
    } catch (err) {
      notify(
        `The ${BILL_COPY_LABEL[copy].toLowerCase()} copy could not be opened`,
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setBusy(null);
    }
  }

  if (layout === "compact") {
    /* Three small buttons in a row — used in the list's "Copies" column, where
       the invoice total is already shown and repeating the amount per copy
       would be three times the same number. */
    return (
      <View style={styles.compactRow}>
        {BILL_COPIES.map((copy) => {
          const available = !!billCopyPath(bill, copy);
          return (
            <Pressable
              key={copy}
              onPress={() => run(copy, "view")}
              disabled={!available || busy === copy}
              accessibilityRole="button"
              accessibilityLabel={
                available
                  ? `View the ${BILL_COPY_LABEL[copy].toLowerCase()} copy`
                  : `The ${BILL_COPY_LABEL[copy].toLowerCase()} copy is not available`
              }
              accessibilityState={{ disabled: !available }}
              style={({ pressed }) => [
                styles.compactBtn,
                !available && styles.compactBtnDisabled,
                pressed && available && styles.pressed,
              ]}
            >
              {busy === copy ? (
                <ActivityIndicator size="small" color={theme.colors.textMuted} />
              ) : (
                <Text
                  style={[
                    styles.compactText,
                    !available && styles.compactTextDisabled,
                  ]}
                >
                  {BILL_COPY_LABEL[copy].slice(0, 3)}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {BILL_COPIES.map((copy) => {
        const available = !!billCopyPath(bill, copy);
        const rowBusy = busy === copy;
        return (
          <View key={copy} style={styles.row}>
            <View style={styles.rowInfo}>
              <Text style={styles.rowTitle}>{BILL_COPY_LABEL[copy]}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {available
                  ? `${bill.base_name}_${copy}.pdf`
                  : "Not generated for this workbook"}
              </Text>
            </View>

            {showMoney && (
              <Text style={styles.rowMoney}>{formatMoney(bill.amount_after_tax)}</Text>
            )}

            <View style={styles.rowActions}>
              {(["view", "download", "print"] as const).map((action) => (
                <Pressable
                  key={action}
                  onPress={() => run(copy, action)}
                  disabled={!available || rowBusy}
                  accessibilityRole="button"
                  accessibilityLabel={`${ACTION_GLYPH[action]} the ${BILL_COPY_LABEL[
                    copy
                  ].toLowerCase()} copy`}
                  accessibilityState={{ disabled: !available, busy: rowBusy }}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    !available && styles.actionBtnDisabled,
                    pressed && available && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.actionText,
                      !available && styles.actionTextDisabled,
                    ]}
                  >
                    {ACTION_GLYPH[action]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    compactRow: { flexDirection: "row", gap: 4 },
    compactBtn: {
      minWidth: 38,
      minHeight: 30,
      paddingHorizontal: 6,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    compactBtnDisabled: { opacity: 0.4 },
    compactText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    compactTextDisabled: { color: theme.colors.textMuted },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      padding: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceSecondary,
    },
    rowInfo: { flex: 1, minWidth: 0 },
    rowTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    rowSub: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },
    rowMoney: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    rowActions: { flexDirection: "row", gap: 4 },
    actionBtn: {
      minHeight: 34,
      paddingHorizontal: 10,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    actionBtnDisabled: { opacity: 0.4 },
    actionText: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    actionTextDisabled: { color: theme.colors.textMuted },
    pressed: { opacity: 0.7 },
  });
