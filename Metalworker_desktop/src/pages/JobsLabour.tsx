// src/pages/JobsLabour.tsx
// Labour jobs view. Behaviour lives in the shared JobsPage so that a fix here
// cannot drift away from the With Material view.

import JobsPage from "./JobsPage";

export default function JobsLabourPage() {
  return <JobsPage jobType="labour" typeLabel="Labour" pageLabel="Labour Jobs" countKey="labourCount" />;
}
