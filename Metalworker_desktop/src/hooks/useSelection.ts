// src/hooks/useSelection.ts
// Bulk selection that survives searching, paging and refetching.
//
// Selection is a `Set<string>` of ids kept independent of what is currently
// rendered, so a search, a page change or a background refresh never silently
// drops it. Ids that no longer exist are dropped by `prune(availableIds)` after
// a delete, so the count can never claim "5 selected" when only 3 are addable.

import { useCallback, useMemo, useState } from "react";

export interface Selection {
  /** The selected ids. Treat as read-only. */
  readonly selected: ReadonlySet<string>;
  /** Total number of selected ids, across all pages and filters. */
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Add or remove many ids at once. */
  setMany: (ids: string[], shouldSelect: boolean) => void;
  /** Replace the selection wholesale. */
  replace: (ids: string[]) => void;
  clear: () => void;
  /** Union the given ids into the selection. */
  selectAll: (ids: string[]) => void;
  /** Flip each of the given ids. */
  invert: (ids: string[]) => void;
  /** Drop ids that are no longer present in `availableIds`. */
  prune: (availableIds: string[]) => void;
  /** Header-checkbox handler: selects all `ids`, or clears them if all are on. */
  toggleVisible: (ids: string[]) => void;
}

export function useSelection(): Selection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], shouldSelect: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (shouldSelect) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const replace = useCallback((ids: string[]) => setSelected(new Set(ids)), []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const selectAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const invert = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const prune = useCallback((availableIds: string[]) => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const available = new Set(availableIds);
      const next = new Set<string>();
      let changed = false;
      for (const id of prev) {
        if (available.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  const toggleVisible = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      let selectedVisible = 0;
      for (const id of ids) if (next.has(id)) selectedVisible++;
      const shouldSelect = !(ids.length > 0 && selectedVisible === ids.length);
      for (const id of ids) {
        if (shouldSelect) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  return useMemo<Selection>(
    () => ({
      selected,
      count: selected.size,
      isSelected,
      toggle,
      setMany,
      replace,
      clear,
      selectAll,
      invert,
      prune,
      toggleVisible,
    }),
    [selected, isSelected, toggle, setMany, replace, clear, selectAll, invert, prune, toggleVisible]
  );
}
