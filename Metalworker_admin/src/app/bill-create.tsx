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
// Refresh semantics were copied from the desktop route deliberately: no mode in the URL
// means the entry screen, `mode=empty|profile` means the form, `copy=<bill id>` means the
// form with that bill as its source, and `draft=<bill id>` means continue editing that
// saved draft.
//
// `session` is the creation intent's identity. It is minted here when the form is
// opened, then written back into the URL so a refresh resumes the SAME intent and its
// idempotency key. Two separate visits to this route are two intents and get two ids.
//
// ON A PHONE THE URL IS NOT ENOUGH
//
// An Android force-stop does not guarantee that Expo Router restores the last URL. The
// route therefore also consults `draftSessionStore`, which keeps the session id, the
// idempotency key, the document type and the canonical bill id in AsyncStorage. If no
// session is in the URL but an unfinished one is stored, that one is resumed. Choosing
// a mode from the entry screen explicitly starts a NEW intent, so a deliberate second
// invoice never inherits the first one's identity.

import { useLocalSearchParams, router } from "expo-router";
import React, { useEffect, useState } from "react";

import {
  CreateBillScreen,
  type CreatorMode,
} from "../components/bills/CreateBillScreen";
import type { BillDocumentType } from "../services/billDocumentTypes";
import { draftKeyForSession, isDraftSessionComplete, newDraftKey } from "../services/draftLifecycle";
import { draftSessionStore } from "../services/draftSessionStore";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function BillCreateRoute() {
  const params = useLocalSearchParams<{
    mode?: string | string[];
    copy?: string | string[];
    draft?: string | string[];
    session?: string | string[];
    documentType?: string | string[];
  }>();

  const draftId = typeof params.draft === "string" && UUID_RE.test(params.draft) ? params.draft : null;
  const mode = draftId ? "resume" : readMode(params.mode);
  const sourceBillId = draftId ?? (typeof params.copy === "string" ? params.copy : null);
  /* The document type travels in the URL for the same reason the mode does: a phone
     reclaims the process mid-form, and the form that comes back must still be the
     challan form rather than silently a tax invoice. */
  const documentType: BillDocumentType =
    params.documentType === "delivery_challan" ? "delivery_challan" : "tax_invoice";

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    (async () => {
      await draftSessionStore.hydrate();
      if (!live) return;

      const hydrateWarning = draftSessionStore.storageError();
      if (hydrateWarning) setStorageNote(hydrateWarning);

      const fromUrl =
        typeof params.session === "string" && UUID_RE.test(params.session)
          ? params.session
          : null;
      if (fromUrl) {
        setSessionId(fromUrl);
        return;
      }

      /* A mode without a session is either a deep link or a restored process. Resume the
         stored unfinished intent when it belongs to this document type; otherwise mint
         a fresh one. The entry screen (mode === null) never resumes, because choosing a
         mode is what starts an intent. */
      if (mode !== null && mode !== "resume") {
        const active = await draftSessionStore.readActive();
        if (
          live &&
          active &&
          active.documentType === documentType &&
          !isDraftSessionComplete(active.sessionId, documentType, draftSessionStore.storage())
        ) {
          setSessionId(active.sessionId);
          return;
        }
      }

      if (live) setSessionId(newDraftKey());
    })();

    return () => {
      live = false;
    };
  }, [params.session, mode, documentType]);

  useEffect(() => {
    if (!sessionId || mode === null || mode === "resume") return;
    if (typeof params.session === "string" && params.session === sessionId) return;
    router.setParams({ session: sessionId } as never);
  }, [mode, params.session, sessionId]);

  /* The store hydrates asynchronously. Rendering the form before that would let
     `draftKeyForSession` mint a key that is not the one already stored, which is exactly
     the duplicate-draft bug this change exists to remove. */
  if (sessionId === null) return null;

  /* Choosing a mode is a NEW creation intent. It gets a new session id and a new
     idempotency key even if an older unfinished session is still stored, so "Create
     Bill" twice never resolves the second form to the first bill. */
  const startIntent = (chosen: CreatorMode, source: string | null) => {
    const fresh = newDraftKey();
    setSessionId(fresh);
    void draftSessionStore
      .remember({
        sessionId: fresh,
        documentType,
        draftKey: draftKeyForSession(fresh, documentType, draftSessionStore.storage()),
        billId: null,
        mode: chosen,
        sourceBillId: source,
      })
      .catch(() => {
        setStorageNote(draftSessionStore.storageError());
      });
    router.setParams({
      mode: chosen,
      copy: source ?? undefined,
      draft: undefined,
      session: fresh,
      documentType,
    } as never);
  };

  return (
    <CreateBillScreen
      key={`${mode ?? "entry"}:${sourceBillId ?? ""}:${sessionId}`}
      mode={mode}
      sourceBillId={sourceBillId}
      sessionId={sessionId}
      documentType={documentType}
      storageNote={storageNote}
      onChooseMode={(chosen) => startIntent(chosen, null)}
      onChooseSource={(billId) => startIntent("copy", billId)}
      onBackToEntry={() => {
        /* Clearing the params drops the mode, which takes the screen back to the entry
           view because `readMode(undefined)` — and only that — returns null. */
        router.setParams({ mode: undefined, copy: undefined, draft: undefined, documentType } as never);
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

/** The modes, with anything else — including no mode — meaning the entry screen. */
function readMode(raw: string | string[] | undefined): CreatorMode | null {
  if (typeof raw !== "string") return null;
  if (raw === "empty" || raw === "profile" || raw === "copy") return raw;
  return null;
}
