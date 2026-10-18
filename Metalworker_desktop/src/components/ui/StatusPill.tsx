// src/components/ui/StatusPill.tsx
//
// One status pill for every dispatch status in the app.
//
// The colours used to come from `getStatusColor()`, a data-layer helper
// returning raw Tailwind-palette hexes (#F59E0B, #10B981…). Those read well on
// the dark theme and fail contrast on the light one — an 11px amber label on a
// white card is about 2:1. The tones live in `statusTone.ts` and resolve to
// `--theme-*` tokens, which are tuned per theme so small text clears 4.5:1 in
// both. The status value itself, and every workflow decision that reads it, is
// untouched.

import { statusToneClass } from "./statusTone";

export default function StatusPill({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  return (
    <span className={`badge border capitalize ${statusToneClass(status)} ${className}`}>
      {status}
    </span>
  );
}
