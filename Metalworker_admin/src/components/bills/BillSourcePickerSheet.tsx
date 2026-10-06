// src/components/bills/BillSourcePickerSheet.tsx
//
// PICKING THE BILL TO COPY, ON A PHONE.
//
// THE SAME CHOICE THE DESKTOP PICKER OFFERS
//
// This is a React Native port of `Metalworker_desktop/src/components/bills/BillSourcePicker.tsx`,
// not a second way of choosing. Same search, same confirmation step, same promise: the
// source bill is read, its data is copied into a new draft, and the original is never
// written to. The picker is the only place in either app that turns "copy this bill" into
// "copy THAT bill", and having it disagree between platforms would mean the copy flow
// behaves differently depending on which device an admin happened to be holding.
//
// WHY THE TWO STEPS ARE TWO STEPS
//
// Searching and confirming are separate screens on a phone, where they would be one
// dialog on a desktop. That is a layout consequence, not a behaviour difference: the row
// has to be picked before the confirmation can name it, and on a small screen showing
// both at once would push the confirm button off the bottom.
//
// THE PDF IS NEVER OPENED
//
// Same rule as the desktop picker, and for the same reason. This reads `bills` rows and
// their line items. A copy that re-derived its source from a printed document would be a
// second parser, and the differences between it and the stored data would be invisible.

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { fetchBills } from "../../services/bills";
import { formatBillDate, formatJobKind } from "../../services/billFormat";
import { getBillConnectionCounts } from "../../services/billJobConnections";
import type { Bill } from "../../types/bill";

const PAGE_SIZE = 25;

export interface BillSourcePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the confirmed source bill id. The original is never modified. */
  onConfirm: (billId: string) => void;
}

type Styles = ReturnType<typeof createStyles>;

export function BillSourcePickerSheet(props: BillSourcePickerSheetProps) {
  /* A shell that owns open/close and nothing else. When `visible` swings false the body
     is unmounted; when it comes back the body mounts fresh with `chosen` null again.
     That unmount is the reset: it works on EVERY dismissal path — the Close button, the
     Android back gesture, and the confirm path that routes straight out of this dialog —
     which is more than any per-field cleanup can promise, because a manual reset has to
     be remembered at each exit and a missing one silently re-arms the stale choice. */
  if (!props.visible) return null;
  return <BillSourcePickerSheetBody {...props} />;
}

function BillSourcePickerSheetBody({ onClose, onConfirm }: BillSourcePickerSheetProps) {
  const { theme } = useTheme();

  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Bill[]>([]);
  const [counts, setCounts] = useState<Map<string, { total: number }>>(new Map());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Bill | null>(null);

  const styles: Styles = useMemo(() => createStyles(theme), [theme]);

  /* Search as the admin types, but not on every keystroke. 250ms is long enough to
     coalesce a fast typist into one request and short enough that it still feels like
     typing — the same number the desktop picker uses, so the two feel identical.
     `visible` is not a dependency: the body only exists while the sheet is up, so every
     run of this effect IS while visible. */
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        fetchBills({ search: search.trim(), page: 1, pageSize: PAGE_SIZE })
          .then((page) => {
            if (!live) return;
            setRows(page.rows);
            setTotal(page.total);
            if (page.rows.length === 0) {
              setCounts(new Map());
              return null;
            }
            /* Counts in a second call rather than joined into the list: the list query is
               the slowest thing on this screen, and the count is one word per row. */
            return getBillConnectionCounts(page.rows.map((row) => row.id)).then((found) => {
              if (live) setCounts(found);
            });
          })
          .catch((err: unknown) => {
            if (live) setError(err instanceof Error ? err.message : "Could not load bills.");
          })
          .finally(() => {
            if (live) setLoading(false);
          });
      },
      search.trim() === "" ? 0 : 250
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);

  const chosenSummary = useMemo(() => {
    if (!chosen) return null;
    return {
      invoice: chosen.invoice_no || "no invoice number",
      party: chosen.party_name || "no customer named",
      date: formatBillDate(chosen.invoice_date),
      kind: formatJobKind(chosen.job_kind) || "no job type",
    };
  }, [chosen]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Copy from a previous bill</Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.headerAction}>Close</Text>
          </Pressable>
        </View>

        {chosen && chosenSummary ? (
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>You’re creating a new bill from…</Text>
              <Text style={styles.summaryInvoice}>{chosenSummary.invoice}</Text>
              <Text style={styles.summaryLine}>{chosenSummary.party}</Text>
              <Text style={styles.summaryMuted}>
                {chosenSummary.date} · {chosenSummary.kind}
              </Text>
              <Text style={styles.note}>
                A draft is created from this bill’s data. The original is not changed, and
                its PDF is not replaced.
              </Text>
            </View>

            <Pressable
              style={styles.primaryBtn}
              onPress={() => onConfirm(chosen.id)}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>Copy as Draft</Text>
            </Pressable>
            <Pressable
              style={styles.ghostBtn}
              onPress={() => setChosen(null)}
              accessibilityRole="button"
            >
              <Text style={styles.ghostBtnText}>Pick a different bill</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <View style={styles.body}>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Invoice number, customer, sheet, date or job type"
              placeholderTextColor={theme.colors.textMuted}
              autoCorrect={false}
            />
            <Text style={styles.resultCount}>
              {total === 0
                ? search.trim() === ""
                  ? "No bills yet"
                  : "Nothing matches"
                : `${total} bill${total === 1 ? "" : "s"}`}
            </Text>

            {loading && rows.length === 0 ? (
              <ActivityIndicator color={theme.colors.primary} style={styles.spinner} />
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <FlatList
                data={rows}
                keyExtractor={(row) => row.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                  <Text style={styles.empty}>
                    {search.trim() === ""
                      ? "There are no bills to copy yet."
                      : "No bill matches that search."}
                  </Text>
                }
                renderItem={({ item }) => {
                  const linked = counts.get(item.id)?.total ?? 0;
                  return (
                    <Pressable
                      style={styles.row}
                      onPress={() => setChosen(item)}
                      accessibilityRole="button"
                    >
                      <View style={styles.rowMain}>
                        <Text style={styles.rowTitle}>
                          {item.invoice_no || "No invoice number"}
                        </Text>
                        <Text style={styles.rowSub}>
                          {item.party_name || "No customer named"}
                        </Text>
                        <Text style={styles.rowMuted}>
                          {formatBillDate(item.invoice_date)}
                          {item.sheet_name ? ` · ${item.sheet_name}` : ""}
                        </Text>
                      </View>
                      <Text style={styles.rowJobs}>
                        {linked === 0 ? "No jobs" : `${linked} job${linked === 1 ? "" : "s"}`}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(theme: AppTheme) {
  const c = theme.colors;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerTitle: { color: c.text, fontSize: theme.textSizes.md, fontWeight: "700" },
    headerAction: { color: c.primary, fontSize: theme.textSizes.sm, fontWeight: "600" },
    body: { flex: 1, padding: theme.spacing.md, gap: theme.spacing.sm },
    search: {
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 10,
      color: c.text,
      fontSize: theme.textSizes.sm,
    },
    resultCount: { color: c.textMuted, fontSize: theme.textSizes.xs },
    spinner: { marginTop: theme.spacing.lg },
    error: { color: c.danger, fontSize: theme.textSizes.sm, marginTop: theme.spacing.sm },
    empty: {
      color: c.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
      paddingVertical: theme.spacing.lg,
    },
    list: { paddingBottom: theme.spacing.xl },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: 10,
      paddingHorizontal: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rowMain: { flex: 1 },
    rowTitle: { color: c.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    rowSub: { color: c.textSecondary, fontSize: theme.textSizes.xs },
    rowMuted: { color: c.textMuted, fontSize: theme.textSizes.xs },
    rowJobs: { color: c.textMuted, fontSize: theme.textSizes.xs, fontWeight: "600" },
    card: {
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: theme.radius.lg,
      padding: theme.spacing.md,
      gap: 4,
    },
    cardTitle: {
      color: c.textMuted,
      fontSize: theme.textSizes.xs,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontWeight: "700",
    },
    summaryInvoice: { color: c.text, fontSize: theme.textSizes.lg, fontWeight: "800" },
    summaryLine: { color: c.textSecondary, fontSize: theme.textSizes.sm },
    summaryMuted: { color: c.textMuted, fontSize: theme.textSizes.xs },
    note: {
      color: c.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: theme.spacing.sm,
      lineHeight: 17,
    },
    primaryBtn: {
      backgroundColor: c.primary,
      borderRadius: theme.radius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    primaryBtnText: { color: c.primaryButtonText, fontWeight: "800", fontSize: theme.textSizes.sm },
    ghostBtn: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: theme.radius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    ghostBtnText: { color: c.textSecondary, fontWeight: "700", fontSize: theme.textSizes.sm },
  });
}