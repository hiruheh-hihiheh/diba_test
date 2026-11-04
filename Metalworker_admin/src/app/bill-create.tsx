// src/app/bill-create.tsx
//
// THE BILL CREATOR'S ROUTE.
//
// This file owns NOTHING except the route. Choosing what to do is done in
// `components/bills/CreateBillScreen`; what reaches this screen is the mode in the URL,
// exactly like the desktop's `/bills/create?mode=...&copy=...&draft=...`.
//
// WHY THE MODE LIVES IN THE URL
//
// A phone conversation ends, a glance at another app happens, the OS reclaims the
// process. When the admin comes back, a screen that remembers its choice only in memory
// has no idea it was mid-way through copying a bill or continuing a draft. A URL
// parameter survives all of that, and Expo Router gives it a place for free.
//
// THE STORED RECORD IS THE SOURCE OF TRUTH, NOT JUST THE ID
//
// The URL carries a session id; the durable record carries the whole intent: the
// idempotency key, whether a bill already exists, the original mode and the source bill
// it was copied from. A restart therefore restores the COMPLETE record:
//
//   * a record with a `billId` resumes that bill (`mode=resume`), and never creates
//     another;
//   * a record without a `billId` resumes the ORIGINAL creation intent with the SAME
//     key, so a save is either the first save of that draft or the recovery of it,
//     never a second draft;
//   * the entry screen offers "Continue unfinished …" when such a record exists, and
//     choosing it resumes the record rather than minting a new one.
//
// A deliberate "Create New" always mints a fresh session and key. An unfinished session
// is never inherited silently, because that is how the second invoice of the day would
// resolve to the first one.

import { useLocalSearchParams, router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  CreateBillScreen,
  type CreatorMode,
} from "../components/bills/CreateBillScreen";
import type { BillDocumentType } from "../services/billDocumentTypes";
import { draftKeyForSession, isDraftSessionComplete, newDraftKey } from "../services/draftLifecycle";
import { draftSessionStore, type CreatorSessionRecord } from "../services/draftSessionStore";
import {
  intentFromRecord,
  intentMatchesParams,
  intentToParams,
  type ResolvedIntent,
} from "../services/draftSessionIntent";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The URL intent, before the durable record gets a say. */
function readMode(raw: string | string[] | undefined): CreatorMode | null {
  if (typeof raw !== "string") return null;
  if (raw === "empty" || raw === "profile" || raw === "copy") return raw;
  return null;
}

export default function BillCreateRoute() {
  const params = useLocalSearchParams<{
    mode?: string | string[];
    copy?: string | string[];
    draft?: string | string[];
    session?: string | string[];
    documentType?: string | string[];
  }>();

  const draftId =
    typeof params.draft === "string" && UUID_RE.test(params.draft) ? params.draft : null;
  const urlMode = draftId ? "resume" : readMode(params.mode);
  const urlSource = draftId ?? (typeof params.copy === "string" ? params.copy : null);
  /* The document type travels in the URL for the same reason the mode does: a phone
     reclaims the process mid-form, and the form that comes back must still be the
     challan form rather than silently a tax invoice. */
  const documentType: BillDocumentType =
    params.documentType === "delivery_challan" ? "delivery_challan" : "tax_invoice";

  const [intent, setIntent] = useState<ResolvedIntent | null>(null);
  const [activeRecord, setActiveRecord] = useState<CreatorSessionRecord | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  /* Guards the parameter-sync effect from writing while the restore is still resolving. */
  const resolving = useRef(true);

  /* ── The creation identity must be durable before the first create ────────
     A save that creates a bill is only idempotent for as long as its key survives.
     The form is therefore allowed to send its FIRST create only once the key and the
     session record have actually reached storage. Until then `identityReady` is false,
     the creator refuses to post, and the banner offers a retry that keeps the form
     exactly as it is. `identityRef` holds the record to retry, so a failed write can be
     retried without minting a new identity. */
  type IdentityPatch = {
    sessionId: string;
    documentType: BillDocumentType;
    draftKey: string;
    billId: null;
    mode: CreatorMode;
    sourceBillId: string | null;
  };
  const [identityReady, setIdentityReady] = useState(true);
  const identityRef = useRef<IdentityPatch | null>(null);

  const persistIdentity = useCallback(async (patch: IdentityPatch): Promise<boolean> => {
    identityRef.current = patch;
    setIdentityReady(false);
    try {
      await draftSessionStore.remember(patch);
      identityRef.current = null;
      setIdentityReady(true);
      setStorageNote(draftSessionStore.storageError());
      return true;
    } catch {
      /* The record may have been written while the separate key entry failed; either
         way the form stays usable and the banner says recovery is not guaranteed. */
      setStorageNote(draftSessionStore.storageError());
      return false;
    }
  }, []);

  /** Start a brand-new creation intent, and record it before the form can post. */
  const beginIntent = useCallback(
    (sessionId: string, chosen: CreatorMode, source: string | null) => {
      const key = draftKeyForSession(sessionId, documentType, draftSessionStore.storage());
      setIntent({ sessionId, mode: chosen, sourceBillId: source, draftKey: key });
      setActiveRecord(null);
      void persistIdentity({
        sessionId,
        documentType,
        draftKey: key,
        billId: null,
        mode: chosen,
        sourceBillId: source,
      });
    },
    [documentType, persistIdentity]
  );

  /* ── Resolve the intent: URL first, durable record as the authority ─────── */

  useEffect(() => {
    let live = true;
    resolving.current = true;

    (async () => {
      await draftSessionStore.hydrate();
      if (!live) return;

      const hydrateWarning = draftSessionStore.storageError();
      if (hydrateWarning) setStorageNote(hydrateWarning);

      const stored = await draftSessionStore.readActive();
      if (!live) return;

      const usable =
        stored &&
        stored.documentType === documentType &&
        !isDraftSessionComplete(stored.sessionId, documentType, draftSessionStore.storage())
          ? stored
          : null;
      setActiveRecord(usable);

      const fromUrl =
        typeof params.session === "string" && UUID_RE.test(params.session)
          ? params.session
          : null;

      const restore = (record: CreatorSessionRecord) => {
        setIdentityReady(true);
        identityRef.current = null;
        setIntent(intentFromRecord(record));
      };

      if (fromUrl) {
        /* The URL names an intent. If the durable record is the same intent, the record
           supplies the bill id, mode, source AND the key the URL never carried. */
        if (usable && usable.sessionId === fromUrl) {
          restore(usable);
          resolving.current = false;
          return;
        }
        if (urlMode !== null) {
          /* A session in the URL with no record is a creation intent whose identity is
             not durable yet. Record it (and gate the first create) under that session
             rather than replacing the id the URL named. */
          beginIntent(fromUrl, urlMode, urlSource);
        } else {
          setIdentityReady(true);
          setIntent({ sessionId: fromUrl, mode: null, sourceBillId: null, draftKey: null });
        }
        resolving.current = false;
        return;
      }

      if (urlMode !== null) {
        /* A mode with no session is a deep link or a restored process. Reuse the stored
           unfinished intent for this document type when there is one; otherwise mint a
           fresh identity. */
        if (usable) {
          restore(usable);
          resolving.current = false;
          return;
        }
        if (urlMode === "resume") {
          /* Resuming a bill creates nothing, so there is no first-create to gate and no
             creation key to send - the bill id alone identifies the row. */
          setIdentityReady(true);
          setIntent({
            sessionId: newDraftKey(),
            mode: "resume",
            sourceBillId: urlSource,
            draftKey: null,
          });
        } else {
          beginIntent(newDraftKey(), urlMode, urlSource);
        }
        resolving.current = false;
        return;
      }

      /* The entry screen. An unfinished record is OFFERED there, never entered
         automatically; the session id is only a placeholder until a choice is made. */
      setIdentityReady(true);
      setIntent({ sessionId: newDraftKey(), mode: null, sourceBillId: null, draftKey: null });
      resolving.current = false;
    })();

    return () => {
      live = false;
    };
  }, [
    params.session,
    params.mode,
    params.copy,
    params.draft,
    documentType,
    urlMode,
    urlSource,
    beginIntent,
  ]);

  /* Keep the URL describing the resolved intent, so a refresh restores the SAME one.
     The equality check is what stops this from looping with the effect above. */
  useEffect(() => {
    if (!intent || intent.mode === null || resolving.current) return;
    if (intentMatchesParams(params, intent)) return;
    router.setParams({ ...intentToParams(intent), documentType } as never);
  }, [intent, params, documentType]);

  /* The store hydrates asynchronously. Rendering the form before that would let
     `draftKeyForSession` mint a key that is not the one already stored, which is exactly
     the duplicate-draft bug this change exists to remove. */
  if (intent === null) return null;

  /**
   * Choosing a mode is a NEW creation intent: new session, new key, durable record
   * pointing at it. An older unfinished session stays stored and remains offered from
   * the entry screen, but it is never inherited by this one.
   */
  const startIntent = (chosen: CreatorMode, source: string | null) => {
    beginIntent(newDraftKey(), chosen, source);
  };

  /** Resume the stored record exactly as it was left, including its key. */
  const continueSession = (record: CreatorSessionRecord) => {
    setIdentityReady(true);
    identityRef.current = null;
    setIntent(intentFromRecord(record));
  };

  return (
    <CreateBillScreen
      key={`${intent.mode ?? "entry"}:${intent.sourceBillId ?? ""}:${intent.sessionId}`}
      mode={intent.mode}
      sourceBillId={intent.sourceBillId}
      sessionId={intent.sessionId}
      documentType={documentType}
      storageNote={storageNote}
      draftKey={intent.draftKey}
      identityReady={identityReady}
      onRetryIdentity={async () => {
        const pending = identityRef.current;
        if (!pending) return true;
        return persistIdentity(pending);
      }}
      activeSession={activeRecord}
      onContinueSession={continueSession}
      onChooseMode={(chosen) => startIntent(chosen, null)}
      onChooseSource={(billId) => startIntent("copy", billId)}
      onBackToEntry={() => {
        /* Clearing every mode parameter drops the screen to the entry view because
           `readMode(undefined)` — and only that — returns null. The session id is
           cleared too, so the restore effect cannot jump straight back into the form
           that was just left. */
        setIntent({ sessionId: newDraftKey(), mode: null, sourceBillId: null, draftKey: null });
        router.setParams({
          mode: undefined,
          copy: undefined,
          draft: undefined,
          session: undefined,
          documentType,
        } as never);
      }}
      onExit={() => {
        if (router.canGoBack()) router.back();
        else {
          /* Cast because Expo's generated route union lags the filesystem for a route
             added to a section that already existed; the path itself is real and the
             section it names is `challan-bills.tsx`. */
          router.replace(
            (documentType === "delivery_challan" ? "/challan-bills" : "/bills") as never
          );
        }
      }}
    />
  );
}
