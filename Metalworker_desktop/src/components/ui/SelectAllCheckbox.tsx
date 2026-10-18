// src/components/ui/SelectAllCheckbox.tsx
// A checkbox that can actually show the indeterminate state.
//
// A controlled React checkbox cannot set `.indeterminate`, and the previous
// implementation used a ref that was only written on mount, so after any
// re-render the header checkbox showed "unchecked" while rows were selected.
// This syncs the DOM property on every render and via a layout effect.

import { useEffect, useRef } from "react";
import type { Selection } from "../../hooks/useSelection";

interface Props {
  /** Ids currently visible (page + filter applied). */
  ids: string[];
  selection: Selection;
  label?: string;
  className?: string;
}

export default function SelectAllCheckbox({ ids, selection, label, className = "" }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const selectedVisible = ids.filter((id) => selection.selected.has(id)).length;
  const all = ids.length > 0 && selectedVisible === ids.length;
  const some = selectedVisible > 0 && selectedVisible < ids.length;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={all}
      onChange={() => selection.toggleVisible(ids)}
      disabled={ids.length === 0}
      aria-label={label ?? `Select all ${ids.length} rows on this page`}
      title={
        ids.length === 0
          ? "Nothing to select"
          : all
            ? `Clear selection (${ids.length})`
            : `Select all ${ids.length} on this page`
      }
      className={`w-4 h-4 rounded accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    />
  );
}
