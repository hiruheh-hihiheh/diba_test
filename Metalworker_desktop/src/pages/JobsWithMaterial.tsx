// src/pages/JobsWithMaterial.tsx
// With Material jobs view. Behaviour lives in the shared JobsPage so that a fix
// here cannot drift away from the Labour view.

import JobsPage from "./JobsPage";

export default function JobsWithMaterialPage() {
  return (
    <JobsPage jobType="with_material" typeLabel="With Material" pageLabel="With Material Jobs" countKey="withMaterialCount" />
  );
}
