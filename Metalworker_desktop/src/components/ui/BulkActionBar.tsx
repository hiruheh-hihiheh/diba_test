// src/components/ui/BulkActionBar.tsx
// Viewport-anchored bar for "N selected — do something".
//
// The previous version was `position: fixed` inside the page wrapper, which the
// page-level animation transform turned into a document-relative box. On a long
// list it rendered thousands of pixels below the visible area, so the bar that
// holds the bulk-remove button was effectively unreachable. It is portalled to
// <body> and offsets itself for the sidebar so it is always on screen.

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useSidebar } from "../../hooks/useSidebar";

interface BulkActionBarProps {
  /** Render nothing when zero. */
  count: number;
  /** e.g. "jobs" — used in the label. */
  itemLabel?: string;
  /** Extra context, e.g. the folder name. */
  context?: string;
  children?: ReactNode;
  onClear: () => void;
  /** Wording for the clear control. */
  clearLabel?: string;
}

export default function BulkActionBar({
  count,
  itemLabel = "records",
  context,
  children,
  onClear,
  clearLabel = "Clear selection",
}: BulkActionBarProps) {
  const { collapsed, isMobile } = useSidebar();

  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        onClear();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, onClear]);

  if (count === 0 || typeof document === "undefined") return null;

  const rightOffset = isMobile ? 16 : collapsed ? 96 : 296;

  return createPortal(
    <div
      className="fixed bottom-4 z-[90] flex justify-center px-4 pointer-events-none"
      style={{ left: 0, right: rightOffset }}
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex flex-wrap items-center gap-2 sm:gap-3 pl-4 pr-2 py-2.5 rounded-2xl bg-surface border border-border shadow-2xl animate-slide-up max-w-full"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-lg bg-primary text-[13px] font-extrabold text-white tabular-nums shrink-0">
            {count}
          </span>
          <span className="text-sm font-semibold text-text whitespace-nowrap">
            {itemLabel} selected
          </span>
          {context && (
            <span className="hidden sm:inline text-sm text-text-muted truncate max-w-[16rem]">
              in {context}
            </span>
          )}
        </div>

        {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}

        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body
  );
}
