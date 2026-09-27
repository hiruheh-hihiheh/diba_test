// src/components/ui/AdminModal.tsx

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface AdminModalProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  zIndex?: number;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Close when Escape is pressed. Default true. */
  closeOnEscape?: boolean;
  /** Prevent background scrolling while open. Default true. */
  lockScroll?: boolean;
  /** Accessible name for the dialog. */
  label?: string;
  /**
   * The element that should receive focus when the dialog opens.
   * Defaults to the first focusable element inside, then the panel itself.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Viewport-level modal overlay.
 *
 * Rendered through a portal on `document.body` so it is never affected by an
 * ancestor `transform` (page-level `animate-fade-in` sets one, which would
 * otherwise turn the whole page into the containing block for `position: fixed`
 * and push the dialog thousands of pixels above the current scroll position).
 */
export default function AdminModal({
  open,
  onClose,
  children,
  zIndex = 100,
  closeOnBackdrop = true,
  closeOnEscape = true,
  lockScroll = true,
  label,
  initialFocusRef,
}: AdminModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /* ── Focus restoration ─────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const raf = requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
        panelRef.current;
      target?.focus?.();
    });

    return () => {
      cancelAnimationFrame(raf);
      const el = restoreFocusRef.current;
      // Only restore if the element is still in the document.
      if (el && document.body.contains(el)) el.focus?.();
    };
  }, [open, initialFocusRef]);

  /* ── Background scroll lock (with scrollbar-width compensation) ── */
  useEffect(() => {
    if (!open || !lockScroll) return;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, [open, lockScroll]);

  /* ── Escape to close ───────────────────────────────── */
  useEffect(() => {
    if (!open || !closeOnEscape || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    []
  );

  if (!open) return null;

  const content = (
    <div
      className="fixed inset-0 overflow-y-auto overscroll-contain"
      style={{ zIndex }}
      onKeyDown={handleKeyDown}
    >
      {/* min-h-full + items-center centres short dialogs and lets tall ones scroll
          from the top instead of being clipped. */}
      <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-overlay-in"
          onClick={closeOnBackdrop ? onClose : undefined}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className="relative z-10 w-full outline-none flex items-center justify-center"
        >
          {children}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
