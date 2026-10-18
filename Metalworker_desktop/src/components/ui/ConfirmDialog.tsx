// src/components/ui/ConfirmDialog.tsx
// App-styled replacement for window.confirm / window.alert.

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmContext } from "../../contexts/ConfirmContext";
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

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

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
        tone={state?.tone === "primary" ? "primary" : "danger"}
        footer={
          <>
            <button type="button" onClick={() => settle(false)} className="btn btn-ghost">
              {state?.cancelLabel ?? "Cancel"}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => settle(true)}
              className={`btn ${state?.tone === "primary" ? "btn-primary" : "btn-danger-solid"}`}
            >
              {state?.confirmLabel ?? "Confirm"}
            </button>
          </>
        }
      >
        <div className="flex gap-3.5">
          <div
            className={`w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center border ${
              state?.tone === "primary"
                ? "bg-primary-muted border-primary/25 text-primary"
                : "bg-danger-muted border-danger/25 text-danger"
            }`}
          >
            {state?.icon ?? (state?.tone === "primary" ? <HelpCircle size={18} /> : <AlertTriangle size={18} />)}
          </div>
          <div className="text-[13px] text-text-secondary leading-relaxed min-w-0">
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
