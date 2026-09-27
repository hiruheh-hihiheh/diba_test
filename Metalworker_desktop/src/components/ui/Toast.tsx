// src/components/ui/Toast.tsx
// Consistent, non-blocking success / error feedback. Replaces window.alert.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
}

type ToastFn = (options: ToastOptions | string) => void;

interface ToastContextValue {
  success: ToastFn;
  error: ToastFn;
  info: ToastFn;
  warning: ToastFn;
  toast: ToastFn;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneStyles: Record<ToastTone, { icon: ReactNode; ring: string; iconColor: string }> = {
  success: {
    icon: <CheckCircle2 size={20} />,
    ring: "border-success/40",
    iconColor: "text-success",
  },
  error: {
    icon: <AlertCircle size={20} />,
    ring: "border-danger/40",
    iconColor: "text-danger",
  },
  warning: {
    icon: <AlertTriangle size={20} />,
    ring: "border-warning/40",
    iconColor: "text-warning",
  },
  info: {
    icon: <Info size={20} />,
    ring: "border-primary/40",
    iconColor: "text-primary",
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (options: ToastOptions | string) => {
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
    },
    []
  );

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
      className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))] pointer-events-none"
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
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3.5 rounded-xl bg-surface border ${style.ring} shadow-2xl animate-slide-in-right`}
    >
      <span className={`shrink-0 mt-0.5 ${style.iconColor}`}>{style.icon}</span>
      <div className="flex-1 min-w-0">
        {item.title && <p className="text-sm font-bold text-text">{item.title}</p>}
        {item.description && (
          <p className={`text-[13px] text-text-muted ${item.title ? "mt-0.5" : ""} break-words`}>
            {item.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss notification"
        className="shrink-0 p-1 -m-1 rounded text-text-muted hover:text-text transition-colors cursor-pointer"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
