// src/contexts/BillDocumentTypeContext.ts
//
// Which section a bill component is rendered in: Tax Bills or Challan Bills.
//
// The Bills screen provides it once; the upload panel, the bill detail and edit
// sheets and the billing-folder sheets read it, so each scopes its queries and
// labels to the right document type without the value being threaded through
// every prop list. Defaults to Tax Invoices, which is what those components showed
// before Challan Bills existed — so a component mounted elsewhere (a folder
// preview, say) behaves exactly as it always did.

import { createContext, useContext } from "react";

import type { BillDocumentType } from "../services/billDocumentTypes";

export const BillDocumentTypeContext = createContext<BillDocumentType>("tax_invoice");

export function useBillDocumentType(): BillDocumentType {
  return useContext(BillDocumentTypeContext);
}
