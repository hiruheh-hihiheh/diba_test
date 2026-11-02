// src/app/bills.tsx — the Tax Bills section.
//
// The workspace itself is `BillsScreen`, shared with Challan Bills
// (`challan-bills.tsx`); this route only fixes the document type.
import React from "react";

import { BillsScreen } from "../components/bills/BillsScreen";

export default function TaxBillsRoute() {
  return <BillsScreen documentType="tax_invoice" />;
}
