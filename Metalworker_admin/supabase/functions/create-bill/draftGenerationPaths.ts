// supabase/functions/create-bill/draftGenerationPaths.ts
//
// ONE GENERATION ATTEMPT, ONE SET OF OBJECT NAMES.
//
// A bill can be generated more than once. The first attempt may fail, its thirty
// minute lease may expire while it is still rendering, or an admin may retry after a
// storage error. Each of those is a SEPARATE attempt, and two attempts must never
// write to the same object.
//
// The bill's own id is enough to keep copies of one bill together, but it says
// nothing about which attempt wrote them. The claim token does: it is issued once per
// attempt, a takeover always gets a new one, and it is the same token the finalize
// RPC checks. Putting it in the object name means
//
//   * a retry uploads to fresh paths instead of colliding with an object an earlier
//     attempt left behind (`upsert: false` would otherwise fail the upload), and
//   * the cleanup after a failed upload can remove exactly the objects that THIS
//     attempt uploaded, without touching a newer attempt's files - even if the name
//     token (invoice/challan number) is identical.
//
// The first `_`-delimited token of the second path segment is still the bill id,
// which is what `bills_pdf_paths_same_bill` requires of all three copies. The extra
// segments are appended after it, so the existing constraint keeps passing unchanged.
//
// Kept pure and dependency-free so the self-test can exercise the naming and the
// cleanup with no Deno runtime and no storage bucket.

export const MANUAL_PREFIX = "manual";

export type GenerationCopy = "original" | "duplicate" | "triplicate";

export interface GenerationPdfPaths {
  readonly base: string;
  readonly original: string;
  readonly duplicate: string;
  readonly triplicate: string;
}

/**
 * The claim token, reduced to characters that are safe in a storage key.
 *
 * A claim token is a UUID, so this only removes the dashes. Doing it explicitly
 * keeps a malformed token from introducing a `/` or `_` that would change how the
 * path is split. An empty result is refused rather than silently naming the objects
 * after the bill alone, which is the collision this module exists to prevent.
 */
export function generationAttemptId(claimToken: string): string {
  const attempt = claimToken.replace(/[^0-9a-zA-Z]/g, "");
  if (attempt === "") throw new Error("A generation attempt needs a claim token.");
  return attempt;
}

export function generationPdfPaths(
  billId: string,
  billToken: string,
  claimToken: string
): GenerationPdfPaths {
  if (billId === "") throw new Error("A generation attempt needs a bill.");
  const attempt = generationAttemptId(claimToken);
  const base = `${MANUAL_PREFIX}/${billId}_${billToken}_${attempt}_v1`;
  return {
    base,
    original: `${base}_original.pdf`,
    duplicate: `${base}_duplicate.pdf`,
    triplicate: `${base}_triplicate.pdf`,
  };
}
