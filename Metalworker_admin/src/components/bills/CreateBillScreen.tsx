// src/components/bills/CreateBillScreen.tsx
//
// THE BILL CREATOR, ON A PHONE.
//
// ONE CANONICAL BILL, TWO LAYOUTS
//
// This is the same form as `Metalworker_desktop/src/pages/CreateBill.tsx`: the same
// sections A to K, the same fields, the same three entry modes, the same
// `creatorForm.ts` and `billCreator.ts` underneath. The ONLY difference is layout — a
// phone stacks the sections instead of putting them in a two- or three-column grid.
//
// That constraint is the whole reason this is not a second billing engine. Both screens
// call the same `create-bill` edge function with the same patch, so a bill created here
// and a bill created on the desktop are the same row, the same arithmetic and the same
// three PDFs. A mobile-only variant of the form would be a place where the two could
// disagree about what "amount after tax" means, and the tests would have to be written
// twice to keep them honest.
//
// WHAT IS DIFFERENT HERE, AND WHY
//
//   · Preview opens in the device's own PDF app rather than a browser tab — see
//     `services/creatorPreview.ts`, which is the ONLY platform-specific file in this
//     feature. `billCreator.ts` stays byte-identical between the apps.
//   · Autosave is on by default and explicit "Save Draft" is still there, because a phone
//     is where an admin is most likely to be interrupted.
//   · Sections are collapsed to their headers once saved, so a twenty-line bill does not
//     push the Save/Preview/Generate footer off the screen.
//
// EVERY STORED NUMBER COMES FROM THE SERVER
//
// The only figure computed on the device is quantity x rate in the line-item table, shown
// while typing. The tax section reads back what `save` returned. So the totals on screen
// and the totals in the PDF cannot drift, because they are the same number travelling
// through one function.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useAdminGate } from "../../hooks/useAdminGate";
import {
  BANK_FIELD_ORDER_LABEL,
  TEMPLATE_VARIABLES,
  amountInWordsForPatch,
  blankCreatorLine,
  creatorTotals,
  fillTemplate,
  generationNotice,
  isLikelyToChange,
  lineAmount,
  paymentDaysFromTerms,
  seedEmpty,
  seedFromProfile,
  seedFromRecord,
  type BankDetails,
  type CreatorFormValues,
  type CreatorLineDraft,
  type CreatorSeed,
} from "../../services/creatorForm";
import {
  CreatorError,
  finalizeCreatorDraft,
  previewCreatorDraft,
  saveCreatorDraft,
  type CreatorDuplicate,
  type CreatorSaveResult,
} from "../../services/billCreator";
import { showCreatorPreview } from "../../services/creatorPreview";
import { getBillConnections, unlinkJobsFromBill } from "../../services/billJobConnections";
import { createBillingFolder, fetchBillingFolders, type BillingFolder } from "../../services/billingFolders";
import { fetchBill, fetchBillFolderId, fetchBillLineItems, fetchBills } from "../../services/bills";
import { draftKeyForSession, newDraftKey } from "../../services/draftLifecycle";
import { resolveCreatorDraftKey } from "../../services/draftSessionIntent";
import { draftSessionStore } from "../../services/draftSessionStore";
import {
  createSaveQueue,
  type SaveOutcome,
  type SaveQueue,
  type SaveQueueState,
} from "../../services/saveQueue";
import { formatBillDate, formatMoney } from "../../services/billFormat";
import { DOCUMENT_TYPE_INFO, type BillDocumentType } from "../../services/billDocumentTypes";
import { fetchInvoiceLogos } from "../../services/invoiceLogos";
import { fetchInvoiceBusinessProfile } from "../../services/invoiceBusinessProfile";
import { notify } from "../../utils/notify";
import type { InvoiceLogo } from "../../types/invoiceLogo";
import type { BillJobConnection } from "../../types/billJobConnections";
import type { JobType } from "../../types/job";

import type { CreatorSessionRecord } from "../../services/draftSessionStore";
import { LogoPickerModal } from "./LogoPickerModal";
import { BillSourcePickerSheet } from "./BillSourcePickerSheet";
import { LinkBillToJobsSheet } from "./LinkBillToJobsSheet";

/** Long enough to coalesce a typist into one write, short enough to survive a refresh. */
const AUTOSAVE_MS = 1200;

export type CreatorMode = "empty" | "profile" | "copy" | "resume";

export interface CreateBillScreenProps {
  mode: CreatorMode | null;
  /** The bill being copied, when `mode` is `"copy"`. */
  sourceBillId: string | null;
  /**
   * This creation intent's id, minted by the route and carried in the URL so a refresh
   * reuses the same idempotency key while a fresh navigation gets a new one.
   */
  sessionId?: string;
  /**
   * Which document this form makes. The same screen serves both sections, with a
   * challan-specific field set, validation and storage type; a missing value means a
   * Tax Invoice, which is what every existing route passes.
   */
  documentType?: BillDocumentType;
  /** Called when the admin picks a mode on the entry screen. */
  onChooseMode: (mode: CreatorMode) => void;
  /** Called with the bill to copy when the picker is confirmed. */
  onChooseSource: (billId: string) => void;
  /** Leave the entry screen without choosing anything. */
  onExit: () => void;
  /** Back of the form to the entry screen, abandoning the current mode's draft view. */
  onBackToEntry: () => void;
  /** A persistence warning from the route, shown instead of silently promising recovery. */
  storageNote?: string | null;
  /**
   * The exact key the stored session was created with. The creator prefers it over the
   * separate key entry, because the record can exist while that entry write failed.
   */
  draftKey?: string | null;
  /**
   * False while this creation intent has not reached durable storage. The first create
   * is refused until it is true, so a lost response cannot leave an untracked bill.
   */
  identityReady?: boolean;
  /** Retry writing the creation identity; resolves true once it is durable. */
  onRetryIdentity?: () => boolean | Promise<boolean>;
  /**
   * The unfinished session stored on this device, when there is one for this document
   * type. The entry screen offers to continue it; it is never entered automatically.
   */
  activeSession?: CreatorSessionRecord | null;
  /** Resume the stored record exactly as it was left. */
  onContinueSession?: (record: CreatorSessionRecord) => void;
}

type Styles = ReturnType<typeof createStyles>;

export function CreateBillScreen(props: CreateBillScreenProps) {
  const { mode, sourceBillId, documentType = "tax_invoice" } = props;
  const sessionId = props.sessionId ?? newDraftKey();
  const gate = useAdminGate();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (mode === null) {
    return (
      <EntryScreen
        styles={styles}
        documentType={documentType}
        checking={gate.checking}
        isAdmin={gate.status === "ok"}
        onChoose={props.onChooseMode}
        onChooseSource={props.onChooseSource}
        onExit={props.onExit}
        activeSession={props.activeSession ?? null}
        onContinueSession={props.onContinueSession}
      />
    );
  }

  return (
    <CreatorForm
      key={`${documentType}:${mode}:${sourceBillId ?? ""}`}
      mode={mode}
      sourceBillId={sourceBillId}
      documentType={documentType}
      styles={styles}
      isAdmin={gate.status === "ok"}
      onExit={props.onExit}
      onBackToEntry={props.onBackToEntry}
      sessionId={sessionId}
      storageNote={props.storageNote ?? null}
      draftKey={props.draftKey ?? null}
      identityReady={props.identityReady ?? true}
      onRetryIdentity={props.onRetryIdentity}
    />
  );
}

/* ──────────────────────────────────────────────
   The entry screen: which of the three ways
   ────────────────────────────────────────────── */

function EntryScreen({
  styles,
  documentType,
  checking,
  isAdmin,
  onChoose,
  onChooseSource,
  onExit,
  activeSession,
  onContinueSession,
}: {
  styles: Styles;
  documentType: BillDocumentType;
  checking: boolean;
  isAdmin: boolean;
  onChoose: (mode: CreatorMode) => void;
  onChooseSource: (billId: string) => void;
  onExit: () => void;
  activeSession: CreatorSessionRecord | null;
  onContinueSession: ((record: CreatorSessionRecord) => void) | undefined;
}) {
  const info = DOCUMENT_TYPE_INFO[documentType];
  const challan = documentType === "delivery_challan";
  const noun = info.noun.toLowerCase();
  const [anyBillExists, setAnyBillExists] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* Only asked when the entry screen is actually up. One row is enough — this is a
     yes/no, and the total it reports is the same total the Bills list shows, so the two
     cannot disagree about whether anything exists. A failure leaves the button absent
     rather than showing one that opens an empty picker. */
  useEffect(() => {
    let live = true;
    fetchBills({ page: 1, pageSize: 1, documentType })
      .then((page) => {
        if (live) setAnyBillExists(page.total > 0);
      })
      .catch(() => {
        if (live) setAnyBillExists(false);
      });
    return () => {
      live = false;
    };
  }, [documentType]);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.entryBody}>
        <Pressable onPress={onExit} hitSlop={10} accessibilityRole="button">
          <Text style={styles.back}>‹ {info.section}</Text>
        </Pressable>

        <Text style={styles.entryTitle}>Create a {noun}</Text>
        <Text style={styles.entrySub}>
          All three options produce the same {noun}, with the same Original, Duplicate and
          Triplicate PDFs. They differ only in what starts filled in.
        </Text>

        {/* FIRST, because it is the one choice the admin has already made once. It is
            only an OFFER: Create New below still starts a completely fresh intent, so
            this can never make the second invoice of the day inherit the first. */}
        {activeSession && onContinueSession && (
          <EntryChoice
            styles={styles}
            title={`Continue unfinished ${noun}`}
            body={
              activeSession.billId
                ? `The ${noun} you were editing is saved on this device. Continue the same draft — no new ${noun} is created.`
                : `A ${noun} you started is saved on this device. Continue it with the same draft identity, so no duplicate is created.`
            }
            disabled={!isAdmin}
            onPress={() => onContinueSession(activeSession)}
          />
        )}

        <EntryChoice
          styles={styles}
          title={`Create New ${info.noun}`}
          body={
            challan
              ? "A blank challan. Fill in the customer, the material rows and the transport details yourself."
              : "A blank bill. Fill in the customer, the line items and the taxes yourself."
          }
          disabled={!isAdmin}
          onPress={() => onChoose("empty")}
        />
        <EntryChoice
          styles={styles}
          title={`New ${info.noun} + Profile`}
          body={
            challan
              ? "The same blank challan, with your Invoice Business Profile company details, address and signature wording. No bank or payment terms."
              : "The same blank bill, with your Invoice Business Profile preloaded — company details, bank block, terms and footer wording."
          }
          disabled={!isAdmin}
          onPress={() => onChoose("profile")}
        />
        {anyBillExists ? (
          <EntryChoice
            styles={styles}
            title={`Copy Existing ${info.noun}`}
            body={
              challan
                ? "Start from a challan that already exists. Only Delivery Challans are listed; the original is never changed."
                : "Start from a bill that already exists. Its data is copied; the original is never changed."
            }
            disabled={!isAdmin}
            onPress={() => setPickerOpen(true)}
          />
        ) : (
          /* Absent, not disabled. With nothing to copy there is no decision to make, and a
             greyed-out control invites the question "why is that grey?". */
          <View style={styles.entryAbsent}>
            <Text style={styles.entryAbsentTitle}>Copy Existing {info.noun}</Text>
            <Text style={styles.note}>
              {checking
                ? `Looking for a ${noun} to copy…`
                : `Appears once there is a ${noun} to copy.`}
            </Text>
          </View>
        )}

        {!isAdmin && !checking && (
          <Text style={styles.errorText}>
            Only an active admin can create a {noun}. You can read the ones that exist.
          </Text>
        )}
      </ScrollView>

      {/* The picker lives here rather than inside the router, because choosing a source is
          one step of this screen and not a page in its own right. What comes out of it is
          a bill id, and only the id crosses the routing boundary. */}
      <BillSourcePickerSheet
        visible={pickerOpen}
        documentType={documentType}
        onClose={() => setPickerOpen(false)}
        onConfirm={(billId) => {
          setPickerOpen(false);
          onChooseSource(billId);
        }}
      />
    </SafeAreaView>
  );
}

/* ──────────────────────────────────────────────
   The form, for one mode
   ────────────────────────────────────────────── */

function CreatorForm({
  mode,
  sourceBillId,
  sessionId,
  documentType,
  styles,
  isAdmin,
  onExit,
  onBackToEntry,
  storageNote,
  draftKey: restoredDraftKey,
  identityReady = true,
  onRetryIdentity,
}: {
  mode: CreatorMode;
  sourceBillId: string | null;
  sessionId: string;
  documentType: BillDocumentType;
  styles: Styles;
  isAdmin: boolean;
  onExit: () => void;
  onBackToEntry: () => void;
  storageNote: string | null;
  draftKey: string | null;
  identityReady?: boolean;
  onRetryIdentity?: () => boolean | Promise<boolean>;
}) {
  const isCopy = mode === "copy";
  const isResume = mode === "resume";
  const info = DOCUMENT_TYPE_INFO[documentType];
  const challan = documentType === "delivery_challan";
  const documentNoun = challan ? "challan" : "bill";

  const { theme } = useTheme();

  /* ── The form ────────────────────────────────────────────── */

  const [values, setValues] = useState<CreatorFormValues>({});
  const [lines, setLines] = useState<CreatorLineDraft[]>([]);
  const [bank, setBankState] = useState<BankDetails>({});
  const [amountInWords, setAmountInWordsState] = useState("");
  const [wordsTouched, setWordsTouchedState] = useState(false);
  const [roundOff, setRoundOffState] = useState<string | null>(null);
  const [reverseChargeGst, setReverseChargeGstState] = useState<string | null>(null);

  /* ── Everything that is NOT a patch field ────────────────── */

  const [billId, setBillIdState] = useState<string | null>(null);
  const [logoId, setLogoIdState] = useState<string | null | undefined>(undefined);
  const [folderId, setFolderIdState] = useState<string | null>(null);
  const [jobIds, setJobIdsState] = useState<string[]>([]);
  const [connections, setConnections] = useState<BillJobConnection[]>([]);
  const [useCurrentProfile, setUseCurrentProfileState] = useState(false);

  /* ── The latest form, readable synchronously ──────────────
     React state is not readable from the event that is still being handled: a field
     change and a Generate click can land before the next render. These refs are
     updated by every mutation helper (and re-synced after each render as a safety
     net), so `buildRequest` always sends the value the admin last typed. */
  const valuesRef = useRef(values);
  const linesRef = useRef(lines);
  const bankRef = useRef(bank);
  const amountInWordsRef = useRef(amountInWords);
  const wordsTouchedRef = useRef(wordsTouched);
  const roundOffRef = useRef(roundOff);
  const reverseChargeRef = useRef(reverseChargeGst);
  const billIdRef = useRef<string | null>(null);
  /* The identity gate is read from a callback that can run in the same tick as the state
     change that clears it (the retry path flushes immediately), so the guard reads a ref
     rather than the rendered prop. */
  const identityReadyRef = useRef(identityReady);
  useEffect(() => {
    identityReadyRef.current = identityReady;
  }, [identityReady]);
  const logoIdRef = useRef(logoId);
  const folderIdRef = useRef(folderId);
  const jobIdsRef = useRef(jobIds);
  const useCurrentProfileRef = useRef(useCurrentProfile);
  const queueRef = useRef<SaveQueue | null>(null);

  /**
   * Report an edit to the save queue.
   *
   * Every mutation helper below updates its ref FIRST and then calls this, so a
   * Generate that happens in the same event loop turn as a keystroke still sends the
   * typed value. The queue owns the debounce and the version counter; this only says
   * "there is a newer version".
   */
  const markChanged = useCallback(() => {
    queueRef.current?.change();
  }, []);

  /* ── Setters that keep the refs in step ─────────────────── */

  const setBillId = useCallback((id: string | null) => {
    billIdRef.current = id;
    setBillIdState(id);
  }, []);

  const setLogoId = useCallback(
    (id: string | null | undefined) => {
      logoIdRef.current = id;
      setLogoIdState(id);
      markChanged();
    },
    [markChanged]
  );

  const setFolderId = useCallback(
    (id: string | null) => {
      folderIdRef.current = id;
      setFolderIdState(id);
      markChanged();
    },
    [markChanged]
  );

  const setJobIds = useCallback(
    (update: string[] | ((previous: string[]) => string[])) => {
      const next = typeof update === "function" ? update(jobIdsRef.current) : update;
      jobIdsRef.current = next;
      setJobIdsState(next);
      markChanged();
    },
    [markChanged]
  );

  const setUseCurrentProfile = useCallback(
    (update: boolean | ((previous: boolean) => boolean)) => {
      const next =
        typeof update === "function" ? update(useCurrentProfileRef.current) : update;
      useCurrentProfileRef.current = next;
      setUseCurrentProfileState(next);
      markChanged();
    },
    [markChanged]
  );

  const setBank = useCallback(
    (update: BankDetails | ((previous: BankDetails) => BankDetails)) => {
      const next = typeof update === "function" ? update(bankRef.current) : update;
      bankRef.current = next;
      setBankState(next);
      markChanged();
    },
    [markChanged]
  );

  const setAmountInWords = useCallback(
    (value: string) => {
      amountInWordsRef.current = value;
      setAmountInWordsState(value);
      markChanged();
    },
    [markChanged]
  );

  const setWordsTouched = useCallback((value: boolean) => {
    wordsTouchedRef.current = value;
    setWordsTouchedState(value);
  }, []);

  const setRoundOff = useCallback(
    (value: string | null) => {
      roundOffRef.current = value;
      setRoundOffState(value);
      markChanged();
    },
    [markChanged]
  );

  const setReverseChargeGst = useCallback(
    (value: string | null) => {
      reverseChargeRef.current = value;
      setReverseChargeGstState(value);
      markChanged();
    },
    [markChanged]
  );

  /* A safety net, not the primary path. Every setter above already updates its ref, so
     this only matters if some future state change forgets to. It runs after the render
     and deliberately does NOT call `change()`: seeding a form is not an edit. */
  useEffect(() => {
    valuesRef.current = values;
    linesRef.current = lines;
    bankRef.current = bank;
    amountInWordsRef.current = amountInWords;
    wordsTouchedRef.current = wordsTouched;
    roundOffRef.current = roundOff;
    reverseChargeRef.current = reverseChargeGst;
    logoIdRef.current = logoId;
    folderIdRef.current = folderId;
    jobIdsRef.current = jobIds;
    useCurrentProfileRef.current = useCurrentProfile;
  }, [
    values,
    lines,
    bank,
    amountInWords,
    wordsTouched,
    roundOff,
    reverseChargeGst,
    logoId,
    folderId,
    jobIds,
    useCurrentProfile,
  ]);

  /* ── Server's numbers. Displayed, never computed here. ──── */

  const [serverTotals, setServerTotals] = useState<{
    total_quantity: number | null;
    amount_before_tax: number | null;
    cgst: number | null;
    sgst: number | null;
    igst: number | null;
    total_gst: number | null;
    amount_after_tax: number | null;
  } | null>(null);
  const [serverWords, setServerWords] = useState<string | null>(null);

  /* ── Chrome ──────────────────────────────────────────────── */

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ field: string; message: string }[]>([]);
  const [duplicates, setDuplicates] = useState<CreatorDuplicate[]>([]);
  const [busy, setBusy] = useState<null | "preview" | "finalize">(null);
  /* A synchronous guard, because `busy` only becomes true after React re-renders. Two
     taps in the same frame would otherwise start two finalizes. */
  const inFlightRef = useRef(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [jobsModalOpen, setJobsModalOpen] = useState(false);
  const [jobsTab, setJobsTab] = useState<JobType>("labour");
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  /* ── Reference data ──────────────────────────────────────── */

  const [folders, setFolders] = useState<BillingFolder[]>([]);
  const [logos, setLogos] = useState<InvoiceLogo[]>([]);
  const [profilePaymentDays, setProfilePaymentDays] = useState<number | null>(null);
  const [profileCompanyName, setProfileCompanyName] = useState<string | null>(null);

  /* A resumed draft is identified by its bill id, so it sends no creation key at all —
     sending one would ask the server to create a second bill beside the row being
     edited. A new draft's key belongs to this session, never to the mode or source, so
     a second "Create Bill" click cannot reuse the first form's token.

     `sessionKey` is always present, because the session store needs one to record the
     session even when the request itself omits it. */
  const sessionKey = useMemo(
    () =>
      /* A resumed bill sends no creation key, but the session record still needs one so a
         restart can find it; the bill id remains what identifies the row. */
      resolveCreatorDraftKey(
        { sessionId, mode, draftKey: restoredDraftKey },
        documentType,
        draftSessionStore.storage()
      ) || draftKeyForSession(sessionId, documentType, draftSessionStore.storage()),
    [sessionId, mode, restoredDraftKey, documentType]
  );
  const draftKey = isResume ? "" : sessionKey;

  /* ── Loading the form's starting state ───────────────────── */

  const applySeed = useCallback((seed: CreatorSeed) => {
    /* The seed keeps `terms` as its own three-tuple rather than inside `values`, because
       on the server they are not three columns — they are one `terms` array. Flattening
       them here is only safe because the network layer reads them back out of `values`
       and re-joins them through `termsToPatch`, so the decision about whether an all-blank
       set of terms should clear or be left alone is still made in one place.

       Seeding is NOT an edit. It writes the refs directly and bypasses `markChanged`, so
       opening a draft does not immediately schedule a redundant write. */
    const seededValues: CreatorFormValues = {
      ...seed.values,
      term_1: seed.terms[0],
      term_2: seed.terms[1],
      term_3: seed.terms[2],
    };
    valuesRef.current = seededValues;
    linesRef.current = seed.lines;
    bankRef.current = seed.bank;
    amountInWordsRef.current = seed.amountInWords;
    wordsTouchedRef.current = false;
    roundOffRef.current = seed.roundOff;
    reverseChargeRef.current = seed.reverseChargeGst;

    setValues(seededValues);
    setLines(seed.lines);
    setBankState(seed.bank);
    setAmountInWordsState(seed.amountInWords);
    setWordsTouchedState(false);
    setRoundOffState(seed.roundOff);
    setReverseChargeGstState(seed.reverseChargeGst);
  }, []);

  /* Runs exactly once: the component is mounted fresh per mode. Every setState in it
     happens after an `await`, so there is deliberately no "reset everything" preamble —
     the state this would reset was created a moment ago. */
  useEffect(() => {
    let live = true;

    (async () => {
      try {
        if (mode === "copy" && sourceBillId) {
          /* The SOURCE is read as data — its columns and its line items. Its PDF is never
             opened, downloaded or parsed: re-deriving a bill from a printed document
             would produce a second parser whose disagreements are invisible. */
          const [bill, items, profile] = await Promise.all([
            fetchBill(sourceBillId, documentType),
            fetchBillLineItems(sourceBillId),
            fetchInvoiceBusinessProfile(),
          ]);
          if (!live) return;

          /* The picker is already type-scoped; this catches a stale link or a switched
             form. The server refuses the same request again when the draft is created. */
          if ((bill.document_type ?? "tax_invoice") !== documentType) {
            setLoadError(
              challan
                ? "That is a Tax Invoice. A Delivery Challan can only be copied from another Delivery Challan."
                : "That is a Delivery Challan. A Tax Invoice can only be copied from another Tax Invoice."
            );
            setLoading(false);
            return;
          }

          if (profile?.payment_days !== undefined && profile.payment_days !== null) {
            setProfilePaymentDays(Number(profile.payment_days));
          }
          setProfileCompanyName(profile?.company_name ?? null);

          applySeed(
            seedFromRecord(
              bill as unknown as Record<string, unknown>,
              items as unknown as Record<string, unknown>[],
              "copy"
            )
          );

          /* A copy of a bill that has a logo starts with that logo. `logo_id` is the logo
             this bill will print, and a copy that printed a different letterhead than the
             source it was copied from would be a silent change to the document. */
          setLogoId(bill.logo_id ?? null);

          /* NO job links are inherited, and that is a decision rather than an oversight:
             the jobs the source was for are a different job, and silently attaching a new
             invoice to them is how a labour job gets billed twice. */
        } else if (mode === "resume" && sourceBillId) {
          /* Continue editing. The draft is read as data — fields, lines, logo, folder and
             linked jobs — and every save updates THIS row. No second bill is created. */
          const [bill, items, profile, folder, links] = await Promise.all([
            fetchBill(sourceBillId, documentType),
            fetchBillLineItems(sourceBillId),
            fetchInvoiceBusinessProfile(),
            fetchBillFolderId(sourceBillId),
            getBillConnections(sourceBillId).catch(() => [] as BillJobConnection[]),
          ]);
          if (!live) return;

          if ((bill.document_type ?? "tax_invoice") !== documentType) {
            setLoadError(
              challan
                ? "That is a Tax Invoice draft. Open it from Tax Invoice Billing instead."
                : "That is a Delivery Challan draft. Open it from Challan Billing instead."
            );
            setLoading(false);
            return;
          }
          /* The stored status decides, not the client. A finalized document is edited
             through the bill editor and never through this draft-save path. */
          if ((bill.status ?? "finalized") !== "draft") {
            setLoadError(
              "This document has already been generated. Open it from the list to view or edit it."
            );
            setLoading(false);
            return;
          }

          if (profile?.payment_days !== undefined && profile.payment_days !== null) {
            setProfilePaymentDays(Number(profile.payment_days));
          }
          setProfileCompanyName(profile?.company_name ?? null);

          applySeed(
            seedFromRecord(
              bill as unknown as Record<string, unknown>,
              items as unknown as Record<string, unknown>[],
              "draft"
            )
          );
          setBillId(bill.id);
          setLogoId(bill.logo_id ?? null);
          setFolderId(folder);
          setConnections(links);
          setJobIds(links.map((link) => link.job_id));
        } else {
          const profile = mode === "profile" ? await fetchInvoiceBusinessProfile() : null;
          if (!live) return;

          if (profile?.payment_days !== undefined && profile.payment_days !== null) {
            setProfilePaymentDays(Number(profile.payment_days));
          }
          setProfileCompanyName(profile?.company_name ?? null);

          /* The difference between the two buttons is entirely in this call. */
          applySeed(
            mode === "profile" && profile
              ? seedFromProfile(profile as unknown as Record<string, unknown>, "new", documentType)
              : seedEmpty("new")
          );
          setLogoId(undefined);
        }

        if (!live) return;
        const [folderList, logoList] = await Promise.all([
          /* Scoped to this section's document type: a challan must never be offered a
             Tax Invoice billing folder, because the database will refuse to link it. */
          fetchBillingFolders(documentType),
          fetchInvoiceLogos(),
        ]);
        if (!live) return;
        setFolders(folderList);
        setLogos(logoList);
        setLoading(false);
      } catch (err) {
        if (!live) return;
        setLoadError(
          err instanceof Error ? err.message : "The bill could not be opened for editing."
        );
        setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [mode, sourceBillId, applySeed, documentType, challan, setBillId, setLogoId, setFolderId, setJobIds]);

  /* ── The link set, read back from the bill ──────────────── */

  /* Only ever called once a `billId` exists, so the "no bill yet" case needs no branch:
     `connections` starts empty, and a bill id never goes back to null here. */
  const refreshConnections = useCallback(async () => {
    if (!billId) return;
    try {
      setConnections(await getBillConnections(billId));
    } catch {
      setConnections([]);
    }
  }, [billId]);

  useEffect(() => {
    if (!billId) return;
    let live = true;
    getBillConnections(billId)
      .then((found) => {
        if (live) setConnections(found);
      })
      .catch(() => {
        if (live) setConnections([]);
      });
    return () => {
      live = false;
    };
  }, [billId]);

  /* ── Changing a value ────────────────────────────────────── */

  const setField = useCallback(
    (field: string, value: string) => {
      const next = { ...valuesRef.current, [field]: value };
      valuesRef.current = next;
      setValues(next);
      markChanged();
    },
    [markChanged]
  );

  const setLine = useCallback(
    (key: string, field: keyof Omit<CreatorLineDraft, "key">, value: string) => {
      const next = linesRef.current.map((line) =>
        line.key === key ? { ...line, [field]: value } : line
      );
      linesRef.current = next;
      setLines(next);
      markChanged();
    },
    [markChanged]
  );

  const addLine = useCallback(() => {
    const previous = linesRef.current;
    const next = [
      ...previous,
      blankCreatorLine(`row-${Date.now()}-${previous.length}`, previous.length),
    ];
    linesRef.current = next;
    setLines(next);
    markChanged();
  }, [markChanged]);

  const removeLine = useCallback(
    (key: string) => {
      /* Never leave zero rows. An empty table has nowhere to type, and a bill with no line
         items is refused at finalization anyway. */
      const previous = linesRef.current;
      const next =
        previous.length <= 1
          ? [{ ...blankCreatorLine(`row-${Date.now()}`, 0) }]
          : previous.filter((line) => line.key !== key);
      linesRef.current = next;
      setLines(next);
      markChanged();
    },
    [markChanged]
  );

  const moveLine = useCallback(
    (key: string, by: number) => {
      const previous = linesRef.current;
      const at = previous.findIndex((line) => line.key === key);
      const to = at + by;
      if (at < 0 || to < 0 || to >= previous.length) return;
      const reordered = [...previous];
      const [moved] = reordered.splice(at, 1);
      reordered.splice(to, 0, moved);
      /* `sr_no` is renumbered with the row. It is a printed column, so leaving it behind
         would print "1, 3, 2" after a reorder — the invoice would look like a mistake. */
      const next = reordered.map((line, index) => ({ ...line, srNo: String(index + 1) }));
      linesRef.current = next;
      setLines(next);
      markChanged();
    },
    [markChanged]
  );

  /* ── Saving ──────────────────────────────────────────────── */

  const buildRequest = useCallback(
    (overrides: Record<string, unknown> = {}) => ({
      documentType,
      billId: billIdRef.current,
      sourceBillId,
      useCurrentProfile: useCurrentProfileRef.current,
      values: valuesRef.current,
      lines: linesRef.current,
      amountInWords: amountInWordsForPatch(amountInWordsRef.current, wordsTouchedRef.current),
      roundOff: roundOffRef.current,
      reverseChargeGst: reverseChargeRef.current,
      bank: bankRef.current,
      draftKey,
      logoId: logoIdRef.current,
      folderId: folderIdRef.current,
      jobIds: jobIdsRef.current,
      ...overrides,
    }),
    [documentType, sourceBillId, draftKey]
  );

  /* Replaced wholesale, never merged: keeping a previous CGST while a new save has none
     would show a tax the invoice is no longer charging, and a challan's quantity would
     stay stuck at the first value. */
  const applyServerTotals = useCallback(
    (result: {
      total_quantity?: number | null;
      amount_before_tax?: number | null;
      cgst?: number | null;
      sgst?: number | null;
      igst?: number | null;
      total_gst?: number | null;
      amount_after_tax: number | null;
      amount_in_words: string | null;
    }) => {
      setServerTotals({
        total_quantity: result.total_quantity ?? null,
        amount_before_tax: result.amount_before_tax ?? null,
        cgst: result.cgst ?? null,
        sgst: result.sgst ?? null,
        igst: result.igst ?? null,
        total_gst: result.total_gst ?? null,
        amount_after_tax: result.amount_after_tax,
      });
      setServerWords(result.amount_in_words);
      /* The server's wording is not an edit: writing it through the ref and the raw
         setter keeps it out of the save queue. */
      if (!wordsTouchedRef.current && result.amount_in_words) {
        amountInWordsRef.current = result.amount_in_words;
        setAmountInWordsState(result.amount_in_words);
      }
    },
    []
  );

  const lastSaveError = useRef("The draft could not be saved.");
  const saveRef = useRef<(options?: { silent?: boolean }) => Promise<CreatorSaveResult | null>>(
    async () => null
  );

  /**
   * Record the canonical bill id against this session so a restart can resume it.
   *
   * AWAITED by the save that produced the id. The form must not claim durable recovery
   * before the identity and row have actually reached storage; when the write fails the
   * banner says so, and the draft itself is still safely on the server and is still
   * reachable from the Billing list. A retry reuses the same key, so this cannot create
   * a second bill.
   */
  const rememberSession = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await draftSessionStore.remember({
          sessionId,
          documentType,
          draftKey: sessionKey,
          billId: id,
          mode,
          sourceBillId,
        });
        setStorageWarning(null);
        return true;
      } catch {
        setStorageWarning(draftSessionStore.storageError());
        return false;
      }
    },
    [sessionId, documentType, sessionKey, mode, sourceBillId]
  );

  /* The ONE write path. Autosave, Save Draft, Preview, Generate and Save & Exit all
     reach the server through the queue, which calls this. Nothing else calls
     `saveCreatorDraft` directly, so two writes can never be in flight at once. */
  const performSave = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (loading) return null;
      /* A first create must never leave the device before its key is durable: if the
         response were lost, a retry could not prove which draft it was. A resumed bill
         already has its identity (the id), so it is never blocked here. */
      if (!identityReadyRef.current && !isResume && !billIdRef.current) {
        lastSaveError.current =
          "This draft's identity is not saved on this device yet, so nothing was sent. Use “Try again” above to save it.";
        setStorageWarning(lastSaveError.current);
        if (!options.silent) notify("Not saved", lastSaveError.current);
        return null;
      }
      try {
        const result = await saveCreatorDraft(buildRequest());
        setBillId(result.bill_id);
        applyServerTotals(result);
        await rememberSession(result.bill_id);
        setProblems([]);
        if (!options.silent) notify("Draft saved");
        return result;
      } catch (err) {
        lastSaveError.current =
          err instanceof Error ? err.message : "The draft could not be saved.";
        if (err instanceof CreatorError) {
          setProblems(err.problems.map((p) => ({ field: p.field, message: p.message })));
          /* Not toasted. A validation failure is shown on the field it belongs to, and a
             toast saying "could not save" above a form that has not visibly changed teaches
             an admin that the form is broken. */
          if (err.problems.length === 0 && !options.silent) notify("Not saved", err.message);
        } else if (!options.silent) {
          notify(
            "Not saved",
            err instanceof Error ? err.message : "The draft could not be saved."
          );
        }
        return null;
      }
    },
    [loading, buildRequest, applyServerTotals, rememberSession, setBillId, identityReady, isResume]
  );
  /* Written in an effect, not during render: a ref updated in the render path is exactly
     what the hooks linting forbids, and the queue only reads it when a save actually runs. */
  useEffect(() => {
    saveRef.current = performSave;
  }, [performSave]);

  const [queueState, setQueueState] = useState<SaveQueueState>({
    status: "idle",
    dirtyVersion: 0,
    savedVersion: 0,
    savedAt: null,
    error: null,
    running: false,
  });
  /* Created in an effect, never during render: the queue's save callback closes over a
     ref, and building it in the render path would read that ref while rendering. */
  useEffect(() => {
    const created = createSaveQueue({
      debounceMs: AUTOSAVE_MS,
      save: async (): Promise<SaveOutcome> => {
        const result = await saveRef.current({ silent: true });
        return result
          ? { ok: true, savedAt: result.saved_at ?? null }
          : { ok: false, error: lastSaveError.current };
      },
      onState: setQueueState,
    });
    queueRef.current = created;
    return () => {
      queueRef.current = null;
      created.dispose();
    };
  }, []);

  /* Retrying the identity is only half the job: edits typed while it was failing were
     never sent. Once the key is durable, flush them through the normal queue rather than
     asking the admin to touch a field again. A clean form is left alone - retrying must
     not create an empty draft by itself. */
  const retryIdentity = useCallback(async () => {
    if (!onRetryIdentity) return;
    const ok = await onRetryIdentity();
    if (!ok) return;
    /* The flush below runs before React has re-rendered with the new prop. */
    identityReadyRef.current = true;
    if (queueRef.current?.isDirty()) await queueRef.current.saveNow();
  }, [onRetryIdentity]);

  /* A resumed draft is already stored under its bill id; remembering it here is what
     lets a phone restart land back on it rather than on the entry screen. */
  useEffect(() => {
    if (!isResume || !sourceBillId) return;
    void draftSessionStore
      .remember({
        sessionId,
        documentType,
        draftKey: sessionKey,
        billId: sourceBillId,
        mode: "resume",
        sourceBillId,
      })
      .catch(() => {
        /* Non-fatal: the URL still carries the bill id. */
      });
  }, [isResume, sourceBillId, sessionId, documentType, sessionKey]);

  /* ── Autosave ────────────────────────────────────────────── */

  /* The queue owns the debounce and the ordering. Every mutation helper calls
     `markChanged()`, so there is no render-driven effect that could report a seeded
     form as an edit. */

  /* ── Leaving with unsaved work ───────────────────────────── */

  const [exitOpen, setExitOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  /* Where the pending prompt will go if the admin chooses to leave: the section list,
     or back to this screen's entry view. Both are navigation, so both are guarded. */
  const [exitTarget, setExitTarget] = useState<"exit" | "entry">("exit");

  const leaveTo = useCallback(
    (target: "exit" | "entry") => {
      if (target === "entry") onBackToEntry();
      else onExit();
    },
    [onBackToEntry, onExit]
  );

  /**
   * The ONE navigation guard. `isBusy()` rather than `isDirty()`: a forced Save Draft on
   * an otherwise clean form is a real write on the wire, and leaving during it used to
   * be invisible to this check.
   */
  const requestNavigation = useCallback(
    (target: "exit" | "entry") => {
      if (busy !== null) return;
      setExitTarget(target);
      const queue = queueRef.current;
      if (queue && (queue.isBusy() || queue.state().status === "error")) {
        setExitOpen(true);
        return;
      }
      leaveTo(target);
    },
    [busy, leaveTo]
  );

  const requestExit = useCallback(() => requestNavigation("exit"), [requestNavigation]);
  const requestBackToEntry = useCallback(() => requestNavigation("entry"), [requestNavigation]);

  const saveAndExit = useCallback(async () => {
    setExitBusy(true);
    const saved = (await queueRef.current?.flush()) === true;
    setExitBusy(false);
    if (!saved) {
      /* Do not navigate away from a failed save. The draft is still open, the values are
         still in memory, and Retry is one tap away. */
      notify("Not saved", "The latest changes could not be saved, so you are still here.");
      return;
    }
    setExitOpen(false);
    leaveTo(exitTarget);
  }, [exitTarget, leaveTo]);

  /* Save Draft forces a write even when no autosave has been scheduled yet, which is
     what makes it work on a brand-new form. It goes through the same queue, so it can
     never run beside an autosave. */
  const saveDraft = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const saved = (await queueRef.current?.saveNow()) === true;
      if (saved) notify("Draft saved");
      else notify("Not saved", lastSaveError.current);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  /* Leave draft cancels the debounce, waits for a request that is already on the wire,
     discards every version it never confirmed, and starts no further save. */
  const leaveDraft = useCallback(async () => {
    setExitBusy(true);
    await queueRef.current?.abandon();
    setExitBusy(false);
    setExitOpen(false);
    leaveTo(exitTarget);
  }, [exitTarget, leaveTo]);

  /* Android's hardware back is an exit path like any other, so it goes through the same
     prompt instead of bypassing it. Returning true tells the OS the press was handled. */
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy !== null) return true;
      setExitTarget("exit");
      const queue = queueRef.current;
      if (queue && (queue.isBusy() || queue.state().status === "error")) {
        setExitOpen(true);
        return true;
      }
      onExit();
      return true;
    });
    return () => subscription.remove();
  }, [busy, onExit]);

  /* ── Preview ─────────────────────────────────────────────── */

  const preview = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy("preview");
    try {
      /* `saveNow` forces one write even when the queue believes it is clean, so the
         preview always renders the latest values and always has a canonical bill id. */
      const saved = (await queueRef.current?.saveNow()) === true;
      const id = billIdRef.current;
      if (!saved || !id) {
        notify("Not previewed", lastSaveError.current);
        return;
      }
      const result = await previewCreatorDraft(buildRequest({ billId: id }));
      setBillId(result.bill_id);
      applyServerTotals(result);
      const outcome = await showCreatorPreview(result.pdf_base64, result.filename);
      if (outcome === "failed") {
        notify("Preview failed", "The preview could not be shown. Try again.");
      } else {
        notify("Preview opened", "Nothing has been generated yet.");
      }
    } catch (err) {
      notify(
        "Preview failed",
        err instanceof Error ? err.message : "The preview could not be produced."
      );
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  }, [buildRequest, applyServerTotals, setBillId]);

  /* ── Finalize ────────────────────────────────────────────── */

  const finalize = useCallback(
    async (confirmDuplicate: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy("finalize");
      setDuplicates([]);
      try {
        /* Persist the newest values and confirm the canonical row BEFORE generating. A
           generation that started from an unsaved form would print something different
           from the draft the admin can see. */
        const saved = (await queueRef.current?.flush()) === true;
        const id = billIdRef.current;
        if (!saved || !id) {
          notify(
            "Not generated",
            lastSaveError.current ||
              "The latest changes could not be saved, so nothing was generated."
          );
          return;
        }

        const result = await finalizeCreatorDraft(
          buildRequest({ billId: id, confirmDuplicateInvoiceNo: confirmDuplicate })
        );
        setBillId(result.bill_id);
        setProblems([]);
        setDuplicates([]);
        /* Generated and filed are two different outcomes. The PDFs are always made
           first, so a folder link the database refused must not be reported as a
           plain success — the admin would go looking for a challan in a folder it
           never reached. */
        const notice = generationNotice(result, {
          label: challan ? "Challan" : "Invoice",
          noun: documentNoun,
        });
        notify(notice.title, notice.body);
        /* Retire the creation session only after the server confirms the generated bill.
           A failed finalize leaves the key alone so a retry updates this draft. */
        await draftSessionStore.forget(sessionId, documentType);
        /* Nothing that was typed during generation is saved onto a finalized row: the
           queue drops unconfirmed versions instead of starting another write. */
        await queueRef.current?.abandon();
        /* Away to the list, because the work is done and the list is where an admin
           verifies it. Staying here would show a form for a bill that can no longer be
           edited. */
        onExit();
      } catch (err) {
        if (err instanceof CreatorError && err.isDuplicateInvoiceNo) {
          /* The draft is saved and intact; only the finalize was refused. The bills that
             already use the number are listed so the admin can go and look at them before
             deciding — which is the whole reason the server refuses rather than allowing
             it. */
          setDuplicates(err.duplicates);
        } else if (err instanceof CreatorError) {
          setProblems(err.problems.map((p) => ({ field: p.field, message: p.message })));
          notify("Not generated", err.message);
        } else {
          notify(
            "Not generated",
            err instanceof Error ? err.message : "The invoice could not be generated."
          );
        }
      } finally {
        inFlightRef.current = false;
        setBusy(null);
      }
    },
    [buildRequest, onExit, challan, documentNoun, sessionId, documentType, setBillId]
  );

  /* ── Jobs ────────────────────────────────────────────────── */

  const unlinkJob = useCallback(
    async (jobId: string) => {
      if (!billId) return;
      try {
        await unlinkJobsFromBill(billId, [jobId]);
        setJobIds((previous) => previous.filter((id) => id !== jobId));
        await refreshConnections();
      } catch (err) {
        notify(
          "Not unlinked",
          err instanceof Error ? err.message : "That job could not be unlinked."
        );
      }
    },
    [billId, refreshConnections, setJobIds]
  );

  /* ── Folders ─────────────────────────────────────────────── */

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (name === "") return;
    /* `createBillingFolder` reports `ok: false` rather than throwing, because "that folder
       already exists" is an answer rather than a fault — and this form must treat it as
       one. An admin who types a name they have used before wants that folder. */
    /* The folder type comes from the section, not from a default: creating a
       `billing` folder from the Challan Creator would produce a folder the challan
       can never be filed in. */
    const result = await createBillingFolder(name, documentType);
    const created = result.data;
    if (!result.ok || !created) {
      notify("Not created", result.error ?? "The folder could not be created.");
      return;
    }
    setFolders((previous) =>
      previous.some((folder) => folder.id === created.id) ? previous : [...previous, created]
    );
    setFolderId(created.id);
    setNewFolderName("");
    setFolderPickerOpen(false);
    notify("Folder ready", `“${created.name}” created and selected.`);
  }, [newFolderName, documentType, setFolderId]);

  /* ── Derived, display only ───────────────────────────────── */

  /* The one number this screen computes, and it is quantity x rate shown while typing. */
  const lineTotals = useMemo(() => creatorTotals(lines), [lines]);

  const problemFor = useCallback(
    (field: string) => problems.find((p) => p.field === field)?.message ?? null,
    [problems]
  );

  const hi = useCallback((field: string) => isCopy && isLikelyToChange(field), [isCopy]);

  /* ── Loading ─────────────────────────────────────────────── */

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <View style={styles.centred}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.note}>
            {isCopy
              ? `Reading the ${documentNoun} being copied…`
              : `Opening the ${documentNoun} creator…`}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.entryBody}>
          <Pressable onPress={requestExit} hitSlop={10} accessibilityRole="button">
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>This {documentNoun} could not be opened</Text>
            <Text style={styles.note}>{loadError}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Pressable onPress={requestBackToEntry} hitSlop={10} accessibilityRole="button">
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>

          <Text style={styles.pageTitle}>
            {isResume ? `Continue ${info.noun} Draft` : isCopy ? `Create from Previous ${info.noun}` : `Create ${info.noun}`}
          </Text>
          <Text style={styles.pageSub}>
            {isCopy
              ? `A new draft from an existing ${documentNoun}. The original is not changed.`
              : `A new ${documentNoun}, saved as a draft until you generate it.`}
          </Text>

          {storageNote || storageWarning ? (
            <View style={styles.errorBox}>
              <Text style={styles.note}>{storageNote ?? storageWarning}</Text>
              {identityReady === false && onRetryIdentity ? (
                <Pressable onPress={retryIdentity} hitSlop={8} accessibilityRole="button">
                  <Text style={[styles.note, { fontWeight: "700" }]}>
                    Try saving the draft identity again
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {isCopy && (
            <Pressable
              style={styles.checkRow}
              onPress={() => setUseCurrentProfile((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: useCurrentProfile }}
            >
              <View style={[styles.box, useCurrentProfile && styles.boxOn]}>
                {useCurrentProfile && <Text style={styles.boxTick}>✓</Text>}
              </View>
              <View style={styles.flex}>
                <Text style={styles.checkLabel}>Use current Invoice Business Profile</Text>
                <Text style={styles.note}>
                  {useCurrentProfile
                    ? challan
                      ? "Company details, address, contacts and signature wording are taken from your profile as it is now. Bank and payment terms are never put on a challan."
                      : "Company details, bank block, terms and footer wording are taken from your profile as it is now."
                    : `Off, so the source ${documentNoun}'s own wording is preserved exactly as it was issued.`}
                </Text>
              </View>
            </Pressable>
          )}

          {problems.length > 0 && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Fix these before generating</Text>
              {problems.map((problem) => (
                <Text key={`${problem.field}:${problem.message}`} style={styles.note}>
                  <Text style={styles.errorTitle}>{fieldLabel(problem.field, challan)}: </Text>
                  {problem.message}
                </Text>
              ))}
            </View>
          )}

          {/* ── A. Invoice Information ───────────────────────── */}
          <Section
            styles={styles}
            title={challan ? "A. Challan Information" : "A. Invoice Information"}
          >
            <Field
              styles={styles}
              label={challan ? "Challan number" : "Invoice number"}
              highlight={hi("invoice_no")}
              hint={problemFor("invoice_no")}
              value={values.invoice_no ?? ""}
              onChange={(v) => setField("invoice_no", v)}
              placeholder={challan ? "CH/2026/001" : "INV/2026/001"}
            />
            <DateField
              styles={styles}
              label={challan ? "Challan date" : "Invoice date"}
              highlight={hi("invoice_date")}
              hint={problemFor("invoice_date")}
              value={values.invoice_date ?? ""}
              onChange={(v) => setField("invoice_date", v)}
            />
            {!challan && (
              <>
                <Field
                  styles={styles}
                  label="Our challan no."
                  highlight={hi("our_challan_no")}
                  value={values.our_challan_no ?? ""}
                  onChange={(v) => setField("our_challan_no", v)}
                />
                <DateField
                  styles={styles}
                  label="Our challan date"
                  highlight={hi("our_challan_date")}
                  value={values.our_challan_date ?? ""}
                  onChange={(v) => setField("our_challan_date", v)}
                />
              </>
            )}
            <Field
              styles={styles}
              label="Your challan no."
              highlight={hi("your_challan_no")}
              value={values.your_challan_no ?? ""}
              onChange={(v) => setField("your_challan_no", v)}
            />
            <DateField
              styles={styles}
              label="Your challan date"
              highlight={hi("your_challan_date")}
              value={values.your_challan_date ?? ""}
              onChange={(v) => setField("your_challan_date", v)}
            />
            <Field
              styles={styles}
              label={challan ? "Service / purchase / sales order no." : "Order number"}
              highlight={hi("order_no")}
              hint="The label beside it is the workbook's own — a 'Service Order No.' stays that."
              value={values.order_no ?? ""}
              onChange={(v) => setField("order_no", v)}
            />
            <Field
              styles={styles}
              label="Order number label"
              hint="Printed exactly as typed, above the number."
              value={values.order_no_label ?? ""}
              onChange={(v) => setField("order_no_label", v)}
              placeholder="Service Order No."
            />
            <DateField
              styles={styles}
              label="Order date"
              highlight={hi("order_date")}
              value={values.order_date ?? ""}
              onChange={(v) => setField("order_date", v)}
            />
            {!challan && (
              <>
                <Field
                  styles={styles}
                  label="E-way bill no."
                  highlight={hi("eway_bill_no")}
                  value={values.eway_bill_no ?? ""}
                  onChange={(v) => setField("eway_bill_no", v)}
                />
                <DateField
                  styles={styles}
                  label="E-way bill date"
                  highlight={hi("eway_bill_date")}
                  value={values.eway_bill_date ?? ""}
                  onChange={(v) => setField("eway_bill_date", v)}
                />
              </>
            )}
            <Field
              styles={styles}
              label="Transporter mode"
              value={values.transporter_mode ?? ""}
              onChange={(v) => setField("transporter_mode", v)}
            />
            <Field
              styles={styles}
              label="Vehicle number"
              value={values.vehicle_number ?? ""}
              onChange={(v) => setField("vehicle_number", v)}
            />
          </Section>

          {/* ── B. Customer / Recipient ─────────────────────── */}
          <Section
            styles={styles}
            title={challan ? "B. Customer / Party" : "B. Customer / Recipient"}
          >
            {!challan && (
              <Field
                styles={styles}
                label="Recipient heading"
                hint="Printed above the customer's name, e.g. 'Bill To'."
                value={values.recipient_label ?? ""}
                onChange={(v) => setField("recipient_label", v)}
              />
            )}
            <Field
              styles={styles}
              label={challan ? "Customer / party name" : "Recipient name"}
              highlight={hi("party_name")}
              hint={problemFor("party_name")}
              value={values.party_name ?? ""}
              onChange={(v) => setField("party_name", v)}
            />
            {!challan && (
              <Field
                styles={styles}
                label="Recipient note"
                hint="A second line under the name, e.g. 'Kindly attend'."
                value={values.recipient_note ?? ""}
                onChange={(v) => setField("recipient_note", v)}
              />
            )}
            <Field
              styles={styles}
              label="Address"
              hint="One line per row is printed as one line."
              value={values.party_address ?? ""}
              onChange={(v) => setField("party_address", v)}
              multiline
            />
            <Field
              styles={styles}
              label={challan ? "Party GST number" : "Customer GST number"}
              hint={problemFor("party_gst_no")}
              value={values.party_gst_no ?? ""}
              onChange={(v) => setField("party_gst_no", v)}
            />
            {!challan && (
              <Field
                styles={styles}
                label="Place of supply"
                hint="Decided by IGST versus CGST/SGST. The tax section below reads the same way."
                value={values.place_of_supply ?? ""}
                onChange={(v) => setField("place_of_supply", v)}
              />
            )}
            <Field
              styles={styles}
              label="State"
              value={values.state ?? ""}
              onChange={(v) => setField("state", v)}
            />
            <Field
              styles={styles}
              label="State code"
              value={values.state_code ?? ""}
              onChange={(v) => setField("state_code", v)}
            />
          </Section>

          {/* ── C. Seller / Business ────────────────────────── */}
          <Section
            styles={styles}
            title="C. Seller / Business"
            description={
              isCopy && !useCurrentProfile
                ? "These are the source bill's own values, kept as it was issued."
                : "Preloaded from the Invoice Business Profile. Anything typed here overrides it."
            }
          >
            <Field
              styles={styles}
              label="Company name"
              value={values.seller_name ?? ""}
              onChange={(v) => setField("seller_name", v)}
            />
            <Field
              styles={styles}
              label="Business description"
              value={values.seller_descriptor ?? ""}
              onChange={(v) => setField("seller_descriptor", v)}
              multiline
            />
            <Field
              styles={styles}
              label="GST / MSME line"
              hint="One printed line: GST number first, then MSME. Leave it exactly as the profile has it."
              value={values.seller_tax_line ?? ""}
              onChange={(v) => setField("seller_tax_line", v)}
            />
            <Field
              styles={styles}
              label="Office address"
              value={values.seller_address ?? ""}
              onChange={(v) => setField("seller_address", v)}
              multiline
            />
            <Field
              styles={styles}
              label="Email / mobile"
              value={values.seller_contact ?? ""}
              onChange={(v) => setField("seller_contact", v)}
            />
          </Section>

          {/* ── D. Line Items ───────────────────────────────── */}
          <Section styles={styles} title="D. Line Items">
            {lines.map((line, index) => (
              <View key={line.key} style={styles.lineCard}>
                <View style={styles.lineHead}>
                  <Text style={styles.lineHeadText}>Line {index + 1}</Text>
                  <View style={styles.row}>
                    <TinyBtn
                      styles={styles}
                      label="Move up"
                      disabled={index === 0}
                      onPress={() => moveLine(line.key, -1)}
                    >
                      ↑
                    </TinyBtn>
                    <TinyBtn
                      styles={styles}
                      label="Move down"
                      disabled={index === lines.length - 1}
                      onPress={() => moveLine(line.key, 1)}
                    >
                      ↓
                    </TinyBtn>
                    <TinyBtn
                      styles={styles}
                      label="Delete this line"
                      onPress={() => removeLine(line.key)}
                    >
                      ✕
                    </TinyBtn>
                  </View>
                </View>
                <Field
                  styles={styles}
                  label="Sr No"
                  value={line.srNo}
                  onChange={(v) => setLine(line.key, "srNo", v)}
                />
                <Field
                  styles={styles}
                  label="Description"
                  value={line.description}
                  onChange={(v) => setLine(line.key, "description", v)}
                  multiline
                />
                <Field
                  styles={styles}
                  label="HSN"
                  value={line.hsnCode}
                  onChange={(v) => setLine(line.key, "hsnCode", v)}
                />
                <Field
                  styles={styles}
                  label="UOM"
                  value={line.uom}
                  onChange={(v) => setLine(line.key, "uom", v)}
                />
                <Field
                  styles={styles}
                  label="Qty"
                  keyboard="decimal-pad"
                  value={line.quantity}
                  onChange={(v) => setLine(line.key, "quantity", v)}
                />
                {challan ? (
                  <Field
                    styles={styles}
                    label="Remarks"
                    value={line.remarks}
                    onChange={(v) => setLine(line.key, "remarks", v)}
                  />
                ) : (
                  <>
                    <Field
                      styles={styles}
                      label="Rate"
                      keyboard="decimal-pad"
                      value={line.rate}
                      onChange={(v) => setLine(line.key, "rate", v)}
                    />
                    <CalcRow
                      styles={styles}
                      label="Amount"
                      /* Read-only. The amount is quantity x rate and the server recomputes it;
                         showing a figure an admin could edit here would be showing a number the
                         invoice does not use. */
                      value={lineAmount(line) === null ? "—" : formatMoney(lineAmount(line))}
                    />
                  </>
                )}
              </View>
            ))}
            <Pressable
              style={styles.ghostBtn}
              onPress={addLine}
              accessibilityRole="button"
            >
              <Text style={styles.ghostBtnText}>+ Add line</Text>
            </Pressable>
            <Text style={styles.note}>
              Rows with no description are not saved. That is the one rule worth knowing: a
              half-typed row cannot quietly add itself to the total.
            </Text>
          </Section>

          {/* ── E. Tax & Totals (Tax Invoice only) ──────────── */}
          {!challan && (
          <Section
            styles={styles}
            title="E. Tax & Totals"
            description="Amounts are the server's, read back after every save — the same numbers the PDF will print."
          >
            <Field
              styles={styles}
              label="CGST rate %"
              hint={problemFor("cgst_rate")}
              keyboard="decimal-pad"
              value={values.cgst_rate ?? ""}
              onChange={(v) => setField("cgst_rate", v)}
            />
            <Field
              styles={styles}
              label="SGST rate %"
              keyboard="decimal-pad"
              value={values.sgst_rate ?? ""}
              onChange={(v) => setField("sgst_rate", v)}
            />
            <Field
              styles={styles}
              label="IGST rate %"
              keyboard="decimal-pad"
              value={values.igst_rate ?? ""}
              onChange={(v) => setField("igst_rate", v)}
            />
            <Field
              styles={styles}
              label="GST payable on reverse charge"
              hint="Left blank, the row still prints."
              value={reverseChargeGst ?? ""}
              onChange={setReverseChargeGst}
            />
            <Field
              styles={styles}
              label="Round off"
              hint="Leave blank and the total is not rounded."
              keyboard="decimal-pad"
              value={roundOff ?? ""}
              onChange={setRoundOff}
            />
            <Field
              styles={styles}
              label="Amount in words"
              hint={serverWords ? `Server's wording: “${serverWords}”` : undefined}
              value={amountInWords}
              onChange={(v) => {
                setAmountInWords(v);
                setWordsTouched(true);
              }}
            />

            <CalcRow
              styles={styles}
              label="Amount before tax"
              value={formatMoney(serverTotals?.amount_before_tax ?? lineTotals.amountBeforeTax)}
            />
            <CalcRow styles={styles} label="CGST" value={formatMoney(serverTotals?.cgst)} />
            <CalcRow styles={styles} label="SGST" value={formatMoney(serverTotals?.sgst)} />
            <CalcRow styles={styles} label="IGST" value={formatMoney(serverTotals?.igst)} />
            <CalcRow
              styles={styles}
              label="Total GST"
              value={formatMoney(serverTotals?.total_gst)}
            />
            <CalcRow
              styles={styles}
              strong
              label="Amount after tax"
              value={formatMoney(serverTotals?.amount_after_tax ?? lineTotals.amountBeforeTax)}
            />

            {!billId && (
              <Text style={styles.note}>
                The exact figures appear once the draft is saved. Until then only the amount
                before tax is known, because it is the only one that depends only on the
                line items.
              </Text>
            )}
          </Section>
          )}

          {/* ── E. Summary (Delivery Challan only) ──────────── */}
          {challan && (
            <Section styles={styles} title="E. Summary">
              <Text style={styles.note}>
                A challan moves material; it charges nothing. Only the total quantity and the
                job type are printed.
              </Text>
              <CalcRow
                styles={styles}
                strong
                label="Total quantity"
                value={String(serverTotals?.total_quantity ?? lineTotals.totalQuantity ?? "—")}
              />
              <Field
                styles={styles}
                label="Job type"
                hint="Printed beside the total quantity as LABOUR JOB or WITH METAL."
                value={values.job_kind ?? ""}
                onChange={(v) => setField("job_kind", v)}
                placeholder="LABOUR JOB"
              />
              <View style={styles.row}>
                <SmallBtn styles={styles} onPress={() => setField("job_kind", "LABOUR JOB")}>
                  Labour Job
                </SmallBtn>
                <SmallBtn styles={styles} onPress={() => setField("job_kind", "WITH METAL")}>
                  With Metal
                </SmallBtn>
              </View>
            </Section>
          )}

          {/* ── F. Bank Details (Tax Invoice only) ─────────── */}
          {!challan && (
          <Section
            styles={styles}
            title="F. Bank Details"
            description="Preloaded from the Invoice Business Profile. Typing here overrides the profile for this bill only."
          >
            {BANK_FIELD_ORDER_LABEL.map(({ key, label }) => (
              <Field
                key={key}
                styles={styles}
                label={label}
                value={bank[key]?.value ?? ""}
                onChange={(v) =>
                  setBank((previous) => ({
                    ...previous,
                    [key]: { label: previous[key]?.label ?? "", value: v },
                  }))
                }
              />
            ))}
            <Text style={styles.note}>
              {Object.values(bank).some((part) => part.value.trim() === "")
                ? "A blank bank line still prints its label. Clear the whole block on the Invoice Profile to stop it appearing."
                : "These four lines are printed exactly as shown, in this order."}
            </Text>
          </Section>
          )}

          {/* ── F. Terms & Conditions (Tax Invoice only) ────── */}
          {!challan && (
          <Section styles={styles} title="F. Terms & Conditions">
            {([1, 2, 3] as const).map((n) => (
              <Field
                key={n}
                styles={styles}
                label={`Term ${n}`}
                hint={
                  (values[`term_${n}`] ?? "").includes("{")
                    ? `Prints as “${fillTemplate(values[`term_${n}`] ?? "", {
                        PAYMENT_DAYS: profilePaymentDays,
                        COMPANY_NAME: profileCompanyName,
                      })}”`
                    : undefined
                }
                value={values[`term_${n}`] ?? ""}
                onChange={(v) => setField(`term_${n}`, v)}
                multiline
              />
            ))}
            <Text style={styles.note}>
              {profilePaymentDays === null
                ? `No payment window is set on the Invoice Profile. ${TEMPLATE_VARIABLES.join(
                    ", "
                  )} are substituted when the invoice prints.`
                : `Your profile's payment window is ${profilePaymentDays} days, and {PAYMENT_DAYS} in a term prints as that number.`}
              {paymentDaysFromTerms([
                values.term_1 ?? "",
                values.term_2 ?? "",
                values.term_3 ?? "",
              ]) !== null &&
                " This bill's terms state their own window — what it was written to say, and it is left alone."}
            </Text>
          </Section>
          )}

          {/* ── G. Closing / Signatures ─────────────────────── */}
          <Section
            styles={styles}
            title={challan ? "F. Closing / Signatures" : "G. Footer / Signature"}
          >
            <Field
              styles={styles}
              label={challan ? "Material receipt acknowledgement" : "Certification"}
              hint={
                challan
                  ? "The line above the two signature blocks, e.g. 'Received above material in good & condition'."
                  : "The sentence above the two signature blocks."
              }
              value={values.certification ?? ""}
              onChange={(v) => setField("certification", v)}
              multiline
            />
            <Field
              styles={styles}
              label="For, <company>"
              value={values.on_behalf_of ?? ""}
              onChange={(v) => setField("on_behalf_of", v)}
            />
            <Field
              styles={styles}
              label="Authorised signatory designation"
              value={values.signature_designation ?? ""}
              onChange={(v) => setField("signature_designation", v)}
            />
            <Field
              styles={styles}
              label="Receiver's signature label"
              value={values.receiver_signature ?? ""}
              onChange={(v) => setField("receiver_signature", v)}
            />
            <Field
              styles={styles}
              label="Extra notes"
              hint="Anything else printed on the invoice."
              value={values.notes_extra ?? ""}
              onChange={(v) => setField("notes_extra", v)}
              multiline
            />
            {!challan && (
              <Field
                styles={styles}
                label="Job type"
                hint="How this bill is grouped with the jobs it is linked to."
                value={values.job_kind ?? ""}
                onChange={(v) => setField("job_kind", v)}
              />
            )}
          </Section>

          {/* ── G/H. Job Assignment ─────────────────────────── */}
          <Section styles={styles} title={challan ? "G. Job Assignment" : "H. Job Assignment"}>
            {connections.length === 0 ? (
              <Text style={styles.note}>
                No jobs linked yet. Linking is optional — a bill does not need a job — and a
                copy does not inherit the source bill&apos;s links.
              </Text>
            ) : (
              connections.map((connection) => (
                <View key={connection.job_id} style={styles.connRow}>
                  <View style={styles.flex}>
                    <Text style={styles.connTitle}>
                      {connection.job_no ?? connection.job_id.slice(0, 8)}
                    </Text>
                    <Text style={styles.note}>
                      {connection.job_type === "labour" ? "Labour" : "With Material"}
                      {connection.job_given_date
                        ? ` · ${formatBillDate(connection.job_given_date)}`
                        : ""}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => void unlinkJob(connection.job_id)}
                    accessibilityRole="button"
                    accessibilityLabel="Unlink this job"
                  >
                    <Text style={styles.unlink}>Unlink</Text>
                  </Pressable>
                </View>
              ))
            )}
            {/* Two buttons rather than one, so the sheet opens on the tab the admin meant.
                They are the same sheet and the same RPCs — one door each, not two ways of
                linking. */}
            <View style={styles.row}>
              <SmallBtn
                styles={styles}
                disabled={!billId || !isAdmin}
                onPress={() => {
                  setJobsTab("labour");
                  setJobsModalOpen(true);
                }}
              >
                Link Labour Jobs
              </SmallBtn>
              <SmallBtn
                styles={styles}
                disabled={!billId || !isAdmin}
                onPress={() => {
                  setJobsTab("with_material");
                  setJobsModalOpen(true);
                }}
              >
                Link With Material Jobs
              </SmallBtn>
            </View>
            <Text style={styles.note}>
              {!billId
                ? "Saved as a draft first — jobs are linked to the bill, so there has to be one."
                : "Linking is optional and uses the same connections the Bills list already shows, so a bill created here and a bill imported from Excel are linked the same way."}
            </Text>
          </Section>

          {/* ── H/I. Logo ───────────────────────────────────── */}
          <Section styles={styles} title={challan ? "H. Challan Logo" : "I. Invoice Logo"}>
            <View style={styles.row}>
              <SmallBtn
                styles={styles}
                disabled={!isAdmin}
                onPress={() => setLogoPickerOpen(true)}
              >
                {logoId ? "Change logo" : "Choose logo"}
              </SmallBtn>
              {logoId !== undefined && logoId !== null && (
                <SmallBtn styles={styles} onPress={() => setLogoId(null)}>
                  No logo
                </SmallBtn>
              )}
            </View>
            <Text style={styles.note}>
              {logoId === null
                ? "No logo — the invoice prints without one."
                : logoId
                  ? `“${logos.find((logo) => logo.id === logoId)?.name ?? "chosen logo"}”`
                  : "No logo chosen yet."}{" "}
              Chosen from the Logo Library. A logo is stored once and referenced by every
              bill that uses it, so renaming it changes all of them — which is why this is a
              selection rather than an upload.
            </Text>
          </Section>

          {/* ── I/J. Folder & Preview ───────────────────────── */}
          <Section
            styles={styles}
            title={challan ? "I. Folder, Preview & Generate" : "J. Folder, Preview & Generate"}
            description="Nothing is generated until you choose to. A draft can be left and finished later."
          >
            <Field
              styles={styles}
              label="Billing folder"
              hint="Where this bill is filed once it exists."
              value={
                folders.find((folder) => folder.id === folderId)?.name ?? ""
              }
              onChange={(name) => {
                const found = folders.find((folder) => folder.name === name);
                setFolderId(found?.id ?? null);
              }}
              placeholder="No folder"
            />
            <Pressable
              style={styles.ghostBtn}
              onPress={() => setFolderPickerOpen(true)}
              accessibilityRole="button"
            >
              <Text style={styles.ghostBtnText}>New billing folder…</Text>
            </Pressable>
            <CalcRow
              styles={styles}
              label="Copy designation"
              value="Original / Duplicate / Triplicate"
            />
            <Text style={styles.note}>
              {challan
                ? "All three copies print with the challan's own customer, material table, total quantity and signatures. The only difference is the designation in the corner."
                : "All three copies print with the bill's own customer, totals, bank, terms and signature. The only difference is the designation in the corner."}
            </Text>
            <Pressable
              style={styles.ghostBtn}
              onPress={() => void preview()}
              disabled={busy !== null}
              accessibilityRole="button"
            >
              <Text style={styles.ghostBtnText}>
                {busy === "preview" ? "Preparing preview…" : "Preview PDF"}
              </Text>
            </Pressable>
            <Text style={styles.note}>
              Preview saves the draft and renders it through the same renderer that produces
              the final documents. It writes nothing to storage and changes no state.
            </Text>
          </Section>

          {duplicates.length > 0 && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>
                That {documentNoun} number is already used
              </Text>
              <Text style={styles.note}>
                Your draft is saved and nothing has been generated. These {documentNoun}s
                already use this {documentNoun} number:
              </Text>
              {duplicates.map((duplicate) => (
                <Text key={duplicate.bill_id} style={styles.note}>
                  • {duplicate.invoice_no} — {duplicate.party_name ?? "no customer named"} ·{" "}
                  {formatBillDate(duplicate.invoice_date)}
                </Text>
              ))}
              <Text style={styles.note}>
                Generating anyway creates a second {documentNoun} with the same number.
                Neither is overwritten and neither is marked as the wrong one — which is why
                this is your choice and not a default.
              </Text>
              <View style={styles.row}>
                <SmallBtn styles={styles} onPress={() => setDuplicates([])}>
                  Keep editing
                </SmallBtn>
                <SmallBtn styles={styles} danger onPress={() => void finalize(true)}>
                  Generate anyway
                </SmallBtn>
              </View>
            </View>
          )}
        </ScrollView>

        {/* ── The action bar ────────────────────────────────
            Always on screen, always the same order, so muscle memory survives a long
            session: save, preview, generate. On a phone this is the difference between
            reaching the Generate button and scrolling to find it. */}
        <View style={styles.footer}>
          <View style={styles.footerTop}>
            <Text style={styles.footerTotal}>
              {challan
                ? `Total quantity ${serverTotals?.total_quantity ?? lineTotals.totalQuantity ?? "—"}`
                : formatMoney(serverTotals?.amount_after_tax ?? lineTotals.amountBeforeTax)}
            </Text>
            <Text style={styles.footerSaved}>
              {queueState.status === "saving"
                ? "Saving…"
                : queueState.status === "pending"
                  ? "Unsaved changes"
                  : queueState.status === "error"
                    ? "Couldn't save"
                    : queueState.status === "saved" && queueState.savedAt
                      ? `Saved at ${new Date(queueState.savedAt).toLocaleTimeString()}`
                      : "Changes save automatically"}
            </Text>
          </View>
          {queueState.status === "error" && (
            <Pressable
              onPress={() => void queueRef.current?.flush()}
              accessibilityRole="button"
              accessibilityLabel="Retry saving the draft"
              style={({ pressed }) => [styles.retrySave, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.retrySaveText}>{"Couldn't save — Retry"}</Text>
            </Pressable>
          )}
          <View style={styles.row}>
            <SmallBtn styles={styles} disabled={busy !== null} onPress={requestExit}>
              Save &amp; exit
            </SmallBtn>
            <SmallBtn
              styles={styles}
              disabled={busy !== null || !isAdmin}
              onPress={() => void saveDraft()}
            >
              Save Draft
            </SmallBtn>
            <SmallBtn
              styles={styles}
              disabled={busy !== null || !isAdmin}
              onPress={() => void preview()}
            >
              Preview PDF
            </SmallBtn>
            <Pressable
              style={[styles.primaryBtn, (busy !== null || !isAdmin) && styles.btnOff]}
              onPress={() => void finalize(false)}
              disabled={busy !== null || !isAdmin}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>
                {busy === "finalize"
                  ? "Generating…"
                  : challan
                    ? "Generate Challan"
                    : "Generate Invoice"}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.footerNote}>
            Generating writes three PDFs and makes the {documentNoun} final. It cannot be
            undone.
          </Text>
        </View>
      </KeyboardAvoidingView>

      {/* ── Dialogs ─────────────────────────────────────────── */}

      <LogoPickerModal
        visible={logoPickerOpen}
        onClose={() => setLogoPickerOpen(false)}
        onSelect={(chosen) => {
          setLogoId(chosen);
          setLogoPickerOpen(false);
        }}
        currentLogoId={logoId ?? null}
      />

      <LinkBillToJobsSheet
        visible={jobsModalOpen}
        billId={billId ?? ""}                billLabel={values.invoice_no || values.party_name || `this ${documentNoun}`}
        initialTab={jobsTab}
        onClose={() => setJobsModalOpen(false)}
      />

      {folderPickerOpen && (
        <FolderSheet
          styles={styles}
          value={newFolderName}
          onChange={setNewFolderName}
          onClose={() => setFolderPickerOpen(false)}
          onCreate={() => void createFolder()}
        />
      )}

      {/* Leaving with unsaved work. Save & Exit is the primary action and the only one
          that leaves after a confirmed write; a failure keeps this screen open. */}
      <Modal
        visible={exitOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setExitOpen(false)}
      >
        <View style={styles.exitBackdrop}>
          <View style={styles.exitCard} accessibilityViewIsModal>
            <Text style={styles.exitTitle}>Leave this draft?</Text>
            <Text style={styles.note}>
              The draft saves automatically until you generate it. Save &amp; exit writes the
              latest changes first; Leave draft discards anything since the last save.
            </Text>
            <Pressable
              onPress={() => void saveAndExit()}
              disabled={exitBusy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryBtn,
                exitBusy && styles.btnOff,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.primaryBtnText}>
                {exitBusy
                  ? "Saving…"
                  : exitTarget === "entry"
                    ? "Save & go back"
                    : "Save & exit"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setExitOpen(false)}
              disabled={exitBusy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.ghostBtnText}>Stay editing</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void leaveDraft();
              }}
              disabled={exitBusy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.ghostBtnText}>Leave draft</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Generation takes a server-side claim and renders three PDFs. Editing during it
          would either be lost or arrive after the document was finalized, so the form is
          covered until the request settles. */}
      {busy === "finalize" && (
        <View style={styles.generatingOverlay} pointerEvents="auto">
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.note}>Generating the three copies…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ──────────────────────────────────────────────
   Small pieces
   ────────────────────────────────────────────── */

function EntryChoice({
  styles,
  title,
  body,
  onPress,
  disabled,
}: {
  styles: Styles;
  title: string;
  body: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.entryChoice, disabled && styles.btnOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={styles.entryChoiceTitle}>{title}</Text>
      <Text style={styles.note}>{body}</Text>
    </Pressable>
  );
}

function Section({
  styles,
  title,
  description,
  children,
}: {
  styles: Styles;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {description ? <Text style={styles.note}>{description}</Text> : null}
      {children}
    </View>
  );
}

function Field({
  styles,
  label,
  value,
  onChange,
  hint,
  placeholder,
  multiline,
  keyboard,
  highlight,
}: {
  styles: Styles;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string | null;
  placeholder?: string;
  multiline?: boolean;
  keyboard?: "default" | "decimal-pad" | "number-pad";
  highlight?: boolean;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {/* Highlight, not clearing. A copied field that an admin has to remember to change
            is a copied field that will be wrong; one that is ringed and labelled is one
            they fix. This is why `isLikelyToChange` exists. */}
        {highlight ? <Text style={styles.checkFlag}>CHECK THIS</Text> : null}
      </View>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          highlight && styles.inputHighlight,
        ]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={styles.inputPlaceholder.color}
        multiline={multiline}
        keyboardType={keyboard ?? "default"}
        autoCorrect={false}
      />
      {hint ? <Text style={styles.errorText}>{hint}</Text> : null}
    </View>
  );
}

function DateField(props: {
  styles: Styles;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string | null;
  highlight?: boolean;
}) {
  return <Field {...props} placeholder="YYYY-MM-DD" />;
}

function CalcRow({
  styles,
  label,
  value,
  strong,
}: {
  styles: Styles;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={[styles.calcRow, strong && styles.calcRowStrong]}>
      <Text style={styles.calcLabel}>{label}</Text>
      <Text style={styles.calcValue}>{value}</Text>
    </View>
  );
}

function SmallBtn({
  styles,
  onPress,
  disabled,
  danger,
  children,
}: {
  styles: Styles;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      style={[
        styles.smallBtn,
        danger && styles.smallBtnDanger,
        disabled && styles.btnOff,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text
        style={[
          styles.smallBtnText,
          danger && styles.smallBtnTextDanger,
          disabled && styles.smallBtnTextOff,
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

function TinyBtn({
  styles,
  label,
  onPress,
  disabled,
  children,
}: {
  styles: Styles;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      style={[styles.tinyBtn, disabled && styles.btnOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.tinyBtnText}>{children}</Text>
    </Pressable>
  );
}

function FolderSheet({
  styles,
  value,
  onChange,
  onClose,
  onCreate,
}: {
  styles: Styles;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <View style={styles.sheetWrap}>
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>New billing folder</Text>
        <Text style={styles.note}>Created and selected in one step.</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder="October 2026 — Zaveri"
          placeholderTextColor={styles.inputPlaceholder.color}
          autoCorrect={false}
        />
        <Text style={styles.note}>
          Folders are the same ones the Folders section already uses — a billing folder holds
          bills, not jobs, and this bill joins it like any other.
        </Text>
        <View style={styles.row}>
          <Pressable style={styles.ghostBtn} onPress={onClose} accessibilityRole="button">
            <Text style={styles.ghostBtnText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, value.trim() === "" && styles.btnOff]}
            onPress={onCreate}
            disabled={value.trim() === ""}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>Create</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** A server-named column, spelled the way the section header above it is. */
function fieldLabel(field: string, challan = false): string {
  const known: Record<string, string> = {
    invoice_no: challan ? "Challan number" : "Invoice number",
    invoice_date: challan ? "Challan date" : "Invoice date",
    party_name: "Customer",
    party_gst_no: challan ? "Party GST number" : "Customer GST number",
    line_items: "Line items",
    amount_in_words: "Amount in words",
    cgst_rate: "CGST rate",
    sgst_rate: "SGST rate",
    igst_rate: "IGST rate",
  };
  return known[field] ?? field.replace(/_/g, " ");
}

function createStyles(theme: AppTheme) {
  const c = theme.colors;
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: c.background },
    body: { padding: theme.spacing.md, paddingBottom: theme.spacing.xl, gap: theme.spacing.sm },
    centred: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    entryBody: { padding: theme.spacing.md, gap: theme.spacing.sm },
    back: { color: c.primary, fontSize: theme.textSizes.sm, fontWeight: "600" },
    entryTitle: {
      color: c.text,
      fontSize: theme.textSizes.xl,
      fontWeight: "800",
      marginTop: theme.spacing.sm,
    },
    entrySub: { color: c.textSecondary, fontSize: theme.textSizes.sm, lineHeight: 20 },
    entryChoice: {
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      gap: 4,
      marginTop: theme.spacing.xs,
    },
    entryChoiceTitle: {
      color: c.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "800",
    },
    entryAbsent: {
      backgroundColor: c.surfaceSecondary,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      gap: 4,
      marginTop: theme.spacing.xs,
    },
    entryAbsentTitle: { color: c.textSecondary, fontSize: theme.textSizes.sm, fontWeight: "700" },
    pageTitle: {
      color: c.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "800",
      marginTop: theme.spacing.xs,
    },
    pageSub: { color: c.textSecondary, fontSize: theme.textSizes.sm, marginBottom: 4 },
    section: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    sectionTitle: {
      color: c.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 1,
    },
    field: { gap: 4 },
    labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    label: { color: c.textSecondary, fontSize: theme.textSizes.xs, fontWeight: "700" },
    checkFlag: {
      color: c.warning,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    input: {
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 9,
      color: c.text,
      fontSize: theme.textSizes.sm,
    },
    inputMultiline: { minHeight: 64, textAlignVertical: "top" },
    inputHighlight: { borderColor: c.warning, borderWidth: 2 },
    /* Not a style the UI reads — a carrier for the placeholder colour so the primitive
       above does not need the theme threaded through every call site. */
    /* A real style carrying the placeholder colour, the way `BillEditScreen` does it.
       Smuggling a bare string into `StyleSheet.create` makes its return type widen to the
       union of every style kind, and every `style={styles.x}` in the file then fails to
       check — one wrong key costing a page of errors. */
    inputPlaceholder: { color: c.textMuted },
    note: { color: c.textMuted, fontSize: theme.textSizes.xs, lineHeight: 16 },
    errorText: { color: c.danger, fontSize: theme.textSizes.xs },
    errorBox: {
      backgroundColor: c.surfaceSecondary,
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      gap: 4,
      marginTop: theme.spacing.xs,
    },
    errorTitle: { color: c.danger, fontSize: theme.textSizes.sm, fontWeight: "800" },
    row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs, flexWrap: "wrap" },
    lineCard: {
      backgroundColor: c.surfaceSecondary,
      borderRadius: theme.radius.md,
      padding: theme.spacing.sm,
      gap: theme.spacing.xs,
      marginTop: theme.spacing.xs,
    },
    lineHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    lineHeadText: {
      color: c.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "800",
      letterSpacing: 0.5,
    },
    calcRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 6,
      paddingHorizontal: theme.spacing.sm,
      backgroundColor: c.surfaceSecondary,
      borderRadius: theme.radius.sm,
    },
    calcRowStrong: { backgroundColor: c.primaryMuted },
    calcLabel: { color: c.textSecondary, fontSize: theme.textSizes.xs, fontWeight: "700" },
    calcValue: { color: c.text, fontSize: theme.textSizes.sm, fontWeight: "800" },
    checkRow: { flexDirection: "row", gap: theme.spacing.sm, alignItems: "flex-start" },
    box: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: c.primary, borderColor: c.primary },
    boxTick: { color: c.primaryButtonText, fontSize: 13, fontWeight: "900" },
    checkLabel: { color: c.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    connRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    connTitle: { color: c.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    unlink: { color: c.danger, fontSize: theme.textSizes.xs, fontWeight: "800" },
    smallBtn: {
      backgroundColor: c.primaryMuted,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    smallBtnDanger: { backgroundColor: c.danger + "22" },
    smallBtnText: { color: c.primary, fontSize: theme.textSizes.xs, fontWeight: "800" },
    smallBtnTextDanger: { color: c.danger },
    smallBtnTextOff: { color: c.textMuted },
    tinyBtn: {
      width: 30,
      height: 30,
      borderRadius: theme.radius.sm,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    tinyBtnText: { color: c.textSecondary, fontSize: theme.textSizes.sm, fontWeight: "800" },
    ghostBtn: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: theme.radius.sm,
      paddingVertical: 10,
      alignItems: "center",
      marginTop: theme.spacing.xs,
    },
    ghostBtnText: { color: c.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    btnOff: { opacity: 0.4 },
    primaryBtn: {
      backgroundColor: c.primary,
      borderRadius: theme.radius.sm,
      paddingVertical: 11,
      paddingHorizontal: theme.spacing.md,
    },
    primaryBtnText: {
      color: c.primaryButtonText,
      fontSize: theme.textSizes.sm,
      fontWeight: "800",
    },
    footer: {
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
      padding: theme.spacing.sm,
      gap: 6,
    },
    footerTop: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
    },
    footerTotal: { color: c.text, fontSize: theme.textSizes.md, fontWeight: "800" },
    footerSaved: { color: c.textMuted, fontSize: theme.textSizes.xs },
    retrySave: {
      alignSelf: "flex-start",
      paddingVertical: 4,
      marginBottom: 4,
    },
    retrySaveText: {
      color: c.danger,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
    },
    exitBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
      padding: theme.spacing.lg,
    },
    generatingOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(255,255,255,0.72)",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    exitCard: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: c.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    exitTitle: {
      color: c.text,
      fontSize: theme.textSizes.md,
      fontWeight: "800",
    },
    footerNote: { color: c.textMuted, fontSize: 10 },
    /* RN's own name for it is `absoluteFill`; the web-flavoured `absoluteFillObject` is
       not on the types in SDK 57. */
    sheetWrap: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      backgroundColor: "#00000099",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    sheetTitle: { color: c.text, fontSize: theme.textSizes.md, fontWeight: "800" },
  });
}