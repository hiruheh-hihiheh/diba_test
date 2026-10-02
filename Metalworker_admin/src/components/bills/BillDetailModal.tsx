// src/components/bills/BillDetailModal.tsx
//
// Everything known about one invoice: identity, transport, party, tax summary,
// the line items, and the three print copies.
//
// The amounts are per INVOICE. The three copies are renderings of the same
// figures, so they are listed as documents to open, never added together.

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  bankLinesOf,
  fetchBill,
  fetchBillLineItems,
  formatBillDate,
  formatMoney,
  formatJobKind,
  formatQuantity,
} from "../../services/bills";
import type { Bill, BillLineItem } from "../../types/bill";
import { BillCopyActions } from "./BillCopyActions";
import { BillLogoControl } from "./BillLogoControl";
import { Button } from "../ui/Button";
import { notify } from "../../utils/notify";

type DetailStyles = ReturnType<typeof createStyles>;

/** A labelled value that hides itself entirely when there is nothing to show. */
function Field({
  label,
  value,
  styles,
}: {
  label: string;
  value: string | null;
  styles: DetailStyles;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <View style={styles.fieldCell}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

/** One figure in the tax summary strip. `format` keeps quantity out of `formatMoney`. */
function Figure({
  label,
  value,
  format = formatMoney,
  emphasis,
  styles,
  theme,
}: {
  label: string;
  value: number | null;
  format?: (v: number | null) => string;
  emphasis?: boolean;
  styles: DetailStyles;
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
      <Text style={styles.figureLabel}>{label}</Text>
      <Text
        style={[
          styles.figureValue,
          emphasis && { color: theme.colors.primary },
        ]}
      >
        {format(value)}
      </Text>
    </View>
  );
}

export function BillDetailModal({
  billId,
  onClose,
  onOpenFolderPicker,
  onEdit,
}: {
  billId: string | null;
  onClose: () => void;
  onOpenFolderPicker: (bill: Bill) => void;
  onEdit: (bill: Bill) => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [bill, setBill] = useState<Bill | null>(null);
  const [lines, setLines] = useState<BillLineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Clearing on open is a RENDER-phase adjustment, not an effect. React's
     documented pattern: when a prop changes to a new "identity", reset the
     derived state during the same render rather than in an effect, which would
     paint one frame of the previous bill's figures. The effect below then only
     ever does asynchronous work, so it never calls setState synchronously. */
  const [shownId, setShownId] = useState(billId);
  if (billId !== shownId) {
    setShownId(billId);
    setBill(null);
    setLines([]);
    setError(null);
    setLoading(!!billId);
  }

  useEffect(() => {
    if (!billId) return;

    let cancelled = false;

    (async () => {
      try {
        const [b, l] = await Promise.all([fetchBill(billId), fetchBillLineItems(billId)]);
        if (cancelled) return;
        setBill(b);
        setLines(l);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "That bill could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [billId]);

  async function retry() {
    if (!billId) return;
    setLoading(true);
    setError(null);
    try {
      const [b, l] = await Promise.all([fetchBill(billId), fetchBillLineItems(billId)]);
      setBill(b);
      setLines(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That bill could not be loaded.");
      notify("Could not load this bill", err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  /* The bank block is stored as label/value parts and was an array of printed lines
     before the editing migration, so it is resolved once here rather than being
     mapped over in the markup, where the two shapes would not type-check against
     each other. */
  const bankLines = bankLinesOf(bill?.bank_details);

  return (
    <Modal
      visible={!!billId}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title} numberOfLines={1}>
            {bill?.invoice_no ? `Bill ${bill.invoice_no}` : "Bill"}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {bill
              ? /* Appended, not substituted: the header still reads sheet then
                 workbook, and the classification is visible without scrolling. */
                [
                  `Sheet ${bill.sheet_name}`,
                  bill.original_filename,
                  formatJobKind(bill.job_kind),
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Loading the invoice…"}
          </Text>

          {loading && (
            <View
              style={styles.center}
              accessibilityLiveRegion="polite"
              accessibilityLabel="Loading bill"
            >
              <ActivityIndicator color={theme.colors.primary} size="large" />
            </View>
          )}

          {error && !loading && (
            <View style={{ gap: theme.spacing.md }}>
              <Text style={styles.error}>{error}</Text>
              <Button title="Try again" onPress={() => void retry()} />
            </View>
          )}

          {bill && !loading && (
            <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
              {/* ── Tax summary ─────────────────────────────────── */}
              <Text style={styles.sectionTitle}>Amounts</Text>
              <View style={styles.figureGrid}>
                <Figure label="Before tax" value={bill.amount_before_tax} styles={styles} theme={theme} />
                <Figure label="CGST" value={bill.cgst} styles={styles} theme={theme} />
                <Figure label="SGST" value={bill.sgst} styles={styles} theme={theme} />
                <Figure label="IGST" value={bill.igst} styles={styles} theme={theme} />
                <Figure label="Total GST" value={bill.total_gst} styles={styles} theme={theme} />
                <Figure label="Round off" value={bill.round_off} styles={styles} theme={theme} />
                <Figure label="After tax" value={bill.amount_after_tax} emphasis styles={styles} theme={theme} />
                <Figure
                  label="Quantity"
                  value={bill.total_quantity}
                  format={formatQuantity} styles={styles} theme={theme} />
              </View>

              {/* ── Identity ────────────────────────────────────── */}
              <View style={styles.fieldGrid}>
                <Field label="Invoice no" value={bill.invoice_no} styles={styles} />
                <Field label="Invoice date" value={formatBillDate(bill.invoice_date)} styles={styles} />
                <Field label="Quantity" value={formatQuantity(bill.total_quantity)} styles={styles} />
                <Field label="Job type" value={formatJobKind(bill.job_kind)} styles={styles} />
                <Field label="Seller" value={bill.seller_name} styles={styles} />
                <Field label="Party" value={bill.party_name} styles={styles} />
                <Field label="Party GST no" value={bill.party_gst_no} styles={styles} />
                <Field
                  label="State"
                  value={
                    bill.state
                      ? `${bill.state}${bill.state_code ? ` (${bill.state_code})` : ""}`
                      : null
                  } styles={styles} />
                {bill.order_no ? (
                  <Field label={bill.order_no_label || "Order no"} value={bill.order_no} styles={styles} />
                ) : null}
                <Field label="Order date" value={formatBillDate(bill.order_date)} styles={styles} />
                <Field label="Our challan" value={bill.our_challan_no} styles={styles} />
                <Field label="Our challan date" value={formatBillDate(bill.our_challan_date)} styles={styles} />
                <Field label="Your challan" value={bill.your_challan_no} styles={styles} />
                <Field label="Your challan date" value={formatBillDate(bill.your_challan_date)} styles={styles} />
                <Field label="E-way bill" value={bill.eway_bill_no} styles={styles} />
                <Field label="Vehicle" value={bill.vehicle_number} styles={styles} />
                <Field label="Transporter mode" value={bill.transporter_mode} styles={styles} />
                <Field label="Place of supply" value={bill.place_of_supply} styles={styles} />
              </View>

              {bill.amount_in_words ? (
                <>
                  <Text style={styles.sectionTitle}>Amount in words</Text>
                  <View style={styles.wordsBox}>
                    <Text style={styles.wordsText}>{bill.amount_in_words}</Text>
                  </View>
                </>
              ) : null}

              {/* ── Line items ──────────────────────────────────── */}
              <Text style={styles.sectionTitle}>Line items ({lines.length})</Text>
              {lines.length === 0 ? (
                <Text style={styles.muted}>This invoice has no line items.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled>
                  <View>
                    <View style={styles.tableHead}>
                      <Text style={[styles.th, { width: 34 }]}>#</Text>
                      <Text style={[styles.th, { width: 180 }]}>Description</Text>
                      <Text style={[styles.th, { width: 64 }]}>HSN</Text>
                      <Text style={[styles.th, { width: 70, textAlign: "right" }]}>
                        Qty
                      </Text>
                      <Text style={[styles.th, { width: 88, textAlign: "right" }]}>
                        Rate
                      </Text>
                      <Text style={[styles.th, { width: 96, textAlign: "right" }]}>
                        Amount
                      </Text>
                    </View>
                    {lines.map((line, index) => (
                      <View key={line.id} style={styles.tr}>
                        <Text style={[styles.td, { width: 34 }]}>
                          {line.sr_no ?? index + 1}
                        </Text>
                        <Text style={[styles.td, { width: 180 }]}>
                          {line.description || "—"}
                        </Text>
                        <Text style={[styles.tdMuted, { width: 64 }]}>
                          {line.hsn_code || "—"}
                        </Text>
                        <Text style={[styles.tdRight, { width: 70 }]}>
                          {formatQuantity(line.quantity)}
                          {line.uom ? ` ${line.uom}` : ""}
                        </Text>
                        <Text style={[styles.tdRight, { width: 88 }]}>
                          {formatMoney(line.rate)}
                        </Text>
                        <Text style={[styles.tdBold, { width: 96 }]}>
                          {formatMoney(line.amount)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              )}

              {/* ── Bank / seller / terms ───────────────────────── */}
              {bankLines.length > 0 || bill.seller_address || bill.terms ? (
                <View style={styles.stackSection}>
                  {bankLines.length > 0 ? (
                    <View>
                      <Text style={styles.sectionTitle}>Bank details</Text>
                      {bankLines.map((line, i) => (
                        <Text key={i} style={styles.bodyText}>
                          {line}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {bill.seller_address ? (
                    <View>
                      <Text style={styles.sectionTitle}>Seller address</Text>
                      <Text style={styles.bodyText}>{bill.seller_address}</Text>
                    </View>
                  ) : null}
                  {bill.terms ? (
                    <View>
                      <Text style={styles.sectionTitle}>Terms</Text>
                      <Text style={styles.bodyText}>{bill.terms}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* ── The letterhead, and what will actually print ── */}
              <Text style={styles.sectionTitle}>Invoice logo</Text>
              <Text style={[styles.muted, { marginBottom: theme.spacing.sm }]}>
                This is the logo that prints in the header of all three print copies.
              </Text>
              <BillLogoControl
                billId={bill.id}
                initialState={{
                  logo_id: bill.logo_id,
                  logo_rendered_logo_id: bill.logo_rendered_logo_id,
                  logo: null,
                }}
                onChanged={() => {
                  /* The copy buttons resolve against the PDF paths, which this control
                     does not change — but the header the admin is about to print DOES
                     change, and this modal's own data is now out of date. Re-reading
                     the row is one request on a screen they are looking at, and it is
                     what makes the logo line here and on the list agree. */
                  void fetchBill(bill.id).then((fresh) => {
                    if (bill.id === billId) setBill(fresh);
                  });
                }}
              />

              {/* ── The three copies ────────────────────────────── */}
              <Text style={styles.sectionTitle}>Print copies</Text>
              <Text style={[styles.muted, { marginBottom: theme.spacing.sm }]}>
                Original, duplicate and triplicate are three print copies of this one
                invoice. Each holds this invoice alone, and they are the same figures,
                not extra charges.
              </Text>
              <BillCopyActions bill={bill} />
            </ScrollView>
          )}

          <View style={styles.actions}>
            <Button title="Close" onPress={onClose} variant="ghost" style={styles.actionButton} />
            {bill && !loading && (
              <Button
                title="Add to folder"
                onPress={() => onOpenFolderPicker(bill)}
                style={styles.actionButton}
              />
            )}
            {bill && !loading && (
              <Button
                title="Edit bill"
                onPress={() => onEdit(bill)}
                style={styles.actionButton}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      borderTopWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      maxHeight: "92%",
      minHeight: "60%",
    },
    title: { color: theme.colors.text, fontSize: theme.textSizes.lg, fontWeight: "700" },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      marginBottom: theme.spacing.sm,
    },
    center: { paddingVertical: theme.spacing.xl, alignItems: "center" },
    error: { color: theme.colors.danger, fontSize: theme.textSizes.sm },
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
    fieldCell: { flexGrow: 1, flexBasis: "46%", minWidth: 0 },
    muted: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
    },
    bodyText: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
    },
    sectionTitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.xs,
    },
    figureGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
    fieldGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    fieldLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    fieldValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      marginTop: 2,
      lineHeight: 20,
    },
    wordsBox: {
      backgroundColor: theme.colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
    },
    wordsText: { color: theme.colors.text, fontSize: theme.textSizes.sm, lineHeight: 20 },
    stackSection: { gap: theme.spacing.xs, marginTop: theme.spacing.xs },
    tableHead: {
      flexDirection: "row",
      backgroundColor: theme.colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
    },
    th: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      paddingHorizontal: theme.spacing.xs,
    },
    tr: {
      flexDirection: "row",
      borderWidth: 1,
      borderTopWidth: 0,
      borderColor: theme.colors.border,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
    },
    td: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xs,
      paddingHorizontal: theme.spacing.xs,
    },
    tdMuted: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs, paddingHorizontal: theme.spacing.xs },
    tdRight: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xs,
      textAlign: "right",
      paddingHorizontal: theme.spacing.xs,
    },
    tdBold: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      textAlign: "right",
      paddingHorizontal: theme.spacing.xs,
    },
    actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
    actionButton: { flex: 1 },
  });
