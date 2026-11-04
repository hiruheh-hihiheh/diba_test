// src/services/draftSessionIntent.ts
//
// WHAT A STORED SESSION MEANS WHEN IT IS RESTORED.
//
// The durable record is more than a session id: it holds the idempotency key, whether a
// row already exists, the mode the form was opened in and the bill it was copied from.
// Restoring only the id throws all of that away, and an id on its own is not enough to
// decide whether to resume a bill or continue the original creation intent.
//
// The rules are small enough to state, and small enough to test:
//
//   1. A bill id wins. Resuming the row cannot create a second document, and it is the
//      strongest fact available.
//   2. Without a bill id, continue the ORIGINAL intent (mode and source) with the SAME
//      key. The server treats the key as the identity of that draft, so the first save
//      after a restart either creates it or recovers it — never duplicates it.
//   3. A `resume` mode with no bill id is unreadable. Falling back to a blank form is
//      safe because the key is retained; falling back to "resume nothing" is not.
//
// Kept pure and outside the router so the behaviour can be exercised without Expo.

import type { CreatorMode, CreatorSessionRecord } from "./draftSessionStoreCore";

export interface ResolvedIntent {
  sessionId: string;
  mode: CreatorMode | null;
  sourceBillId: string | null;
}

export function intentFromRecord(record: CreatorSessionRecord): ResolvedIntent {
  if (record.billId) {
    return { sessionId: record.sessionId, mode: "resume", sourceBillId: record.billId };
  }
  if (record.mode === "copy" && record.sourceBillId) {
    return { sessionId: record.sessionId, mode: "copy", sourceBillId: record.sourceBillId };
  }
  if (record.mode === "profile") {
    return { sessionId: record.sessionId, mode: "profile", sourceBillId: null };
  }
  return { sessionId: record.sessionId, mode: "empty", sourceBillId: null };
}

/** The URL parameters that describe an intent, for the equality check that stops the
    parameter-sync effect from looping. */
export interface IntentParams {
  mode?: string | string[];
  copy?: string | string[];
  draft?: string | string[];
  session?: string | string[];
}

export function intentMatchesParams(params: IntentParams, intent: ResolvedIntent): boolean {
  const wantMode = intent.mode === "resume" ? undefined : intent.mode ?? undefined;
  const wantCopy = intent.mode === "copy" ? intent.sourceBillId ?? undefined : undefined;
  const wantDraft = intent.mode === "resume" ? intent.sourceBillId ?? undefined : undefined;
  return (
    params.mode === wantMode &&
    params.copy === wantCopy &&
    params.draft === wantDraft &&
    params.session === intent.sessionId
  );
}

/** The parameters that describe an intent, in the shape `router.setParams` wants. */
export function intentToParams(intent: ResolvedIntent): {
  mode: string | undefined;
  copy: string | undefined;
  draft: string | undefined;
  session: string;
} {
  return {
    mode: intent.mode === "resume" ? undefined : intent.mode ?? undefined,
    copy: intent.mode === "copy" ? intent.sourceBillId ?? undefined : undefined,
    draft: intent.mode === "resume" ? intent.sourceBillId ?? undefined : undefined,
    session: intent.sessionId,
  };
}
