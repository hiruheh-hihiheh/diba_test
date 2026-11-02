// src/app/challan-bills.tsx — the Challan Bills section.
//
// The same workspace as Tax Bills (`BillsScreen`), confined to Delivery Challans:
// its uploads, list, folders, edits, deletes and regeneration never touch a Tax
// Invoice.
import React from "react";

import { BillsScreen } from "../components/bills/BillsScreen";

export default function ChallanBillsRoute() {
  return <BillsScreen documentType="delivery_challan" />;
}
