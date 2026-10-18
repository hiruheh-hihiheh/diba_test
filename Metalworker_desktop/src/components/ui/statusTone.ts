// src/components/ui/statusTone.ts
//
// The colour half of a dispatch status label, kept out of the component file so
// `StatusPill.tsx` exports only a component (React Fast Refresh requires that).

const toneCls: Record<string, string> = {
  submitted: "bg-warning-muted text-warning border-warning/25",
  reviewed: "bg-info-muted text-info border-info/25",
  approved: "bg-success-muted text-success border-success/25",
  rejected: "bg-danger-muted text-danger border-danger/25",
};

/** Tone classes for a status label that carries extra content (e.g. a tally). */
export function statusToneClass(status: string): string {
  return toneCls[status] ?? "bg-surface-hover text-text-muted border-border";
}

/** The dot used beside a filter chip or in the pipeline bar. */
export function statusDotClass(status: string): string {
  switch (status) {
    case "submitted":
      return "bg-warning";
    case "reviewed":
      return "bg-info";
    case "approved":
      return "bg-success";
    case "rejected":
      return "bg-danger";
    default:
      return "bg-text-muted";
  }
}
