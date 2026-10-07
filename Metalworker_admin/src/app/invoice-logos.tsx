// src/app/invoice-logos.tsx
// The Logo Library: every reusable letterhead invoices can print, once.
//
// A logo is stored ONCE here and referenced by the bills that use it. Nothing in
// this screen touches a bill's stored PDF — assigning a logo writes a reference,
// and the PDF is re-rendered from that reference separately. That is what lets one
// logo serve hundreds of invoices with the image stored exactly once, and it is why
// adding a logo here is instant and safe.
//
// THE TWO THINGS THIS SCREEN IS CAREFUL ABOUT
// Deleting is irreversible from a customer's point of view — the letterhead
// disappears from the invoices that carried it. So a delete first asks how many
// bills would be affected, and refuses outright when the answer is "any". And
// renaming is a caption change, not a re-upload: it never re-reads the image.

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";

import { AppTheme } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useAdminGate } from "../hooks/useAdminGate";
import {
  addInvoiceLogo,
  deleteInvoiceLogo,
  fetchInvoiceLogos,
  fetchLogoUsage,
  LOGO_USAGE_SAMPLE_LIMIT,
  pickInvoiceLogo,
  renameInvoiceLogo,
  type LogoUsageSummary,
} from "../services/invoiceLogos";
import type { InvoiceLogo } from "../types/invoiceLogo";
import { notify } from "../utils/notify";
import { BillLogoAssignModal } from "../components/bills/BillLogoAssignModal";
import { LogoThumbnail } from "../components/bills/LogoThumbnail";
import { useLogoImageUrls } from "../components/bills/useLogoImageUrls";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Input } from "../components/ui/Input";

export default function InvoiceLogosScreen() {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const { checking: authChecking } = useAdminGate();

  const [logos, setLogos] = useState<InvoiceLogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [adding, setAdding] = useState(false);
  const [addingStatus, setAddingStatus] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<InvoiceLogo | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<InvoiceLogo | null>(null);
  const [usage, setUsage] = useState<LogoUsageSummary | null>(null);
  /** True when the usage question could not be answered at all. */
  const [usageFailed, setUsageFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [assignTarget, setAssignTarget] = useState<InvoiceLogo | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      setLogos(await fetchInvoiceLogos());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "The logo library could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  /* `useFocusEffect` fires on the first focus AND on every return, so this single
     call covers both the initial load and a logo added or deleted from a bill's
     editor — or on another device — without the admin pulling to refresh. A
     separate mount effect would be the same fetch twice. */
  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load])
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return logos;
    return logos.filter((logo) => logo.name.toLowerCase().includes(term));
  }, [logos, search]);

  const idsKey = useMemo(() => logos.map((l) => l.id).sort().join(","), [logos]);
  useLogoImageUrls(idsKey ? idsKey.split(",") : []);

  async function handleAdd() {
    setAdding(true);
    setAddingStatus(null);
    try {
      const picked = await pickInvoiceLogo();
      /* Cancelling the system picker is not an error and gets no message —
         returning silently is what makes cancelling feel like cancelling. */
      if (!picked) return;

      const created = await addInvoiceLogo(picked, picked.name, setAddingStatus);
      setLogos((prev) => [created, ...prev]);
      setSearch("");
      /* A logo that had to be resized is worth saying out loud: the admin chose a
         file at one size and the library now holds a different one. */
      const stored = `${created.pixel_width} x ${created.pixel_height}`;
      notify(
        `Added "${created.name}" to the logo library.`,
        created.pixel_width === picked.width && created.pixel_height === picked.height
          ? undefined
          : `Resized from ${picked.width} x ${picked.height} to ${stored} so it can be printed.`
      );
    } catch (err) {
      notify(
        "That logo could not be added.",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setAdding(false);
      setAddingStatus(null);
    }
  }

  async function submitRename() {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name) {
      notify("A logo needs a name.");
      return;
    }
    if (name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }

    setRenaming(true);
    try {
      const saved = await renameInvoiceLogo(renameTarget.id, name);
      /* Only the name and timestamp change, so the row is patched in place. A full
         refetch would re-mint every signed URL and make the whole list flicker for
         a one-word edit. */
      setLogos((prev) => prev.map((logo) => (logo.id === saved.id ? saved : logo)));
      setRenameTarget(null);
      notify("Renamed", `This logo is now called "${saved.name}".`);
    } catch (err) {
      notify(
        "That logo could not be renamed.",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setRenaming(false);
    }
  }

  /**
   * Ask what a delete would destroy BEFORE showing the confirmation.
   *
   * The count is measured rather than read off the list on screen, because the list
   * could be minutes old and a stale "not used" must not become a delete that
   * silently strips a letterhead off two hundred invoices. The delete itself
   * re-checks; this is so the dialog can be specific rather than generic.
   */
  async function openDelete(logo: InvoiceLogo) {
    setDeleteTarget(logo);
    setUsage(null);
    setUsageFailed(false);
    try {
      setUsage(await fetchLogoUsage(logo.id));
    } catch (err) {
      /* Recorded as FAILED rather than left as "not yet known", because the two
         need different words on screen: one means "still asking", the other means
         "the question could not be answered, so the only safe answer is no". The
         delete itself would still refuse, but the admin deserves to be told why
         rather than left watching a spinner that will never resolve. */
      setUsageFailed(true);
      notify(
        "The usage of this logo could not be checked.",
        err instanceof Error ? err.message : "Close this and try again."
      );
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteInvoiceLogo(deleteTarget.id);
      setLogos((prev) => prev.filter((logo) => logo.id !== deleteTarget.id));
      notify("Logo deleted", `"${deleteTarget.name}" has been removed from the library.`);
      closeDelete();
    } catch (err) {
      notify(
        "That logo could not be deleted.",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setDeleting(false);
    }
  }

  function closeDelete() {
    setDeleteTarget(null);
    setUsage(null);
    setUsageFailed(false);
  }

  const totalAssignments = useMemo(
    () => logos.reduce((sum, logo) => sum + logo.bill_count, 0),
    [logos]
  );

  const showEmpty = !loading && !loadError && logos.length === 0;
  const showNoMatches = !loading && !loadError && logos.length > 0 && visible.length === 0;

  if (authChecking) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Count caption (shell header carries the title) */}
      <View style={styles.countCaptionWrap}>
        <Text style={styles.headerSubtitle}>
          {logos.length === 0
            ? "Reusable letterheads for your invoices"
            : `${logos.length} ${logos.length === 1 ? "logo" : "logos"} · ${totalAssignments} ${
                totalAssignments === 1 ? "bill" : "bills"
              } carrying one`}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={theme.colors.textMuted} />
        }
      >
        <Button
          title={adding ? "Adding" : "Add a logo"}
          onPress={() => void handleAdd()}
          loading={adding}
        />

        {/* Resizing a large logo takes a moment and would otherwise look like a
            hung button. The exact size is in the message, because "it got smaller"
            without saying how much is not something an admin can verify. */}
        {addingStatus ? <Text style={styles.statusText}>{addingStatus}</Text> : null}

        {logos.length > 3 ? (
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Search logos…"
            accessibilityLabel="Search logos by name"
          />
        ) : null}

        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        {loading && logos.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.muted}>Loading the logo library…</Text>
          </View>
        ) : null}

        {showEmpty ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No invoice logos have been added yet.</Text>
            <Text style={styles.muted}>
              Add a logo once and it can be used on any number of invoices. It prints in the
              header, above the invoice number.
            </Text>
          </View>
        ) : null}

        {showNoMatches ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No logo matches that search</Text>
            <Text style={styles.muted}>Try a different name, or add a new logo.</Text>
          </View>
        ) : null}

        <View style={styles.grid}>
          {visible.map((logo) => (
            <View key={logo.id} style={styles.card}>
              <View style={styles.cardTop}>
                <LogoThumbnail logoId={logo.id} size={72} />
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName} numberOfLines={2}>
                    {logo.name}
                  </Text>
                  <Text style={styles.muted}>
                    Added {new Date(logo.created_at).toLocaleDateString()}
                  </Text>
                  {logo.pixel_width && logo.pixel_height ? (
                    <Text style={styles.mutedFaint}>
                      {logo.pixel_width} × {logo.pixel_height}
                    </Text>
                  ) : null}
                  {/* The usage count is the thing an admin actually needs from this
                      screen: which of these is already on invoices I have sent, and
                      which is safe to delete. */}
                  <Text
                    style={[styles.count, logo.bill_count > 0 ? styles.countUsed : styles.countUnused]}
                  >
                    {logo.bill_count === 0
                      ? "Not used on any bill yet"
                      : `Used on ${logo.bill_count} ${logo.bill_count === 1 ? "bill" : "bills"}`}
                  </Text>
                </View>
              </View>

              <View style={styles.cardActions}>
                <Pressable
                  onPress={() => setAssignTarget(logo)}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Assign ${logo.name} to bills`}
                >
                  <Text style={styles.linkButtonText}>Assign to Bills</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setRenameTarget(logo);
                    setRenameValue(logo.name);
                  }}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${logo.name}`}
                >
                  <Text style={styles.linkButtonText}>Rename</Text>
                </Pressable>
                <Pressable
                  onPress={() => void openDelete(logo)}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${logo.name}`}
                >
                  <Text style={[styles.linkButtonText, styles.linkButtonDanger]}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Rename ─────────────────────────────────────────────── */}
      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={renaming ? undefined : () => setRenameTarget(null)}
      >
        <View style={styles.centerBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>Rename logo</Text>
            <Text style={styles.muted}>{renameTarget?.name}</Text>
            <Input value={renameValue} onChangeText={setRenameValue} placeholder="Logo name" />
            <View style={styles.dialogActions}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setRenameTarget(null)}
                disabled={renaming}
                style={styles.flexButton}
              />
              <Button
                title="Save"
                onPress={() => void submitRename()}
                loading={renaming}
                disabled={!renameValue.trim()}
                style={styles.flexButton}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Delete ─────────────────────────────────────────────── */}
      {/* EVERYTHING here keys off `usage`, the measured count, and never off the
          number on the card. The card's count came from the library query and may
          be minutes old — and a stale zero must not offer a Delete on a logo that
          is on two hundred invoices. While `usage` is null nothing is offered at
          all, because "I do not know yet" is not "it is safe". */}
      <ConfirmDialog
        visible={deleteTarget !== null}
        title={usage && usage.bill_count > 0 ? "This logo is in use" : "Delete this logo?"}
        destructive
        busy={deleting}
        confirmLabel={usage && usage.bill_count === 0 ? "Delete logo" : "Cannot delete"}
        onCancel={closeDelete}
        onConfirm={() => {
          /* Refused rather than hidden: when the logo is in use, or when the count
             could not be established, this reports the reason instead of doing
             nothing silently. */
          if (usageFailed) {
            notify(
              "Not deleted",
              "Which invoices use this logo could not be checked, so it cannot safely be deleted from here."
            );
            return;
          }
          if (!usage || usage.bill_count > 0) return;
          void confirmDelete();
        }}
        message={
          usageFailed
            ? "Which invoices use this logo could not be checked, so it cannot safely be deleted from here. Close this and try again."
            : usage === null
              ? "Checking which invoices use this logo…"
              : usage.bill_count === 0
                ? `"${deleteTarget?.name}" is not on any bill, so deleting it removes only the image and the name.`
                : `"${deleteTarget?.name}" is assigned to ${usage.bill_count} ${
                    usage.bill_count === 1 ? "bill" : "bills"
                  }${
                    usage.sample_bills.length > 0
                      ? ` (${usage.sample_bills
                          .slice(0, LOGO_USAGE_SAMPLE_LIMIT)
                          .map((bill) => bill.label)
                          .join(", ")}${
                          usage.bill_count > usage.sample_bills.length
                            ? ` and ${usage.bill_count - usage.sample_bills.length} more`
                            : ""
                        })`
                      : ""
                  }. Remove it from those bills first, then it can be deleted.`
        }
      />

      <BillLogoAssignModal
        logo={assignTarget}
        onClose={() => setAssignTarget(null)}
        onApplied={(assigned) => {
          setAssignTarget(null);
          notify(
            `Logo assigned to ${assigned} ${assigned === 1 ? "bill" : "bills"}`,
            "All three print copies were re-printed."
          );
          void load(true);
        }}
      />
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    header: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.xs,
    },
    backBtn: { alignSelf: "flex-start", paddingVertical: 4 },
    backBtnText: { color: theme.colors.primary, fontSize: theme.textSizes.sm, fontWeight: "700" },
    headerInfo: { gap: 2 },
    headerTitle: { color: theme.colors.text, fontSize: theme.textSizes.xl, fontWeight: "800" },
    headerSubtitle: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm },
    countCaptionWrap: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.xs,
    },
    content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
    center: { paddingVertical: theme.spacing.xl, alignItems: "center", gap: theme.spacing.sm },
    centerBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing.lg,
    },
    dialogCard: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    dialogTitle: { color: theme.colors.text, fontSize: theme.textSizes.lg, fontWeight: "700" },
    dialogActions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    flexButton: { flex: 1 },

    statusText: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.sm,
    },
    grid: { gap: theme.spacing.md },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: theme.spacing.md,
    },
    cardTop: { flexDirection: "row", gap: theme.spacing.md },
    cardInfo: { flex: 1, minWidth: 0, gap: 2 },
    cardName: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "700" },
    count: { fontSize: theme.textSizes.sm, fontWeight: "700", marginTop: 2 },
    countUsed: { color: theme.colors.success },
    countUnused: { color: theme.colors.textMuted, fontWeight: "600" },
    cardActions: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: theme.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingTop: theme.spacing.sm,
    },
    linkButton: { paddingVertical: 4 },
    linkButtonText: {
      color: theme.colors.primary,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    linkButtonDanger: { color: theme.colors.danger },
    empty: {
      alignItems: "center",
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.md,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      textAlign: "center",
    },
    muted: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm, lineHeight: 19 },
    mutedFaint: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs },
    errorText: { color: theme.colors.danger, fontSize: theme.textSizes.sm },
    pressed: { opacity: 0.7 },
  });