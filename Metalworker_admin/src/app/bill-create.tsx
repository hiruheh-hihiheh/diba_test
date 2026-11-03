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

import { useLocalSearchParams, router } from "expo-router";
import React, { useEffect, useState } from "react";

import {
  CreateBillScreen,
  type CreatorMode,
} from "../components/bills/CreateBillScreen";
import type { BillDocumentType } from "../services/billDocumentTypes";
import { newDraftKey } from "../services/draftLifecycle";

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

  const [sessionId] = useState(() =>
    typeof params.session === "string" && UUID_RE.test(params.session)
      ? params.session
      : newDraftKey()
  );

  useEffect(() => {
    /* A resumed draft has no creation intent to identify, so no session is minted into
       the URL. Every other mode gets one, so a refresh reuses the key. */
    if (mode === null || mode === "resume") return;
    if (typeof params.session === "string" && params.session === sessionId) return;
    router.setParams({ session: sessionId } as never);
  }, [mode, params.session, sessionId]);

  /* The screen is re-mounted per mode by keeping the mode in the URL and letting the
     component key its own state on it. Choosing a mode therefore REPLACES the URL rather
     than nudging it, so Back from the form returns to the Bills list and not to the
     entry screen — the entry screen has served its purpose the moment a mode is chosen. */
  return (
    <CreateBillScreen
      key={`${mode ?? "entry"}:${sourceBillId ?? ""}:${sessionId}`}
      mode={mode}
      sourceBillId={sourceBillId}
      sessionId={sessionId}
      documentType={documentType}
      onChooseMode={(chosen) => {
        router.setParams({ mode: chosen, copy: undefined, draft: undefined, session: sessionId } as never);
      }}
      onChooseSource={(billId) => {
        router.setParams({ mode: "copy", copy: billId, draft: undefined, documentType, session: sessionId } as never);
      }}
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
