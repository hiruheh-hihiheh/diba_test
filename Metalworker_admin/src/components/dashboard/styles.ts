// src/components/dashboard/styles.ts
import { Platform, StyleSheet } from "react-native";

import { AppTheme } from "../../constants/theme";

/**
 * Card shadow for both platforms. react-native-web does not implement the
 * native `shadow*` props and logs a warning for each one; it wants a single
 * `boxShadow` string instead. Native still wants the `shadow*` family (with
 * `elevation` for Android). `Platform.select` keeps one style sheet usable by
 * every extracted dashboard component.
 */
const cardShadow =
  Platform.select({
    web: { boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)" },
    default: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 4,
      elevation: 2,
    },
  }) ?? {};

export const createDashboardStyles = (theme: AppTheme) =>
  StyleSheet.create({
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.colors.background,
    },
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
    },

    /* HEADER */
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      marginBottom: theme.spacing.xl,
    },
    headerInfo: { flex: 1, marginRight: theme.spacing.md },
    headerTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xl,
      fontWeight: "800",
      marginBottom: 2,
    },
    headerSubtitleLine: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
      marginBottom: 6,
    },
    headerSub: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
    },
    headerSubBold: {
      fontWeight: "700",
      color: theme.colors.text,
    },
    logoutBtn: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.xs + 4,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    logoutText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },

    /* SECTION HEADERS */
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    sectionHeaderLeft: {
      flex: 1,
    },
    sectionTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
    },
    sectionSubtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },

    /* OVERVIEW GRID */
    overviewGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },

    /* STATS */
    statCard: {
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: "47%",
      minWidth: "46%",
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderLeftWidth: 4,
      padding: theme.spacing.md,
      ...cardShadow,
    },
    statIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing.sm,
    },
    statIconText: {
      fontSize: 16,
      fontWeight: "700",
    },
    statValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xl,
      fontWeight: "800",
      marginBottom: 2,
    },
    statTitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
      textTransform: "uppercase",
    },

    /* INLINE LOADER */
    inlineLoader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: theme.spacing.sm,
      marginBottom: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    inlineLoaderText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
    },

    /* ERROR BANNER */
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.colors.danger + "15",
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger + "40",
      padding: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    flashBanner: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.success + "15",
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.success + "40",
      padding: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    flashBannerError: {
      backgroundColor: theme.colors.danger + "15",
      borderColor: theme.colors.danger + "40",
    },
    flashText: {
      color: theme.colors.success,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
      flex: 1,
    },
    flashTextError: {
      color: theme.colors.danger,
    },
    errorBannerText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.sm,
      flex: 1,
      marginRight: theme.spacing.sm,
    },
    retryText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },

    /* SECTION CARD */
    sectionCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.xl,
      ...cardShadow,
    },

    /* DISPATCH ROW */
    dispatchRow: {
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    dispatchRowTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    dispatchRowInfo: {
      flex: 1,
      marginRight: theme.spacing.sm,
    },
    dispatchWorkerName: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      marginBottom: 2,
    },
    dispatchMeta: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
    },
    dispatchStatusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    dispatchStatusText: {
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    dispatchDate: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 2,
    },

    /* EMPTY STATES */
    emptyState: { paddingVertical: theme.spacing.xl, alignItems: "center" },
    emptyStateCard: {
      alignItems: "center",
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
    },
    emptyStateIcon: {
      fontSize: 32,
      marginBottom: theme.spacing.sm,
    },
    emptyStateTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      marginBottom: 4,
    },
    emptyStateText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
    },
    emptyText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
      paddingVertical: theme.spacing.lg,
    },

    /* VIEW ALL BTN */
    viewAllBtn: {
      marginTop: theme.spacing.md,
      paddingVertical: theme.spacing.sm + 4,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.primary + "15",
      alignItems: "center",
    },
    viewAllText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },

    /* QUICK ACTIONS */
    quickActionsRow: {
      flexDirection: "row",
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.xl,
    },
    quickActionCard: {
      flex: 1,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      alignItems: "center",
      ...cardShadow,
    },
    quickActionIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: theme.spacing.sm,
    },
    quickActionIconText: {
      fontSize: 20,
      fontWeight: "700",
    },
    quickActionLabel: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
      textAlign: "center",
    },

    /* DIVIDER */
    divider: {
      height: 1,
      backgroundColor: theme.colors.border,
      marginBottom: theme.spacing.lg,
    },

    /* SEARCH & FILTER */
    searchSection: {
      marginBottom: theme.spacing.xl,
    },
    filterRow: {
      flexDirection: "row",
      marginBottom: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    filterBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
    },
    filterBtnActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    filterText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    filterTextActive: { color: theme.colors.primaryButtonText },

    /* LIST CARD */
    listCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      ...cardShadow,
    },
    workerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: theme.spacing.md,
    },
    cardTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
    },
    refreshText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },

    /* FOLDER STYLES */
    foldersWrapper: {
      gap: theme.spacing.md,
    },
    folderContainer: {
      backgroundColor: theme.colors.background,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
    },
    folderHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: theme.spacing.md,
      backgroundColor: theme.colors.surface,
    },
    folderHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
    },
    folderIcon: {
      fontSize: 20,
    },
    folderTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
    },
    folderCountBadge: {
      backgroundColor: theme.colors.primary + "15",
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 12,
      marginLeft: theme.spacing.xs,
    },
    folderCountText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    folderToggleIcon: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
    },
    folderContent: {
      paddingHorizontal: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    emptyFolder: {
      paddingVertical: theme.spacing.lg,
      alignItems: "center",
    },
    emptyFolderText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
    },
    lastWorkerRow: {
      borderBottomWidth: 0,
    },

    /* WORKER ROW */
    workerRow: {
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    workerRowMain: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: theme.spacing.sm,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: theme.spacing.md,
    },
    avatarText: { color: theme.colors.primaryButtonText, fontWeight: "700", fontSize: 18 },
    workerInfo: { flex: 1 },
    workerNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 4,
    },
    workerName: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      flex: 1,
    },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    statusActive: { backgroundColor: theme.colors.success + "20" },
    statusInactive: { backgroundColor: theme.colors.danger + "20" },
    statusText: {
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    statusTextActive: { color: theme.colors.success },
    statusTextInactive: { color: theme.colors.danger },
    muted: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      marginBottom: 2,
    },
    mutedSmall: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
    },
    workerActions: {
      flexDirection: "row",
      gap: theme.spacing.sm,
      justifyContent: "flex-end",
    },
    actionBtn: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.primary + "15",
      minWidth: 70,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    actionText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    actionBtnDanger: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.danger + "15",
      minWidth: 70,
      minHeight: 44,
      justifyContent: "center",
      alignItems: "center",
    },
    actionTextDanger: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },

    /* MODALS */
    modalScreen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    modalKeyboard: {
      flex: 1,
    },
    modalContent: {
      padding: theme.spacing.lg,
      flexGrow: 1,
    },
    modalTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      marginBottom: 4,
    },
    modalDesc: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      marginBottom: theme.spacing.lg,
    },
    toggleContainer: { marginBottom: theme.spacing.md },
    label: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
      textTransform: "uppercase",
      marginBottom: 6,
    },
    toggleBtn: {
      paddingVertical: 12,
      borderRadius: theme.radius.md,
      alignItems: "center",
      borderWidth: 1,
    },
    toggleActive: {
      backgroundColor: theme.colors.success + "20",
      borderColor: theme.colors.success,
    },
    toggleInactive: {
      backgroundColor: theme.colors.danger + "20",
      borderColor: theme.colors.danger,
    },
    toggleText: { fontSize: theme.textSizes.sm, fontWeight: "700" },

    /* MESSAGES */
    success: {
      marginTop: theme.spacing.sm,
      color: theme.colors.success,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
      marginBottom: theme.spacing.md,
    },
    error: {
      marginTop: theme.spacing.sm,
      color: theme.colors.danger,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
      marginBottom: theme.spacing.md,
    },
  });