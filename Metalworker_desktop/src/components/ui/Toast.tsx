// src/components/ui/Toast.tsx
// Consistent, non-blocking success / error feedback. Replaces window.alert.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastContext, type ToastContextValue } from "../../contexts/ToastContext";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, X, AlertCircle } from "lucide-react";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  title?: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds; `0` keeps it until dismissed. Default 4500. */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, "description" | "title">> {
  id: number;
  title?: string;
  description?: string;
  /** Set while the toast is animating out, just before it is removed. */
  leaving?: boolean;
}

const toneStyles: Record<
  ToastTone,
  { icon: ReactNode; accent: string; iconColor: string }
> = {
  success: {
    icon: <CheckCircle2 size={17} />,
    accent: "bg-success",
    iconColor: "text-success",
  },
  error: {
    icon: <AlertCircle size={17} />,
    accent: "bg-danger",
    iconColor: "text-danger",
  },
  warning: {
    icon: <AlertTriangle size={17} />,
    accent: "bg-warning",
    iconColor: "text-warning",
  },
  info: {
    icon: <Info size={17} />,
    accent: "bg-primary",
    iconColor: "text-primary",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    // Two-phase: flag the toast so it can play its exit animation, then remove
    // it once that has run. Without this a dismissed toast simply vanished,
    // which read as a glitch next to the animated entrance.
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 160);
  }, []);

  const push = useCallback((options: ToastOptions | string) => {
    const opts: ToastOptions = typeof options === "string" ? { description: options } : options;
    const id = nextId.current++;
    const item: ToastItem = {
      id,
      tone: opts.tone ?? "success",
      duration: opts.duration ?? 4500,
      title: opts.title,
      description: opts.description,
    };
    // Cap the stack so a burst of errors cannot cover the screen.
    setToasts((prev) => [...prev.slice(-3), item]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: (o) => push({ ...(typeof o === "string" ? { description: o } : o), tone: "success" }),
      error: (o) => push({ ...(typeof o === "string" ? { description: o } : o), tone: "error" }),
      info: (o) => push({ ...(typeof o === "string" ? { description: o } : o), tone: "info" }),
      warning: (o) => push({ ...(typeof o === "string" ? { description: o } : o), tone: "warning" }),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  dismiss,
}: {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
}) {
  if (typeof document === "undefined" || toasts.length === 0) return null;

  return createPortal(
    <div
      className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-[min(23rem,calc(100vw-2rem))] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} dismiss={dismiss} />
      ))}
    </div>,
    document.body
  );
}

function ToastCard({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  useEffect(() => {
    if (!item.duration) return;
    const timer = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, dismiss]);

  const style = toneStyles[item.tone];

  return (
    <div
      className={`pointer-events-auto relative overflow-hidden flex items-start gap-2.5 pl-4 pr-2.5 py-3 rounded-xl bg-surface border border-border
        shadow-[0_20px_44px_-20px_rgba(0,0,0,0.75),0_1px_2px_rgba(0,0,0,0.3)] ${
          item.leaving ? "animate-slide-out-right pointer-events-none" : "animate-slide-in-right"
        }`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${style.accent}`} />
      <span className={`shrink-0 mt-px ${style.iconColor}`}>{style.icon}</span>
      <div className="flex-1 min-w-0">
        {item.title && (
          <p className="text-[13px] font-semibold text-text leading-snug">{item.title}</p>
        )}
        {item.description && (
          <p
            className={`text-[12.5px] text-text-muted leading-relaxed break-words ${
              item.title ? "mt-0.5" : ""
            }`}
          >
            {item.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        disabled={item.leaving}
        aria-label="Dismiss notification"
        className="shrink-0 p-1 -m-0.5 rounded text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:cursor-default"
      >
        <X size={14} />
      </button>
    </div>
  );
}
