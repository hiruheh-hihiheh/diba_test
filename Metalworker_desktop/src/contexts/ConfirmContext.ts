import { createContext } from "react";
import type { ConfirmFn } from "../components/ui/ConfirmDialog";

export const ConfirmContext = createContext<ConfirmFn | null>(null);
