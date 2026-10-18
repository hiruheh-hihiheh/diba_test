import { createContext } from "react";
import type { ToastOptions } from "../components/ui/Toast";

export type ToastFn = (options: ToastOptions | string) => void;

export interface ToastContextValue {
  success: ToastFn;
  error: ToastFn;
  info: ToastFn;
  warning: ToastFn;
  toast: ToastFn;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
