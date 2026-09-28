// src/app/jobs-labour.tsx
// Thin route wrapper — the labour job list lives in the shared
// `<JobsScreen jobType="labour" />` component (server-side pagination +
// search + load-more + the keyed Edit/Drawing modals).
import { JobsScreen } from "../components/jobs/JobsScreen";

export default function JobsLabourScreen() {
  return <JobsScreen jobType="labour" />;
}