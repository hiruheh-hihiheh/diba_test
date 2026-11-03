// src/services/draftLifecycle.ts
//
// WHAT A DRAFT IS, WHEN IT IS STILL A DRAFT, and how one creation session is told
// apart from the next.
//
// Two bugs motivate this module, and both are the kind that only show up after the
// user has done real work:
//
//   1. A draft key that outlives the session it belongs to. The old key was stored
//      under `bill-creator:<type>:<mode>:<source>`, so "Create Bill" chosen once,
//      generated, and chosen again reused the FIRST form's idempotency token. The
//      server, correctly, treats a repeated token as the same intent — so the new
//      bill resolved to the old, already-finalized row.
//
//   2. A bill with no PDFs being called "legacy". A saved draft also has no PDFs.
//      `isLegacyBill` could not tell them apart because it was only ever asked
//      about imported rows, which were all finalized.
//
// This module is pure and imports nothing, so both apps and the Node self-test can
// run the same code. The two copies are byte-identical.
//
// IDENTITY IS (document type, session id), NEVER (mode, source bill)
//
// Selecting "empty" twice is two intents; selecting it twice in one tab with a
// refresh in between is one. Nothing in the mode or the source can tell those
// apart — only a value minted when the creation screen is first opened can. That
// value travels in the URL (`session=<uuid>`), which is what makes a refresh
// resume the same intent while a fresh navigation starts a new one.

/* ──────────────────────────────────────────────
   Status
   ────────────────────────────────────────────── */

/** `bills.status` (migration 0015). NOT `bill_uploads.status`, which is a pipeline stage. */
export type BillStatus = "draft" | "finalized";

/**
 * Read a stored status defensively.
 *
 * Rows written before 0015 have the column at its default, `finalized`, so a missing
 * value means generated — never draft. Guessing "draft" would put every imported bill
 * behind a Continue-editing button that would then refuse to open its PDFs.
 */
export function normalizeBillStatus(value: unknown): BillStatus {
  return value === "draft" ? "draft" : "finalized";
}

export function isDraftBill(status: unknown): boolean {
  return normalizeBillStatus(status) === "draft";
}

/** The badge text. Shared so a row and its detail sheet cannot word it differently. */
export function statusBadgeLabel(status: unknown): "Draft — Not Generated" | "Generated" {
  return isDraftBill(status) ? "Draft — Not Generated" : "Generated";
}

/* ──────────────────────────────────────────────
   The list filter
   ────────────────────────────────────────────── */

export type StatusFilter = "all" | "generated" | "drafts";

export const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "generated", label: "Generated" },
  { value: "drafts", label: "Drafts" },
] as const;

/** The status a filter restricts the query to, or null for "all". */
export function statusFilterToStatus(filter: StatusFilter): BillStatus | null {
  if (filter === "drafts") return "draft";
  if (filter === "generated") return "finalized";
  return null;
}

/** In-memory companion to the query filter, for rows already on screen. */
export function billMatchesStatusFilter(filter: StatusFilter, status: unknown): boolean {
  const wanted = statusFilterToStatus(filter);
  return wanted === null || normalizeBillStatus(status) === wanted;
}

/** "3 drafts" / "1 draft", for the filter's own count line. */
export function draftCountLabel(count: number): string {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${safe} ${safe === 1 ? "draft" : "drafts"}`;
}

/* ──────────────────────────────────────────────
   Session identity
   ────────────────────────────────────────────── */

/** The minimal storage shape needed, so this runs under Node, a browser, and a phone. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The query-string key that carries the creation session, in both apps. */
export const DRAFT_SESSION_PARAM = "session";

export function newDraftKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  /* Only reached where `crypto.randomUUID` is missing. Randomness is a bonus here:
     the key's job is uniqueness, and a timestamp plus a large random suffix is enough
     for that on a device that generates one every few minutes. */
  return `k-${Date.now()}-${Math.floor(Math.random() * 1e12)}`;
}

/**
 * Where one session's key lives.
 *
 * The document type is part of the key, because a challan form and an invoice form
 * must never share a token: the server would read the second document as a retry of
 * the first and refuse it for the wrong document type. The session id — not the mode
 * or the source — is what makes two separate "Create Bill" clicks two intents.
 */
export function draftSessionStorageKey(
  documentType: string,
  sessionId: string
): string {
  return `bill-creator:${documentType}:${sessionId}`;
}

/**
 * This session's idempotency key, created on first use and reused on every save.
 *
 * A completed session never hands back its key: `completeDraftSession` removes it and
 * records completion, so a form that somehow re-renders the same session after
 * finalizing gets a fresh token rather than resolving to the finalized bill.
 */
export function draftKeyForSession(
  sessionId: string,
  documentType: string,
  storage: DraftStorage | null | undefined
): string {
  if (!storage) return newDraftKey();
  try {
    const storageKey = draftSessionStorageKey(documentType, sessionId);
    if (isDraftSessionComplete(sessionId, documentType, storage)) {
      const fresh = newDraftKey();
      storage.setItem(storageKey, fresh);
      storage.removeItem(completedKey(documentType, sessionId));
      return fresh;
    }
    const existing = storage.getItem(storageKey);
    if (existing) return existing;
    const fresh = newDraftKey();
    storage.setItem(storageKey, fresh);
    return fresh;
  } catch {
    /* Private mode, a locked-down webview, no storage. The server still needs a key
       for the CREATE; it just cannot be recovered across a reload, which is a smaller
       loss than failing to save at all. */
    return newDraftKey();
  }
}

/**
 * Retire a session after the server has confirmed the document was generated.
 *
 * Called only on success: a failed finalize must leave the key in place, so the
 * admin's retry still resolves to the same draft instead of creating a second one.
 */
export function completeDraftSession(
  sessionId: string,
  documentType: string,
  storage: DraftStorage | null | undefined
): void {
  if (!storage) return;
  try {
    storage.removeItem(draftSessionStorageKey(documentType, sessionId));
    storage.setItem(completedKey(documentType, sessionId), "1");
  } catch {
    /* Nothing to do; the in-memory rotation in the form still prevents reuse. */
  }
}

export function isDraftSessionComplete(
  sessionId: string,
  documentType: string,
  storage: DraftStorage | null | undefined
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(completedKey(documentType, sessionId)) === "1";
  } catch {
    return false;
  }
}

function completedKey(documentType: string, sessionId: string): string {
  return `bill-creator-complete:${documentType}:${sessionId}`;
}

/* ──────────────────────────────────────────────
   Session in the URL
   ────────────────────────────────────────────── */

/**
 * The session id in a query string, if it is a plausible one.
 *
 * Accepting only UUID-shaped ids keeps a hand-edited URL from naming a session that
 * another tab is using, and keeps the storage keys bounded in length.
 */
export function draftSessionFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(DRAFT_SESSION_PARAM);
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

/** The same query string with a session id set — used by `history.replaceState`. */
export function withDraftSession(search: string, sessionId: string): string {
  const params = new URLSearchParams(search);
  params.set(DRAFT_SESSION_PARAM, sessionId);
  const text = params.toString();
  return text ? `?${text}` : "";
}
