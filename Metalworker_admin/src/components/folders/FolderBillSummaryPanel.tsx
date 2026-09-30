// src/components/folders/FolderBillSummaryPanel.tsx
//
// The financial roll-up for the bills in one folder.
//
// WHY A SEPARATE PANEL
// The aggregation is done by the `get_folder_bill_summary` RPC (migration 0006),
// which de-duplicates over `WITH unique_bills AS (SELECT DISTINCT …)`. That
// matters: the three print copies of an invoice are three PDFs but ONE `bills`
// row, so counting per copy would triple every total. Doing the de-duplication in
// one place on the server also means this panel cannot disagree with itself.
//
// FAILURE IS NOT FATAL
// A folder page that cannot show bill totals is still a working folder page, so
// this is a separate effect from the folder load and renders a single line of
// text on failure. If migration 0006 has not been applied, the RPC is missing and
// the rest of the screen carries on.

import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { fetchFolderBillSummary, formatMoney, formatQuantity } from "../../services/bills";
import type { FolderBillSummary } from "../../types/bill";

function SummaryFigure({
  label,
  value,
  emphasis,
  styles,
  theme,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  styles: SummaryStyles;
  theme: AppTheme;
}) {
  return (
    <View
      style={[
        styles.figure,
        emphasis
          ? { backgroundColor: theme.colors.primaryMuted }
          : {
              backgroundColor: theme.colors.surfaceSecondary,
              borderWidth: 1,
              borderColor: theme.colors.border,
            },
      ]}
    >
      <Text style={styles.figureLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={[styles.figureValue, emphasis && { color: theme.colors.primary }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

type SummaryStyles = ReturnType<typeof createStyles>;

export function FolderBillSummaryPanel({ folderId }: { folderId: string }) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [summary, setSummary] = useState<FolderBillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* The fetch is started from the effect and every setState happens in a
     promise callback, never synchronously in the effect body. `loading` starts
     true, so the first frame is a spinner and the flag is only ever lowered by
     a real response. */
  useEffect(() => {
    let cancelled = false;
    fetchFolderBillSummary(folderId)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSummary(null);
        setError(err instanceof Error ? err.message : "unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  if (loading) {
    return (
      <View style={styles.loading} accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.colors.primary} size="small" />
      </View>
    );
  }

  if (error) {
    return (
      <Text style={styles.errorNote}>
        Bill totals are unavailable: {error}
      </Text>
    );
  }

  /* Nothing to show for a folder with no bills: a panel of twelve zeroes reads
     as a mistake, not as "this folder has no bills". */
  if (!summary || summary.total_bills === 0) return null;

  const figures = [
    { label: "Total bills", value: String(summary.total_bills) },
    { label: "Total quantity", value: formatQuantity(summary.total_quantity) },
    { label: "Amount before tax", value: formatMoney(summary.total_amount_before_tax) },
    { label: "CGST", value: formatMoney(summary.total_cgst) },
    { label: "SGST", value: formatMoney(summary.total_sgst) },
    { label: "IGST", value: formatMoney(summary.total_igst) },
    { label: "Total GST", value: formatMoney(summary.total_gst) },
    { label: "Round off", value: formatMoney(summary.total_round_off) },
    {
      label: "Amount after tax",
      value: formatMoney(summary.total_amount_after_tax),
      emphasis: true,
    },
    { label: "Average bill value", value: formatMoney(summary.average_bill_value) },
    { label: "Average quantity", value: formatQuantity(summary.average_quantity) },
    {
      label: "Average before tax",
      value: formatMoney(summary.average_amount_before_tax),
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>🧾  Bill summary</Text>
        <Text style={styles.subtitle}>
          {summary.total_bills}{" "}
          {summary.total_bills === 1 ? "bill" : "bills"} in this folder · each invoice
          counted once, not once per print copy
        </Text>
      </View>
      <View style={styles.grid}>
        {figures.map((f) => (
          <SummaryFigure
            key={f.label}
            label={f.label}
            value={f.value}
            emphasis={f.emphasis}
            styles={styles}
            theme={theme}
          />
        ))}
      </View>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    loading: { paddingVertical: theme.spacing.md, alignItems: "center" },
    errorNote: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      lineHeight: 18,
      paddingHorizontal: theme.spacing.sm,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    header: { marginBottom: theme.spacing.sm },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      lineHeight: 18,
      marginTop: 2,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
    figure: {
      flexGrow: 1,
      flexBasis: "46%",
      borderRadius: theme.radius.md,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
    },
    figureLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    figureValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
      marginTop: 2,
    },
  });
