// src/components/ui/ConfirmDialog.tsx
// App-styled replacement for window.confirm / window.alert.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, HelpCircle, Loader2 } from "lucide-react";
import Modal from "./Modal";

export interface ConfirmOptions {
  title: string;
  /** Plain-language description of exactly what will happen. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  icon?: ReactNode;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    // A second request supersedes the first; resolve the old one as cancelled.
    resolverRef.current?.(false);
    setState(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setState(null);
    resolverRef.current?.(result);
    resolverRef.current = null;
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={!!state}
        onClose={() => settle(false)}
        size="sm"
        title={state?.title}
        footer={
          <>
            <button
              type="button"
              onClick={() => settle(false)}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer"
            >
              {state?.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => settle(true)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all cursor-pointer shadow-lg ${
                state?.tone === "primary"
                  ? "bg-primary hover:bg-primary-hover shadow-primary/20"
                  : "bg-danger hover:brightness-110 shadow-danger/20"
              }`}
            >
              {state?.confirmLabel ?? "Confirm"}
            </button>
          </>
        }
      >
        <div className="flex gap-4">
          <div
            className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center ${
              state?.tone === "primary"
                ? "bg-primary/10 text-primary"
                : "bg-danger/10 text-danger"
            }`}
          >
            {state?.icon ?? (
              state?.tone === "primary" ? (
                <HelpCircle size={22} />
              ) : (
                <AlertTriangle size={22} />
              )
            )}
          </div>
          <div className="text-sm text-text-muted leading-relaxed pt-1 min-w-0">
            {state?.message}
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async `confirm()` that shows the in-app dialog.
 * Replaces `window.confirm`, which blocks the thread and ignores the theme.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}

/* ── Small inline "are you sure" busy button ─────────────────── */

export function ConfirmingButton({
  onConfirm,
  children,
  className = "",
  disabled,
}: {
  onConfirm: () => Promise<void> | void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
        }
      }}
      className={className}
    >
      {busy && <Loader2 size={14} className="animate-spin inline-block" />}
      {children}
    </button>
  );
}
