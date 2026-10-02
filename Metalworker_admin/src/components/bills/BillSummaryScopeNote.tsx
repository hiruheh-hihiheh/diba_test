// src/components/bills/BillSummaryScopeNote.tsx
//
// Which bills the folder's money figures actually cover.
//
// WHY THIS IS ITS OWN FILE
// The wording below is the only thing that tells a user a folder total excludes
// some of its bills. Three screens need it — the admin `BillingFolderSheet`, the
// admin `FolderBillSummaryPanel`, and (in the desktop client) the desktop
// `BillingFolderSheet` — and a sentence that quietly disagrees between three
// screens is exactly the failure this is meant to prevent. So it is written once.
// These are presentation strings: this component reads `FolderBillSummary` and
// formats it. It performs no arithmetic on the figures.
//
// WHAT IT SAYS, AND WHY EACH PART IS HERE
//   * Always: how many bills, and how many of them have a recorded after-tax
//     total. That is the scope of everything below.
//   * When some are missing: that the money EXCLUDES them rather than counting
//     them as ₹0 — the two are completely different numbers and the user has to be
//     able to tell which one they are looking at.
//   * When ALL are missing: that the ₹0.00 figures below are an absence of data,
//     not a folder of free work. This is the case that must never be mistaken for
//     a real total, so it is stated in its own words rather than as a variation of
//     the partial case.
//
// THE RULES THEMSELVES ARE NOT HERE
// "Which bills count as priced" is decided once, in `get_folder_bill_summary`
// (migration 0010), and this component only reports what that RPC returned. See
// `FolderBillSummary` in `types/bill.ts` for the full population table.

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { FolderBillSummary } from "../../types/bill";

/**
 * The scope line plus any warning about bills that carry no recorded total.
 *
 * Renders nothing for an empty folder: the callers do not render a summary panel
 * for one, and "0 of 0 bills have no recorded total" is noise, not information.
 */
export function BillSummaryScopeNote({ summary }: { summary: FolderBillSummary }) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const { total_bills: total, bills_without_total: missing, bills_with_total: priced } = summary;

  if (total === 0) return null;

  /* `null` means the RPC predates the `bills_with_total` column, so the coverage
     is unknown — not zero. The line then states only what is known instead of
     implying complete coverage. */
  const pricedKnown = priced !== null;
  const pricedCount = pricedKnown ? priced : total - missing;

  const scope =
    pricedKnown && missing === 0
      ? `${total} ${total === 1 ? "bill" : "bills"} — all with a recorded after-tax total, so every figure below covers the whole folder`
      : pricedKnown
        ? `${total} ${total === 1 ? "bill" : "bills"} — ${pricedCount} with a recorded after-tax total${missing > 0 ? `, ${missing} without one` : ""}`
        : `${total} ${total === 1 ? "bill" : "bills"} in this folder`;

  return (
    <View style={styles.wrap}>
      <Text style={styles.scope}>{scope}.</Text>

      {pricedKnown && pricedCount === 0 && (
        <Text style={styles.warn}>
          No bill in this folder has a recorded after-tax total. Every money figure
          below reads ₹0.00 because nothing was recorded — not because this work was
          free. Only the bill count and the quantity are real numbers here.
        </Text>
      )}

      {pricedKnown && pricedCount > 0 && missing > 0 && (
        <Text style={styles.warn}>
          {missing} of {total} bills have no recorded after-tax total. The money totals
          and the averages below cover only the {pricedCount} bills that do — a missing
          total is left out, not counted as ₹0.00. The bill count and the total
          quantity still include all {total}.
        </Text>
      )}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: { marginBottom: theme.spacing.sm },
    scope: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      lineHeight: 18,
    },
    warn: {
      color: theme.colors.warning,
      fontSize: theme.textSizes.xs,
      lineHeight: 18,
      marginTop: theme.spacing.xs,
    },
  });