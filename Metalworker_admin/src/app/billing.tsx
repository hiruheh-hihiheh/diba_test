// src/app/billing.tsx — the Billing entry point.
//
// `/bills` and `/challan-bills` are unchanged; this route only chooses between them.
import React from "react";

import { BillingOverviewScreen } from "../components/bills/BillingOverviewScreen";

export default function BillingRoute() {
  return <BillingOverviewScreen />;
}
