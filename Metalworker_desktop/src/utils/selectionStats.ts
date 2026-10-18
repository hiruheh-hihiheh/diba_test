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
