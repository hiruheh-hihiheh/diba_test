// src/app/jobs-with-material.tsx
// Thin route wrapper — the with-material job list lives in the shared
// `<JobsScreen jobType="with_material" />` component (server-side pagination +
// search + load-more + the keyed Edit/Drawing modals).
import { JobsScreen } from "../components/jobs/JobsScreen";

export default function JobsWithMaterialScreen() {
  return <JobsScreen jobType="with_material" />;
}