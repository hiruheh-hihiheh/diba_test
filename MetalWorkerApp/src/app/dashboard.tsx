import { DashboardScreen } from "../components/dashboard/DashboardScreen";
import { SessionGate } from "../components/SessionGate";

/** Labour (worker) home. */
export default function Dashboard() {
  return (
    <SessionGate>
      <DashboardScreen expectRole="worker" />
    </SessionGate>
  );
}
