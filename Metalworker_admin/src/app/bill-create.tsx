// src/app/bill-create.tsx
//
// THE BILL CREATOR'S ROUTE.
//
// This file owns NOTHING except the route. Choosing what to do is done in
// `components/bills/CreateBillScreen`; what reaches this screen is the mode in the URL,
// exactly like the desktop's `/bills/create?mode=...&copy=...`.
//
// WHY THE MODE LIVES IN THE URL
//
// A phone conversation ends, a glance at another app happens, the OS reclaims the
// process. When the admin comes back, a screen that remembers its choice only in memory
// has no idea it was mid-way through copying a bill. A URL parameter survives all of
// that, and Expo Router gives it a place for free.
//
// Refresh semantics were copied from the desktop route deliberately: no mode in the URL
// means the entry screen, `mode=empty|profile` means the form, and `copy=<bill id>` means
// the form with that bill as its source.

import { useLocalSearchParams, router } from "expo-router";
import React from "react";

import {
  CreateBillScreen,
  type CreatorMode,
} from "../components/bills/CreateBillScreen";

export default function BillCreateRoute() {
  const params = useLocalSearchParams<{ mode?: string | string[]; copy?: string | string[] }>();

  const mode = readMode(params.mode);
  const sourceBillId = typeof params.copy === "string" ? params.copy : null;

  /* The screen is re-mounted per mode by keeping the mode in the URL and letting the
     component key its own state on it. Choosing a mode therefore REPLACES the URL rather
     than nudging it, so Back from the form returns to the Bills list and not to the
     entry screen — the entry screen has served its purpose the moment a mode is chosen. */
  return (
    <CreateBillScreen
      mode={mode}
      sourceBillId={sourceBillId}
      onChooseMode={(chosen) => {
        router.setParams({ mode: chosen, copy: undefined });
      }}
      onChooseSource={(billId) => {
        router.setParams({ mode: "copy", copy: billId });
      }}
      onBackToEntry={() => {
        /* Clearing the params drops the mode, which takes the screen back to the entry
           view because `readMode(undefined)` — and only that — returns null. */
        router.setParams({ mode: undefined, copy: undefined } as never);
      }}
      onExit={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/bills");
      }}
    />
  );
}

/** The three modes, with anything else — including no mode — meaning the entry screen. */
function readMode(raw: string | string[] | undefined): CreatorMode | null {
  if (typeof raw !== "string") return null;
  if (raw === "empty" || raw === "profile" || raw === "copy") return raw;
  return null;
}