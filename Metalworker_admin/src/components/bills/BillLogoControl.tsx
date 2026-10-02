// src/components/bills/BillLogoControl.tsx
//
// A bill's logo, and the three things you can do about it.
//
// WHY THIS IS A COMPONENT AND NOT PART OF EITHER SCREEN
// The bill editor and the read-only detail view both have to show which logo a bill
// carries, and both have to offer Assign / Change / Remove. Written twice they would
// drift — and the detail view is the one place an admin checks before printing, so
// a drift there is a drift in what they believe about a tax document.
//
// WHY THE PICKER IS THE SAME ONE THE LIBRARY USES
// There is no upload control here. Choosing a logo from a bill opens the same
// library picker used from the Logo Library, so there is exactly one list of logos,
// one set of accepted formats, and one way to add a new one. A bill editor with its
// own uploader would let the same image exist twice under two names, and nothing
// would say which was on which invoice.
//
// IT SAYS WHETHER THE PDF ACTUALLY HAS IT
// Assigning a logo writes the bill immediately, and the PDFs are re-printed
// separately. So for a moment — or, if a re-print failed, indefinitely — the stored
// PDF and the row can disagree. That is shown rather than hidden, because the whole
// point of this control is to answer "what will print", and an optimistic "done" on
// a document that has not been re-printed would be the one dishonest answer.

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  applyLogoToBills,
  fetchBillLogoState,
  fetchLogosByIds,
} from "../../services/invoiceLogos";
import { billLogoIsStale, type BillLogoState } from "../../types/invoiceLogo";
import { notify } from "../../utils/notify";
import { LogoThumbnail } from "./LogoThumbnail";
import { LogoPickerModal } from "./LogoPickerModal";

interface BillLogoControlProps {
  billId: string;
  /**
   * The state, if the caller already has it.
   *
   * The Bills list already embeds the logo on every row, so re-fetching it here
   * would be a request for something already on screen. Omit it and this fetches
   * what it needs, which is the right default for a screen that opened straight
   * into one bill.
   */
  initialState?: BillLogoState | null;
  /** Called after any change, so the caller can refresh its own row. */
  onChanged?: () => void;
}

export function BillLogoControl({
  billId,
  initialState = null,
  onChanged,
}: BillLogoControlProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [state, setState] = useState<BillLogoState | null>(initialState);
  const [loading, setLoading] = useState(initialState === null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  /* A caller that already had the bill row has `logo_id` but not the logo's NAME,
     because names live in another table that the bills query does not join. That
     is enough to know whether there is a logo and not enough to say which, so the
     name is resolved here — one small request — rather than making every caller
     join a table it does not otherwise need. It runs only when the id is known and
     the name is not, so the bill editor's own path never makes it. */
  const stateLogoId = state?.logo_id ?? null;
  const stateLogoRef = state?.logo ?? null;
  useEffect(() => {
    if (!stateLogoId || stateLogoRef) return;
    let cancelled = false;
    fetchLogosByIds([stateLogoId])
      .then((next) => {
        const logo = next.get(stateLogoId);
        if (cancelled || !logo) return;
        setState((prev) => (prev ? { ...prev, logo } : prev));
      })
      .catch(() => {
        /* The name is a caption, not the fact. "Logo assigned" is still true, and
           the buttons still work; failing here would blank a working control. */
      });
    return () => {
      cancelled = true;
    };
  }, [stateLogoId, stateLogoRef]);

  async function load() {
    setLoading(true);
    try {
      setState(await fetchBillLogoState(billId));
    } catch (err) {
      notify(
        "The logo could not be read.",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function apply(logoId: string | null) {
    setBusy(true);
    try {
      /* No progress callback here: this is one bill, so there is no batch to report
         progress across, and a percentage over a single re-print would be theatre.
         The button's busy state is the honest signal — the work is in flight. */
      const result = await applyLogoToBills([billId], logoId);

      if (!result.ok) {
        notify("The logo could not be changed.", result.error ?? "Please try again.");
        await load();
        return;
      }

      if (result.failures.length > 0) {
        notify(
          "The logo was saved, but the PDF could not be re-printed.",
          "It will be re-printed on the next attempt."
        );
      } else if (logoId === null) {
        notify("Logo removed", "This invoice now prints without a logo.");
      } else if (result.unchanged === 1) {
        /* Assigned the logo it already had. The server correctly reported it as
           unchanged and did not re-print, so saying "assigned" would imply work
           that did not happen. */
        notify("This bill already has that logo.");
      } else {
        notify("Logo assigned", "All three print copies were re-printed.");
      }

      /* Re-read rather than patching the guess made during the operation: the
         server's own record of what is now in the PDF is the only thing worth
         showing, and this is one request on a screen the admin is looking at. */
      await load();
      onChanged?.();
    } catch (err) {
      notify(
        "The logo could not be changed.",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  if (initialState === null && loading) {
    return (
      <View style={styles.loadingRow} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
        <Text style={styles.muted}>Reading the logo…</Text>
      </View>
    );
  }

  const hasLogo = !!state?.logo_id;
  const stale = state ? billLogoIsStale(state) : false;
  const logoName = state?.logo?.name ?? null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headline}>
        {hasLogo && state?.logo_id ? (
          <LogoThumbnail logoId={state.logo_id} size={56} />
        ) : (
          <View style={styles.emptyThumb}>
            <Text style={styles.emptyGlyph}>—</Text>
          </View>
        )}

        <View style={styles.headlineText}>
          <Text style={styles.label}>INVOICE LOGO</Text>
          <Text style={styles.name} numberOfLines={1}>
            {hasLogo ? logoName ?? "Logo assigned" : "No Logo Assigned"}
          </Text>
          {!hasLogo ? (
            <Text style={styles.muted}>This invoice prints without a logo, exactly as it always has.</Text>
          ) : null}
          {hasLogo && stale ? (
            <Text style={styles.warning}>
              ⚠ The saved PDF is being re-printed with this logo.
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          style={({ pressed }) => [
            styles.button,
            styles.buttonGhost,
            (pressed || busy) && styles.pressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.text} />
          ) : null}
          <Text style={styles.buttonGhostText}>
            {busy ? "Working…" : hasLogo ? "Change Logo" : "Assign Logo"}
          </Text>
        </Pressable>

        {hasLogo ? (
          <Pressable
            onPress={() => void apply(null)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [
              styles.button,
              styles.buttonDanger,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.buttonDangerText}>Remove Logo</Text>
          </Pressable>
        ) : null}
      </View>

      <LogoPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(logoId) => {
          /* Choosing the logo a bill already has is a no-op, and the service would
             correctly report it as unchanged — but closing the dialog having changed
             nothing is a poor answer to a deliberate click. It is filtered here so
             the dialog does not even offer it as a way forward. */
          if (logoId !== state?.logo_id) void apply(logoId);
        }}
        currentLogoId={state?.logo_id ?? null}
        currentLogoName={logoName}
        title="Choose a logo for this invoice"
        subtitle="The logo prints in the header, above the invoice number."
      />
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: { gap: theme.spacing.md },
    loadingRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
    headline: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.md },
    headlineText: { flex: 1, minWidth: 0 },
    label: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 0.8,
    },
    name: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      marginTop: 2,
    },
    emptyThumb: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyGlyph: { color: theme.colors.textMuted, fontSize: 20 },
    muted: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.sm,
      lineHeight: 19,
      marginTop: 2,
    },
    warning: {
      color: theme.colors.warning,
      fontSize: theme.textSizes.sm,
      lineHeight: 19,
      marginTop: 2,
    },
    actions: { flexDirection: "row", gap: theme.spacing.sm },
    button: {
      minHeight: 44,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.md,
    },
    buttonGhost: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: "transparent",
    },
    buttonGhostText: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    buttonDanger: { backgroundColor: "transparent" },
    buttonDangerText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
    },
    pressed: { opacity: 0.7 },
  });

export default BillLogoControl;