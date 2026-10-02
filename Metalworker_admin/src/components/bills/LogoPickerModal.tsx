// src/components/bills/LogoPickerModal.tsx
//
// ONE picker, used from three places: the Logo Library, the bill editor, and the
// bills list. There is no second upload path inside a bill and no second way to
// choose a logo — the bill editor and the bills list both open this.
//
// WHY ONE COMPONENT
// Three copies of "pick a logo" would be three places that could disagree about
// which formats are accepted, which logos are safe to delete, and what the empty
// state says. More importantly it would make "the same logo library" a claim
// rather than a fact: an admin who assigned a logo from the library and then
// uploaded a different image from the bill editor would end up with two nearly
// identical logos and no way to tell which is on which invoice.
//
// WHAT IT OFFERS
//   - every logo in the library, with its name and how many bills use it
//   - a "no logo" choice, which is a real state and not an absence of one
//   - a search box, because a library that has grown past a handful is exactly
//     when a list is hard to use and a search box is worth its pixels
//   - adding a new logo from inside the picker, because "I need one that is not
//     here yet" is the most common reason someone opened it
//
// THE PREVIEW IS THE DELIVERABLE
// The dialog shows each logo fitted, never stretched, so the admin is choosing a
// letterhead rather than guessing from a filename.

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  addInvoiceLogo,
  fetchInvoiceLogos,
  pickInvoiceLogo,
} from "../../services/invoiceLogos";
import type { InvoiceLogo } from "../../types/invoiceLogo";
import { notify } from "../../utils/notify";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { LogoThumbnail } from "./LogoThumbnail";

export interface LogoPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Called with the chosen logo id, or `null` for "no logo".
   *
   * `null` is a first-class result rather than a cancel: removing a logo is a real
   * operation with real consequences for the printed invoice, and it has to be
   * reachable from the same place as choosing one.
   */
  onSelect: (logoId: string | null) => void;
  /** The bill's current logo, preselected. Null when there is no current logo. */
  currentLogoId?: string | null;
  /** The name of the currently assigned logo, shown so the selection is legible. */
  currentLogoName?: string | null;
  /** Titles the dialog for its caller, e.g. "Assign a logo to 24 bills". */
  title?: string;
  subtitle?: string;
  /**
   * Hides the "no logo" row.
   *
   * Only for a picker that must choose something. The bill editor and the library
   * both want removal available, and offering it in the same list as the choices is
   * why an admin never has to look for a separate "Remove" button that might not
   * be there.
   */
  allowNone?: boolean;
}

export function LogoPickerModal({
  visible,
  onClose,
  onSelect,
  currentLogoId = null,
  currentLogoName = null,
  title = "Choose a logo",
  subtitle,
  allowNone = true,
}: LogoPickerModalProps) {
  /* Each open is a FRESH instance of the body, not a reused one with its state
     reset. The counter advances only on the closed→open transition, so React
     unmounts the old body and mounts a new one — which resets the search box, the
     selection and the loaded list for free, with no effect doing it and no frame
     painted showing the previous logo's choice. It also means the fetch effect
     below starts from its own initial state (`loading: true`) rather than having to
     set it, so that effect only ever does asynchronous work. */
  const [openCount, setOpenCount] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setOpenCount((n) => n + 1);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <PickerBody
        key={openCount}
        onClose={onClose}
        onSelect={onSelect}
        currentLogoId={currentLogoId}
        currentLogoName={currentLogoName}
        title={title}
        subtitle={subtitle}
        allowNone={allowNone}
      />
    </Modal>
  );
}

/**
 * The dialog's contents.
 *
 * Split from the modal shell so that opening it remounts this entirely — see the
 * comment on `openCount` above.
 */
function PickerBody({
  onClose,
  onSelect,
  currentLogoId,
  currentLogoName,
  title,
  subtitle,
  allowNone,
}: Pick<
  LogoPickerModalProps,
  "onClose" | "onSelect" | "currentLogoId" | "currentLogoName" | "title" | "subtitle" | "allowNone"
>) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [logos, setLogos] = useState<InvoiceLogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(currentLogoId ?? null);
  const [adding, setAdding] = useState(false);

  /* Re-read the library each time the dialog opens rather than caching it across
     opens: an admin can add or delete a logo in another tab, and a picker that
     offered a logo which no longer exists would fail at the point of assignment
     instead of at the point of choosing. */
  useEffect(() => {
    let cancelled = false;

    fetchInvoiceLogos()
      .then((rows) => {
        if (cancelled) return;
        setLogos(rows);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : "The logo library could not be loaded."
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleLogos = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return logos;
    return logos.filter((logo) => logo.name.toLowerCase().includes(term));
  }, [logos, search]);

  const chosenLogo = useMemo(
    () => (chosen ? logos.find((logo) => logo.id === chosen) ?? null : null),
    [chosen, logos]
  );

  async function handleAdd() {
    setAdding(true);
    try {
      const picked = await pickInvoiceLogo();
      /* Cancelling the system picker is not an error and produces no message —
         returning silently is what makes cancelling feel like cancelling. */
      if (!picked) return;

      const created = await addInvoiceLogo(picked, picked.name);
      /* The new logo is selected and the dialog stays open, so an admin adding a
         logo can carry straight on to the next bill without reopening anything.
         The row is prepended rather than appended so it is visible immediately —
         the list is ordered newest-first, and a new logo that lands off-screen
         would look like the add had failed. */
      setLogos((prev) => [created, ...prev]);
      setChosen(created.id);
      setSearch("");
      notify(`Added "${created.name}" to the logo library.`);
    } catch (err) {
      notify(
        "That logo could not be added.",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setAdding(false);
    }
  }

  function confirm() {
    if (chosen === null && !allowNone) return;
    onSelect(chosen);
    onClose();
  }

  const nothingToShow = !loading && !loadError && visibleLogos.length === 0;

  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

        {logos.length > 3 ? (
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Search logos by name…"
            accessibilityLabel="Search logos by name"
          />
        ) : null}

        {loading ? (
          <View style={styles.center} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.mutedText}>Loading the logo library…</Text>
          </View>
        ) : loadError ? (
          <Text style={styles.errorText}>{loadError}</Text>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {allowNone ? (
              <LogoRow
                name="No logo"
                detail="This invoice prints exactly as it does today."
                logoId={null}
                selected={chosen === null}
                onSelect={() => setChosen(null)}
              />
            ) : null}

            {visibleLogos.map((logo) => (
              <LogoRow
                key={logo.id}
                name={logo.name}
                detail={
                  logo.bill_count === 0
                    ? "Not used on any bill yet"
                    : `Used on ${logo.bill_count} ${logo.bill_count === 1 ? "bill" : "bills"}`
                }
                logoId={logo.id}
                selected={chosen === logo.id}
                onSelect={() => setChosen(logo.id)}
              />
            ))}

            {nothingToShow ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  {search.trim()
                    ? "No logo matches that search"
                    : "No invoice logos have been added yet."}
                </Text>
                <Text style={styles.mutedText}>
                  {search.trim()
                    ? "Try a different name, or add a new logo."
                    : "Add a logo once and it can be used on any number of invoices. It prints in the header, above the invoice number."}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        )}

        {/* Says what the press will do, before the press. Choosing is invisible
            until it has happened, and on a letterhead the word matters. */}
        <Text style={styles.outcome} numberOfLines={1}>
          {chosenLogo
            ? `Will print: ${chosenLogo.name}`
            : currentLogoName && chosen === null
              ? `Currently: ${currentLogoName}`
              : ""}
        </Text>

        <View style={styles.actions}>
          <Button
            title={adding ? "Adding" : "Add a new logo"}
            onPress={() => void handleAdd()}
            loading={adding}
            variant="ghost"
            style={styles.addButton}
          />
          <Button
            title={chosen === null ? "Remove logo" : "Use this logo"}
            onPress={confirm}
            disabled={chosen === null && !allowNone}
            style={styles.confirmButton}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * One selectable row.
 *
 * The whole row is the control, not just a check mark, because the row carries the
 * preview and the count and a small target next to all of that is fiddly to hit.
 * `accessibilityState={{ checked }}` is on the row so a screen reader announces the
 * selection state along with the name, which is what makes this legible without the
 * visual.
 */
function LogoRow({
  name,
  detail,
  logoId,
  selected,
  onSelect,
}: {
  name: string;
  detail: string;
  logoId: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${name}. ${detail}`}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowSelected : styles.rowIdle,
        pressed && styles.pressed,
      ]}
    >
      {logoId ? (
        <LogoThumbnail logoId={logoId} size={48} />
      ) : (
        <View style={styles.rowThumbEmpty}>
          <Text style={styles.rowThumbGlyph}>—</Text>
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.mutedText} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {selected ? <Text style={styles.check}>✓</Text> : null}
    </Pressable>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      borderTopWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
      maxHeight: "88%",
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 20,
    },
    center: { paddingVertical: theme.spacing.xl, alignItems: "center", gap: theme.spacing.sm },
    list: { maxHeight: 380 },
    listContent: { gap: 6, paddingVertical: theme.spacing.xs },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
    },
    rowIdle: {
      borderColor: theme.colors.border,
      backgroundColor: "transparent",
    },
    rowSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primaryMuted,
    },
    rowText: { flex: 1, minWidth: 0 },
    rowName: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    rowThumbEmpty: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    rowThumbGlyph: { color: theme.colors.textMuted, fontSize: 18 },
    check: { color: theme.colors.primary, fontSize: 17, fontWeight: "800" },
    mutedText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 19,
    },
    errorText: { color: theme.colors.danger, fontSize: theme.textSizes.sm },
    empty: {
      alignItems: "center",
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.lg,
      paddingHorizontal: theme.spacing.md,
    },
    emptyTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
      textAlign: "center",
    },
    outcome: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
      minHeight: 19,
    },
    actions: {
      flexDirection: "row",
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.xs,
    },
    addButton: { flex: 1 },
    confirmButton: { flex: 1 },
    pressed: { opacity: 0.85 },
  });

export default LogoPickerModal;