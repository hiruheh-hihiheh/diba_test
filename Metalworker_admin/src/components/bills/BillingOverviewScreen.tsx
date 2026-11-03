// src/components/bills/BillingOverviewScreen.tsx
//
// The Billing entry point on a phone: the same two cards as the desktop page, in a
// column on a narrow screen and side by side on a wide one.
//
// The two sections already exist and are untouched (`/bills` and `/challan-bills`).
// This screen only chooses between them and shows the three numbers that say what is
// behind each. Counts come from `fetchBillUploads(type)` and
// `fetchBills({ documentType: type })`, scoped to one document type each, so a card
// cannot count the other section's workbooks; nothing here reads a PDF or a workbook.

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useFocusEffect, type Href } from "expo-router";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { fetchBillUploadSummary, fetchBills } from "../../services/bills";
import { DOCUMENT_TYPE_INFO, type BillDocumentType } from "../../services/billDocumentTypes";
import {
  formatUploadDate,
  summarizeBilling,
  type BillingSummary,
} from "../../services/billingOverview";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { ScreenHeader } from "../ui/ScreenHeader";

interface CardState {
  summary: BillingSummary;
  loading: boolean;
  error: string | null;
}

const EMPTY: BillingSummary = { workbooks: 0, bills: 0, latestUpload: null };

const CARD_CONTENT: Record<
  BillDocumentType,
  { title: string; description: string; icon: IconName; noun: string }
> = {
  tax_invoice: {
    title: "Tax Invoice Billing",
    description:
      "Access all your Tax Invoice Excel workbooks, uploaded bills and generated PDF copies.",
    icon: "file",
    noun: "Invoices",
  },
  delivery_challan: {
    title: "Challan Billing",
    description:
      "Access all your Delivery Challan Excel workbooks, uploaded challans and generated PDF copies.",
    icon: "receipt",
    noun: "Challans",
  },
};

const CARD_ORDER: BillDocumentType[] = ["tax_invoice", "delivery_challan"];

function Stat({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function BillingOverviewScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const sideBySide = width >= 700;

  const [cards, setCards] = useState<Record<BillDocumentType, CardState>>({
    tax_invoice: { summary: EMPTY, loading: true, error: null },
    delivery_challan: { summary: EMPTY, loading: true, error: null },
  });

  const loadType = useCallback(async (type: BillDocumentType) => {
    setCards((prev) => ({ ...prev, [type]: { ...prev[type], loading: true, error: null } }));
    try {
      /* Provenance-aware summary answers "how many Excel workbooks, and when was the
         newest one" (manual bills excluded); a one-row page answers "how many
         records" with the same count the section itself trusts, manual bills
         included. The row is not used, so one is enough. */
      const [uploads, firstPage] = await Promise.all([
        fetchBillUploadSummary(type),
        fetchBills({ documentType: type, page: 1, pageSize: 1 }),
      ]);
      setCards((prev) => ({
        ...prev,
        [type]: {
          summary: summarizeBilling(uploads, firstPage.total),
          loading: false,
          error: null,
        },
      }));
    } catch (err) {
      setCards((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          loading: false,
          error: err instanceof Error ? err.message : "This section could not be counted.",
        },
      }));
    }
  }, []);

  /* Refresh on every return, because a workbook uploaded in one section changes the
     number on this page. The first focus IS the initial load: there is no other
     effect, so the two cannot race. */
  useFocusEffect(
    useCallback(() => {
      void loadType("tax_invoice");
      void loadType("delivery_challan");
    }, [loadType])
  );

  const anyError = CARD_ORDER.some((type) => cards[type].error !== null);
  const loadingAny = CARD_ORDER.some((type) => cards[type].loading);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          eyebrow="Documents"
          title="Billing Overview"
          subtitle="Choose a billing section. Tax invoices and delivery challans stay separate."
        />

        <View style={[styles.cards, sideBySide && styles.cardsRow]}>
          {CARD_ORDER.map((type) => {
            const info = DOCUMENT_TYPE_INFO[type];
            const content = CARD_CONTENT[type];
            const state = cards[type];

            return (
              <Card
                key={type}
                onPress={() => router.push(info.route as Href)}
                accessibilityLabel={`Open ${content.title}`}
                accessibilityHint={content.description}
                style={[styles.card, sideBySide && styles.cardRow]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.iconBox}>
                    <Icon name={content.icon} size={22} color={theme.colors.primary} />
                  </View>
                  <View style={styles.cardHeading}>
                    <Text style={styles.cardTitle}>{content.title}</Text>
                    <Text style={styles.cardSection}>{info.section}</Text>
                  </View>
                  <Icon name="chevronRight" size={18} color={theme.colors.textMuted} />
                </View>

                <Text style={styles.cardBody}>{content.description}</Text>

                {state.error ? (
                  <Text style={styles.cardError}>{state.error}</Text>
                ) : state.loading ? (
                  <View style={styles.stats} accessibilityLabel={`Counting ${info.section}`}>
                    {[0, 1, 2].map((i) => (
                      <View key={i} style={styles.stat}>
                        <View style={[styles.skeletonBar, { width: "58%" }]} />
                        <View style={[styles.skeletonBar, { width: "78%", marginTop: 6 }]} />
                      </View>
                    ))}
                  </View>
                ) : (
                  <>
                    <View style={styles.stats}>
                      <Stat label="Workbooks" value={String(state.summary.workbooks)} styles={styles} />
                      <Stat label={content.noun} value={String(state.summary.bills)} styles={styles} />
                      <Stat
                        label="Latest upload"
                        value={
                          state.summary.latestUpload
                            ? formatUploadDate(state.summary.latestUpload)
                            : "No Excel uploads yet"
                        }
                        styles={styles}
                      />
                    </View>
                    {state.summary.workbooks === 0 && (
                      <Text style={styles.emptyHint}>No Excel workbooks uploaded yet.</Text>
                    )}
                    {state.summary.bills === 0 && (
                      <Text style={styles.emptyHint}>
                        This section is empty — open it to create a {info.word} or upload a
                        workbook.
                      </Text>
                    )}
                  </>
                )}

                <View style={styles.openRow}>
                  <Text style={styles.openText}>Open {info.section}</Text>
                  <Icon name="arrowRight" size={14} color={theme.colors.primary} />
                </View>
              </Card>
            );
          })}
        </View>

        {loadingAny && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={styles.loadingText}>Counting workbooks and records…</Text>
          </View>
        )}

        {anyError && (
          <Pressable
            onPress={() => {
              void loadType("tax_invoice");
              void loadType("delivery_challan");
            }}
            accessibilityRole="button"
            accessibilityLabel="Try counting the billing sections again"
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    content: { padding: theme.spacing.lg, paddingBottom: theme.spacing.xl },

    cards: { gap: theme.spacing.md },
    cardsRow: { flexDirection: "row", alignItems: "stretch" },
    card: { gap: theme.spacing.sm },
    cardRow: { flex: 1 },

    cardTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
    },
    iconBox: {
      width: 44,
      height: 44,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.primarySoft,
    },
    cardHeading: { flex: 1, minWidth: 0 },
    cardTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "800",
      letterSpacing: -0.2,
    },
    cardSection: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 1,
    },
    cardBody: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
    },

    stats: {
      flexDirection: "row",
      gap: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      paddingTop: theme.spacing.sm,
      marginTop: 2,
    },
    stat: { flex: 1, minWidth: 0 },
    statLabel: {
      color: theme.colors.textMuted,
      fontSize: 9.5,
      fontWeight: "700",
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    statValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "800",
      marginTop: 2,
    },
    skeletonBar: {
      height: 9,
      borderRadius: 4,
      backgroundColor: theme.colors.surfaceHover,
      opacity: 0.7,
    },
    emptyHint: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      lineHeight: 16,
    },

    cardError: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
    },

    openRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: "auto",
      paddingTop: theme.spacing.xs,
    },
    openText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },

    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
    },
    loadingText: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs },
    retry: { alignSelf: "flex-start", marginTop: theme.spacing.md, paddingVertical: 6 },
    retryText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
  });
