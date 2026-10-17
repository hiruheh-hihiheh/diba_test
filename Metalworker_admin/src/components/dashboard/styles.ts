// src/components/dashboard/styles.ts
//
// Shared dashboard layout: the greeting hero, the attention card, section
// rhythm and the inline error banner. Card internals live with their own
// components so each surface can evolve without touching the others.
import { StyleSheet } from "react-native";

import { AppTheme } from "../../constants/theme";

export const createDashboardStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.xl,
      gap: theme.spacing.lg,
    },

    /* ── Hero ────────────────────────────────────────────── */
    heroTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.md,
    },
    eyebrow: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.caption,
      fontWeight: "700",
      letterSpacing: 1.4,
    },
    heroRight: { flexDirection: "row", alignItems: "center", gap: 8 },
    dateText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "500",
    },
    greeting: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xxl,
      fontWeight: "800",
      letterSpacing: -1,
      lineHeight: 38,
    },
    heroSubtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
      marginTop: 6,
      marginBottom: theme.spacing.md,
    },

    /* ── Attention card ──────────────────────────────────── */
    attentionCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm + 4,
      padding: theme.spacing.md,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      backgroundColor: theme.colors.surface,
    },
    attentionIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    attentionText: { flex: 1, minWidth: 0 },
    attentionEyebrow: {
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1.1,
      marginBottom: 2,
    },
    attentionTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    attentionBody: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 2,
    },

    /* ── Banners ─────────────────────────────────────────── */
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      backgroundColor: theme.colors.dangerMuted,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger + "55",
      padding: theme.spacing.md,
    },
    errorBannerText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.sm,
      flex: 1,
    },
    retryText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },

    /* ── Forms ───────────────────────────────────────────── */
    formLabel: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
      marginBottom: 6,
    },
    formMessage: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 11,
      borderRadius: theme.radius.md,
      marginBottom: theme.spacing.md,
    },
    formMessageText: {
      flex: 1,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
    },

    /* ── Misc ────────────────────────────────────────────── */
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
      gap: theme.spacing.md,
    },
    loadingMark: {
      width: 52,
      height: 52,
      borderRadius: 16,
      backgroundColor: theme.colors.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
  });
