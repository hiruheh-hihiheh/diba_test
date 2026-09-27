// src/components/ui/LoadingState.tsx
// Distinguishes "first load" from "refreshing", so a background refresh never
// replaces a populated table with a spinner (which used to throw away the
// user's scroll position and selection on every mutation).

import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

export function FullPageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-4" role="status" aria-live="polite">
      <Loader2 size={36} className="text-primary animate-spin" />
      <p className="text-sm font-medium text-text-muted">{label}</p>
    </div>
  );
}

export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="p-4 space-y-2" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: columns }).map((__, c) => (
            <div
              key={c}
              className="h-4 rounded bg-surface-hover animate-pulse"
              style={{ width: c === 0 ? "22%" : c === columns - 1 ? "12%" : `${Math.round(80 / columns)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Thin bar shown above content that is being refreshed in place. */
export function InlineRefreshBar({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="h-0.5 w-full overflow-hidden bg-primary/20"
      role="status"
      aria-label="Refreshing data"
    >
      <div className="h-full w-1/3 bg-primary animate-progress" />
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = "Something went wrong",
  secondaryAction,
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
  /** Extra action shown next to the retry button, e.g. "Go back". */
  secondaryAction?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-14 px-6"
      role="alert"
    >
      <div className="w-14 h-14 rounded-full bg-danger-muted flex items-center justify-center mb-4">
        <AlertTriangle size={26} className="text-danger" />
      </div>
      <h3 className="text-base font-bold text-text">{title}</h3>
      <p className="text-sm text-text-muted mt-1.5 max-w-md leading-relaxed">{message}</p>
      {(onRetry || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-bold transition-colors cursor-pointer"
            >
              <RefreshCw size={15} />
              Try again
            </button>
          )}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export function InlineSpinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-text-muted">
      <Loader2 size={15} className="animate-spin" />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}
