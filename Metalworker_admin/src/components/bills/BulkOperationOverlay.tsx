// src/components/bills/BulkOperationOverlay.tsx
//
// The loading state for any bulk bill operation.
//
// WHY THIS EXISTS
// Deleting bills, filing them in a billing folder and emptying a folder all take
// real time — they are a loop of round trips, not one instant write. Before this,
// the only signal during a bulk delete was the small spinner in the row that
// happened to be current, so the screen looked frozen and the natural reading was
// "the app has hung". This puts a full, unmistakable state on top of the screen.
//
// THE SCREEN STAYS VISIBLE UNDERNEATH
// The backdrop is translucent and the content behind it is not replaced, so the user
// can still see WHICH list is being operated on. An opaque full-screen takeover would
// hide the very thing the user needs to confirm the operation is the right one.
//
// PROGRESS IS NEVER INVENTED
// `progress` is passed in only by callers that know a real `done / total` (the bulk
// delete loop and the chunked folder add). A caller that does not know leaves it off,
// and this renders an indeterminate bar plus "Please wait..." instead. There is no
// timer, no eased animation standing in for work, and no percentage that could be a
// guess.

import React from "react";
import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { BulkProgress } from "../../types/bill";

export interface BulkOperation {
  /** e.g. "Deleting bills". A present-continuous headline: the work is running. */
  title: string;
  /** e.g. "37 bills selected". States the size of the operation. */
  subtitle: string;
  /** The line above the bar when progress is known, e.g. "Deleting". */
  progressLabel?: string;
  /**
   * Real progress, when the caller has it.
   *
   * Omit it for an indeterminate operation. The distinction is the whole point of
   * this component, so it is a required decision rather than a default of 0.
   */
  progress?: BulkProgress;
}

interface BulkOperationOverlayProps {
  operation: BulkOperation | null;
}

export function BulkOperationOverlay({ operation }: BulkOperationOverlayProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  if (!operation) return null;

  /* Clamped, and never NaN: `done` over `total` is the caller's number, but a total
     of 0 would otherwise produce Infinity and a bar wider than the screen. */
  const fraction = operation.progress
    ? clampFraction(operation.progress.done, operation.progress.total)
    : null;

  return (
    <Modal
      visible
      transparent
      /* Blocks every touch behind the card, which is what stops a second delete from
         being fired while the first is still running. */
      animationType="fade"
      onRequestClose={() => {
        /* Deliberately inert. Android's back button must not dismiss this: the
           operation is genuinely in flight and cannot be called off, so letting the
           overlay close would show a bill list that is mid-delete with no sign of
           the deletion. The screen stays put until the work finishes. */
      }}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View
          style={styles.card}
          accessibilityRole="alert"
          /* Assertive, not polite: this is the answer to "is the app stuck?", and it
             should interrupt rather than queue behind whatever the user is reading. */
          accessibilityLiveRegion="assertive"
          accessibilityLabel={[
            operation.title,
            operation.subtitle,
            operation.progress && operation.progressLabel
              ? `${operation.progressLabel} ${operation.progress.done} of ${operation.progress.total}`
              : null,
          ]
            .filter(Boolean)
            .join(". ")}
        >
          <ActivityIndicator size="large" color={theme.colors.primary} />

          <Text style={styles.title} numberOfLines={2}>
            {operation.title}
          </Text>
          <Text style={styles.subtitle}>{operation.subtitle}</Text>

          {fraction === null ? (
            <>
              <View style={styles.track} accessibilityElementsHidden>
                <View style={[styles.indeterminateFill, { backgroundColor: theme.colors.primaryMuted }]} />
              </View>
              <Text style={styles.wait}>Please wait…</Text>
            </>
          ) : (
            <>
              {operation.progressLabel && (
                <Text style={styles.progressLabel}>
                  {operation.progressLabel} {fraction.done} / {fraction.total}
                </Text>
              )}
              <View
                style={styles.track}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: theme.colors.primary,
                      /* Proportional width, not a stepped counter. At 18/37 the bar is
                         18/37 of the way across, which is a fact rather than a
                         decoration. */
                      width: `${fraction.total === 0 ? 0 : (fraction.done / fraction.total) * 100}%`,
                    },
                  ]}
                />
              </View>
              <Text style={styles.wait}>Please wait…</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * `done` and `total` as whole numbers inside 0..total.
 *
 * Rounded rather than truncated so "Deleting 18 / 37" never appears as 17 while 18
 * bills are done. A `done` past `total` is clamped rather than shown as an
 * over-full bar: it would mean a caller counted something twice, and the honest
 * rendering of that is "finished", not "more than finished".
 */
function clampFraction(done: number, total: number): { done: number; total: number } {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeDone = Number.isFinite(done) && done > 0 ? Math.floor(done) : 0;
  return { done: Math.min(safeDone, safeTotal), total: safeTotal };
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "#00000099",
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
      alignItems: "center",
      gap: theme.spacing.sm,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      textAlign: "center",
      marginTop: theme.spacing.sm,
    },
    subtitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.sm,
      textAlign: "center",
    },
    progressLabel: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "600",
      marginTop: theme.spacing.sm,
    },
    track: {
      width: "100%",
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.colors.border,
      overflow: "hidden",
      marginTop: theme.spacing.sm,
    },
    fill: {
      height: "100%",
      borderRadius: 4,
    },
    indeterminateFill: {
      height: "100%",
      width: "35%",
      borderRadius: 4,
    },
    wait: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: theme.spacing.xs,
    },
  });
}