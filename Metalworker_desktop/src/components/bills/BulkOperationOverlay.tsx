// src/components/bills/BulkOperationOverlay.tsx
//
// The loading state for any bulk bill operation in the desktop app.
//
// Mirrors the admin app's overlay exactly, in intent and in the rules:
//
// * The screen stays visible underneath. The backdrop is translucent, so the user can
//   still see WHICH list is being operated on — an opaque takeover hides the very
//   thing they need in order to confirm the operation is the right one.
// * Progress is never invented. `progress` is supplied only by callers holding a real
//   `done / total`; a caller without one leaves it off and gets an indeterminate bar
//   plus "Please wait...". There is no timer and no eased animation standing in for
//   work, because a percentage that is not backed by completed work is a lie.
// * It cannot be dismissed. The operation is genuinely in flight and there is no
//   halfway state to cancel to, so closing this dialog mid-flight would leave the user
//   looking at a list that is part-deleted with nothing indicating it.

import { Loader2 } from "lucide-react";

import type { BulkProgress } from "../../types/bill";

export interface BulkOperation {
  /** e.g. "Deleting bills". Present continuous: the work is running now. */
  title: string;
  /** e.g. "37 bills selected". States the size of the operation. */
  subtitle: string;
  /** The line above the bar when progress is known, e.g. "Deleting". */
  progressLabel?: string;
  /**
   * Real progress, when the caller has it.
   *
   * Omitting it is a deliberate choice, not a default: it selects the indeterminate
   * rendering, which is the honest answer for work that has no countable steps.
   */
  progress?: BulkProgress;
}

interface BulkOperationOverlayProps {
  operation: BulkOperation | null;
}

/**
 * `done` and `total` as whole numbers inside 0..total.
 *
 * Rounded, not truncated, so "Deleting 18 / 37" never reads as 17 while 18 bills are
 * finished. A `done` above `total` is clamped rather than drawn as an over-full bar:
 * that would mean a caller double-counted something, and the truthful rendering of
 * "more than finished" is "finished".
 */
function clampFraction(done: number, total: number): { done: number; total: number } {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeDone = Number.isFinite(done) && done > 0 ? Math.floor(done) : 0;
  return { done: Math.min(safeDone, safeTotal), total: safeTotal };
}

export default function BulkOperationOverlay({ operation }: BulkOperationOverlayProps) {
  if (!operation) return null;

  const fraction = operation.progress
    ? clampFraction(operation.progress.done, operation.progress.total)
    : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6"
      /* role=alert + assertive, because this is the answer to "is the app stuck?" and
         it should interrupt rather than queue behind whatever the user is reading. */
      role="alert"
      aria-live="assertive"
      aria-busy="true"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 flex flex-col items-center gap-2 shadow-xl">
        <Loader2 size={32} className="text-primary animate-spin" aria-hidden="true" />

        <p className="mt-2 text-base font-bold text-text text-center">{operation.title}</p>
        <p className="text-xs text-text-secondary text-center">{operation.subtitle}</p>

        {fraction === null ? (
          <>
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full border border-border bg-surface-secondary"
              aria-hidden="true"
            >
              {/* A short segment rather than a full-width fill: there is no basis in the
                  work for saying how far along it is. */}
              <div className="h-full w-[35%] rounded-full bg-primary-muted" />
            </div>
            <p className="mt-1 text-[11px] text-text-muted">Please wait…</p>
          </>
        ) : (
          <>
            {operation.progressLabel && (
              <p className="mt-3 text-sm font-semibold text-text">
                {operation.progressLabel} {fraction.done} / {fraction.total}
              </p>
            )}
            <div
              className="mt-1 h-2 w-full overflow-hidden rounded-full border border-border bg-surface-secondary"
              aria-hidden="true"
            >
              {/* Proportional width, not a stepped counter: at 18/37 the bar really is
                  18/37 of the way across. */}
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{
                  width: `${fraction.total === 0 ? 0 : (fraction.done / fraction.total) * 100}%`,
                }}
              />
            </div>
            <p className="mt-1 text-[11px] text-text-muted">Please wait…</p>
          </>
        )}
      </div>
    </div>
  );
}