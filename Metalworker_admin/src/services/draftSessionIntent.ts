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
// THE KEY TRAVELS WITH THE INTENT
//
// The key lives in two places on the device: the active record and a separate key
// entry that `draftKeyForSession` reads. The record is written even when the key entry
// write fails, so a restore that trusted only the key entry would mint a DIFFERENT
// token for the same intent and create a second draft. `draftKey` is therefore part of
// the resolved intent, and `resolveCreatorDraftKey` prefers it over anything the key
// entry says.
//
// Kept pure and outside the router so the behaviour can be exercised without Expo.

import {
  draftKeyForSession,
  draftSessionStorageKey,
  isDraftSessionComplete,
  type DraftStorage,
} from "./draftLifecycle.ts";
import type { CreatorMode, CreatorSessionRecord } from "./draftSessionStoreCore";

export interface ResolvedIntent {
  sessionId: string;
  mode: CreatorMode | null;
  sourceBillId: string | null;
  /** The exact key the stored session was created with, when there is a record. */
  draftKey: string | null;
}

export function intentFromRecord(record: CreatorSessionRecord): ResolvedIntent {
  if (record.billId) {
    return {
      sessionId: record.sessionId,
      mode: "resume",
      sourceBillId: record.billId,
      draftKey: record.draftKey,
    };
  }
  if (record.mode === "copy" && record.sourceBillId) {
    return {
      sessionId: record.sessionId,
      mode: "copy",
      sourceBillId: record.sourceBillId,
      draftKey: record.draftKey,
    };
  }
  if (record.mode === "profile") {
    return {
      sessionId: record.sessionId,
      mode: "profile",
      sourceBillId: null,
      draftKey: record.draftKey,
    };
  }
  return {
    sessionId: record.sessionId,
    mode: "empty",
    sourceBillId: null,
    draftKey: record.draftKey,
  };
}

/**
 * The key the creator form must send for this intent.
 *
 * A resumed bill sends no creation key at all: it already exists, and sending one
 * would ask the server to create a second bill beside it.
 *
 * A creation intent restores the record's key even when the separate key entry is
 * missing, and repairs that entry so the next reload finds it too. Only an intent with
 * no remembered key mints one, which is the same behaviour a brand-new session had
 * before restoration existed.
 */
export function resolveCreatorDraftKey(
  intent: Pick<ResolvedIntent, "sessionId" | "mode" | "draftKey">,
  documentType: string,
  storage: DraftStorage | null | undefined
): string {
  if (intent.mode === "resume") return "";
  if (!intent.draftKey) {
    return draftKeyForSession(intent.sessionId, documentType, storage);
  }
  if (storage) {
    try {
      /* A completed session must never hand its finalized key back. `draftKeyForSession`
         rotates the key and clears the completion marker, which is exactly the safe
         behaviour here too. */
      if (isDraftSessionComplete(intent.sessionId, documentType, storage)) {
        return draftKeyForSession(intent.sessionId, documentType, storage);
      }
      const storageKey = draftSessionStorageKey(documentType, intent.sessionId);
      if (storage.getItem(storageKey) !== intent.draftKey) {
        storage.setItem(storageKey, intent.draftKey);
      }
    } catch {
      /* The record's copy is enough to keep this session stable; the caller has
         already been told if the backend is failing. */
    }
  }
  return intent.draftKey;
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
