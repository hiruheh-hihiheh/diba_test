import { useContext } from "react";
import { ConfirmContext } from "../contexts/ConfirmContext";

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
