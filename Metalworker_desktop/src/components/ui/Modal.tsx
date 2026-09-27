// src/components/ui/Modal.tsx
// Single modal shell used by every screen. Replaces the six near-identical local
// `Modal` wrappers that previously lived inside individual pages.

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import AdminModal from "./AdminModal";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

const sizeMap: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-6xl",
};

export function ModalCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close dialog"
      title="Close (Esc)"
      className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
    >
      <X size={18} />
    </button>
  );
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** Accent colour of the title area / icon chip. */
  tone?: "primary" | "danger";
  /** Hides the internal scroll container (caller supplies its own). */
  bare?: boolean;
  /** Removes the close button. For blocking progress dialogs that must not
      be dismissed mid-operation. */
  hideClose?: boolean;
  className?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  tone = "primary",
  bare = false,
  hideClose = false,
  className = "",
  initialFocusRef,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <AdminModal open={open} onClose={onClose} label={typeof title === "string" ? title : undefined} initialFocusRef={initialFocusRef}>
      <div
        ref={panelRef}
        className={`
          relative w-full ${sizeMap[size]}
          bg-surface border border-border rounded-2xl shadow-2xl
          /* max-h-dialog caps the panel at the viewport so the body's
             overflow-y-auto below actually engages, which keeps the title, the
             close button and the footer on screen at every window height. */
          max-h-dialog
          flex flex-col overflow-hidden animate-scale-in
          ${className}
        `}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border shrink-0">
            <div className="min-w-0">
              <h2
                className={`text-lg font-bold truncate ${
                  tone === "danger" ? "text-danger" : "text-text"
                }`}
              >
                {title}
              </h2>
              {subtitle && <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>}
            </div>
            {(!title || hideClose) && (
              <div className="w-9 shrink-0" aria-hidden="true" />
            )}
            {!hideClose && <ModalCloseButton onClick={onClose} />}
          </div>
        )}

        {bare ? (
          <div className="flex-1 min-h-0">{children}</div>
        ) : (
          <div className="px-6 py-5 flex-1 min-h-0 overflow-y-auto">{children}</div>
        )}

        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border shrink-0 bg-surface">
            {footer}
          </div>
        )}
      </div>
    </AdminModal>
  );
}

/* ── Standard footer buttons ─────────────────────────────────── */

export function ModalCancel({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Cancel
    </button>
  );
}
