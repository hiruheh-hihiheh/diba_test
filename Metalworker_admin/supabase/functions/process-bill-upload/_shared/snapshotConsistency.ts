// Pure workbook snapshot consistency helpers for aggregate PDF regeneration.

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function snapshotsEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export interface SnapshotDecision {
  ok: boolean;
  chosen: unknown;
  reason?: "mixed_null_nonnull" | "mismatched" | "null_after_nonnull" | "non_null_after_null";
}

export function decideWorkbookSnapshot(chosen: unknown, chunkSnapshots: unknown[]): SnapshotDecision {
  const nonNull = chunkSnapshots.filter((s) => s !== null && s !== undefined);
  const hasNull = nonNull.length !== chunkSnapshots.length;

  if (chosen === undefined) {
    if (nonNull.length === 0) return { ok: true, chosen: null };
    if (hasNull) return { ok: false, chosen, reason: "mixed_null_nonnull" };
    if (!nonNull.every((s) => snapshotsEqual(s, nonNull[0]))) return { ok: false, chosen, reason: "mismatched" };
    return { ok: true, chosen: nonNull[0] };
  }

  if (chosen === null) {
    if (nonNull.length > 0) return { ok: false, chosen, reason: "non_null_after_null" };
    return { ok: true, chosen: null };
  }

  if (hasNull) return { ok: false, chosen, reason: "null_after_nonnull" };
  if (!nonNull.every((s) => snapshotsEqual(s, chosen))) return { ok: false, chosen, reason: "mismatched" };
  return { ok: true, chosen };
}
