// src/components/folders/FolderBillSummaryPanel.tsx
//
// The financial roll-up for the bills in one folder.
//
// WHERE EVERY NUMBER COMES FROM
// All of it comes out of the `get_folder_bill_summary` RPC (migration 0006, extended
// by 0009). Nothing here sums, averages or divides. That is deliberate: the function
// de-duplicates over `WITH unique_bills AS (SELECT DISTINCT ...)`, so the three print
// copies of an invoice — three PDFs but ONE `bills` row — cannot triple a total, and
// having exactly one implementation of the rule is what stops the admin app, the
// desktop app and this panel from each arriving at a different number.
//
// WHY ORIGINAL + DUPLICATE + TRIPLICATE IS NOT THREE BILLS
// The copies are three PDF paths on one bill row (`original_pdf_path`,
// `duplicate_pdf_path`, `triplicate_pdf_path`). They are not rows in `bills` and they
// are not folder items. So a folder holding one invoice reports one bill, no matter
// how many copies were generated for it. This is stated on screen rather than left
// implicit, because "why is this 1 and not 3" is the obvious first question.
//
// FAILURE IS NOT FATAL
// A folder page that cannot show bill totals is still a working folder page, so this
// is a separate effect from the folder load and renders one line of text on failure.
// If migration 0006 has not been applied the RPC is missing and the rest of the screen
// carries on. The new 0009 columns are optional in the row type for the same reason: a
// read against a database that only has 0006 applied still yields the figures it has,
// and the ones it does not fall back to 0 rather than reaching a formatter as NaN.

import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  fetchFolderBillSummary,
  formatJobKind,
  formatMoney,
  formatQuantity,
} from "../../services/bills";
import type { FolderBillSummary } from "../../types/bill";

type SummaryStyles = ReturnType<typeof createStyles>;

/** One label / value tile. Takes an already-formatted string; does no arithmetic. */
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

/** A section heading between the tiles. */
function SectionHeading({ label, styles }: { label: string; styles: SummaryStyles }) {
  return <Text style={styles.sectionHeading}>{label}</Text>;
}

export function FolderBillSummaryPanel({ folderId }: { folderId: string }) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [summary, setSummary] = useState<FolderBillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* The fetch is started from the effect and every setState happens in a promise
     callback, never synchronously in the effect body. `loading` starts true, so the
     first frame is a spinner and the flag is only ever lowered by a real response. */
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
    return <Text style={styles.errorNote}>Bill totals are unavailable: {error}</Text>;
  }

  /* Nothing to show for a folder with no bills: a panel of zeroes reads as a mistake,
     not as "this folder has no bills". */
  if (!summary || summary.total_bills === 0) return null;

  const hasBills = summary.total_bills > 0;

  /* Min and max are shown as an em dash on an empty folder rather than as ₹0.00.
     A zero is a real financial figure — a genuinely free invoice — and "there are no
     bills" must not be drawn as one. */
  const spread = (value: number) => (hasBills ? formatMoney(value) : "—");

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Bill summary</Text>
        <Text style={styles.subtitle}>
          {summary.total_bills}{" "}
          {summary.total_bills === 1 ? "bill" : "bills"} in this folder — each invoice
          counted once, not once per print copy
        </Text>
      </View>

      <SectionHeading label="Totals" styles={styles} />
      <View style={styles.grid}>
        <SummaryFigure
          label="Bills"
          value={String(summary.total_bills)}
          emphasis
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Quantity"
          value={formatQuantity(summary.total_quantity)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Before tax"
          value={formatMoney(summary.total_amount_before_tax)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="After tax"
          value={formatMoney(summary.total_amount_after_tax)}
          emphasis
          styles={styles}
          theme={theme}
        />
      </View>

      <SectionHeading label="Tax" styles={styles} />
      <View style={styles.grid}>
        <SummaryFigure
          label="CGST"
          value={formatMoney(summary.total_cgst)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="SGST"
          value={formatMoney(summary.total_sgst)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="IGST"
          value={formatMoney(summary.total_igst)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Total GST"
          value={formatMoney(summary.total_gst)}
          emphasis
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Round off"
          value={formatMoney(summary.total_round_off)}
          styles={styles}
          theme={theme}
        />
      </View>

      <SectionHeading label="Average per bill" styles={styles} />
      <View style={styles.grid}>
        <SummaryFigure
          label="Bill value"
          value={formatMoney(summary.average_bill_value)}
          emphasis
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Quantity"
          value={formatQuantity(summary.average_quantity)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Before tax"
          value={formatMoney(summary.average_amount_before_tax)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="After tax"
          value={formatMoney(summary.average_bill_value)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="CGST"
          value={formatMoney(summary.average_cgst)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="SGST"
          value={formatMoney(summary.average_sgst)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="IGST"
          value={formatMoney(summary.average_igst)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Total GST"
          value={formatMoney(summary.average_gst)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Round off"
          value={formatMoney(summary.average_round_off)}
          styles={styles}
          theme={theme}
        />
      </View>

      <SectionHeading label="Spread" styles={styles} />
      <View style={styles.grid}>
        <SummaryFigure
          label="Lowest bill"
          value={spread(summary.min_amount_after_tax)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Highest bill"
          value={spread(summary.max_amount_after_tax)}
          emphasis
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Lowest before tax"
          value={spread(summary.min_amount_before_tax)}
          styles={styles}
          theme={theme}
        />
        <SummaryFigure
          label="Highest before tax"
          value={spread(summary.max_amount_before_tax)}
          styles={styles}
          theme={theme}
        />
      </View>

      {/* Only the `bills.job_kind` values that actually exist in this folder, cleaned
          up for display. Nothing is folded into a catch-all "Other" the user cannot
          see, and no category is invented. */}
      {summary.job_kind_breakdown.length > 0 && (
        <>
          <SectionHeading label="By job type" styles={styles} />
          <View style={styles.grid}>
            {summary.job_kind_breakdown.map((bucket, index) => (
              <SummaryFigure
                key={`${bucket.job_kind ?? "none"}-${index}`}
                label={bucket.job_kind ? formatJobKind(bucket.job_kind) ?? bucket.job_kind : "Unclassified"}
                value={`${bucket.count} ${bucket.count === 1 ? "bill" : "bills"}`}
                styles={styles}
                theme={theme}
              />
            ))}
          </View>
        </>
      )}

      {/* Bills whose after-tax total was never imported read as "not counted", not as
          ₹0.00. This matters because a zero here would drag every average down without
          any visible reason why. */}
      {summary.bills_without_total > 0 && (
        <Text style={styles.warnNote}>
          {summary.bills_without_total} of {summary.total_bills} bills have no recorded
          after-tax total, so the totals and averages above leave them out.
        </Text>
      )}
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
    sectionHeading: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.xs,
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
    warnNote: {
      color: theme.colors.warning,
      fontSize: theme.textSizes.xs,
      lineHeight: 18,
      marginTop: theme.spacing.sm,
    },
  });