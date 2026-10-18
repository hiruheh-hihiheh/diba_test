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
        className="pointer-events-auto flex flex-wrap items-center gap-2 sm:gap-3 pl-2.5 pr-1.5 py-1.5 rounded-xl bg-surface border border-border shadow-[0_20px_48px_-20px_rgba(0,0,0,0.8),0_1px_2px_rgba(0,0,0,0.3)] animate-slide-up max-w-full"
      >
        <div className="flex items-center gap-2.5 min-w-0 pl-0.5">
          <span className="inline-flex items-center justify-center min-w-[1.625rem] h-[1.625rem] px-1.5 rounded-[6px] bg-primary text-[12px] font-bold text-[var(--theme-primary-text)] tabular-nums shrink-0">
            {count}
          </span>
          <span className="text-[12.5px] font-semibold text-text whitespace-nowrap">
            {itemLabel} selected
          </span>
          {context && (
            <span className="hidden sm:inline text-[12px] text-text-muted truncate max-w-[16rem]">
              in {context}
            </span>
          )}
        </div>

        {children && (
          <div className="flex items-center gap-1.5 flex-wrap border-l border-border pl-2.5">
            {children}
          </div>
        )}

        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          title={clearLabel}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
        >
          <X size={15} />
        </button>
      </div>
    </div>,
    document.body
  );
}
