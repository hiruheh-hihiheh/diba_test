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

export function selectionStats(ids: string[], selected: ReadonlySet<string>) {
  let selectedVisible = 0;
  for (const id of ids) if (selected.has(id)) selectedVisible++;
  return {
    selectedVisible,
    total: ids.length,
    all: ids.length > 0 && selectedVisible === ids.length,
    some: selectedVisible > 0 && selectedVisible < ids.length,
  };
}

export default function SelectAllCheckbox({ ids, selection, label, className = "" }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const stats = selectionStats(ids, selection.selected);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = stats.some;
  }, [stats.some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={stats.all}
      onChange={() => selection.toggleVisible(ids)}
      disabled={ids.length === 0}
      aria-label={label ?? `Select all ${ids.length} rows on this page`}
      title={
        ids.length === 0
          ? "Nothing to select"
          : stats.all
            ? `Clear selection (${stats.total})`
            : `Select all ${stats.total} on this page`
      }
      className={`w-4 h-4 rounded accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    />
  );
}
