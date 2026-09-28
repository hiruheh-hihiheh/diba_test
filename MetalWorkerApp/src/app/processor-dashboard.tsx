import { DashboardScreen } from "../components/dashboard/DashboardScreen";
import { SessionGate } from "../components/SessionGate";

/**
 * Processor home.
 *
 * This used to be a byte-for-byte fork of `dashboard.tsx` that had already
 * drifted: it labelled a processor as "Worker" and showed a dispatch list that
 * is always empty for this role. It now renders the same component the labour
 * route does, with the role pinned.
 */
export default function ProcessorDashboard() {
  return (
    <SessionGate>
      <DashboardScreen expectRole="processor" />
    </SessionGate>
  );
}
