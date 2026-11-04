// src/pages/CreateBill.tsx
//
// THE BILL CREATOR.
//
// A bill is a `bills` row. This page writes one row, through one edge function, through
// the same `computeBillValues` the bill editor uses, and gets three PDFs out of the one
// renderer the Excel path uses. There is no second invoice model, no second PDF layout and
// no second set of tax rules anywhere in this file — the arithmetic is not here either.
// This file draws eleven sections and sends what was typed.
//
// WHAT THE SERVER DECIDES, AND WHY IT IS NOT HERE
//
// Every number on a financial document is decided by `create-bill` from the saved row, and
// this page displays those numbers rather than computing them. The one exception is the
// line-item amount column, which is `quantity x rate` in front of the admin's eyes and is
// recomputed by the server anyway. If this page kept its own tax arithmetic there would
// be two answers to "what does this invoice total?", and the admin would find out which
// one they were looking at by filing the wrong invoice.
//
// THE ENTRY SCREEN IS NOT A SEPARATE FEATURE
//
// Three buttons, one of which starts nothing new. "Create New Bill" and "New Bill +
// Profile" both create the same canonical bill and differ only in whether the Business
// Profile's own details are preloaded; "Copy Existing Bill" additionally copies a chosen
// bill's stored data. Once past the screen the code below does not know which button was
// pressed — which is what keeps the three modes from becoming three implementations.
//
// THE MODE LIVES IN THE URL
//
// `?mode=empty`, `?mode=profile`, `?copy=<bill id>`. A draft that is resumable across a
// refresh needs its mode to survive a refresh too, and the query string is the only place
// that happens without inventing a store. It also makes "Save Draft, leave, come back"
// a link rather than a feature.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Copy,
  Eye,
  FilePlus2,
  FolderPlus,
  Info,
  Loader2,
  Plus,
  Save,
  Trash2,
  Unlink,
  UserRound,
} from "lucide-react";

import { usePageMeta } from "../hooks/usePageMeta";
import { useToast } from "../hooks/useToast";
import Modal from "../components/ui/Modal";
import {
  Calculated,
  Field,
  NumberInput,
  SectionCard,
  TextArea,
  TextInput,
  inputCls,
  labelCls,
} from "../components/bills/BillEditFields";
import BillSourcePicker from "../components/bills/BillSourcePicker";
import LogoPickerModal from "../components/bills/LogoPickerModal";
import LinkBillsToJobsModal from "../components/bills/LinkBillsToJobsModal";
import {
  createBillingFolder,
  fetchBillingFolders,
  type BillingFolder,
} from "../services/billingFolders";
import { fetchInvoiceLogos } from "../services/invoiceLogos";
import { fetchInvoiceBusinessProfile } from "../services/invoiceBusinessProfile";
import { getBillConnections, unlinkJobsFromBill } from "../services/billJobConnections";
import { fetchBill, fetchBillFolderId, fetchBillLineItems, fetchBills } from "../services/bills";
import {
  completeDraftSession,
  draftKeyForSession,
  draftSessionFromSearch,
  newDraftKey,
} from "../services/draftLifecycle";
import {
  createSaveQueue,
  type SaveOutcome,
  type SaveQueue,
  type SaveQueueState,
} from "../services/saveQueue";
import { DOCUMENT_TYPE_INFO, type BillDocumentType } from "../services/billDocumentTypes";
import { formatBillDate, formatMoney } from "../services/billFormat";
import {
  CreatorError,
  finalizeCreatorDraft,
  openCreatorPreview,
  previewCreatorDraft,
  saveCreatorDraft,
  type CreatorDraftRef,
  type CreatorDuplicate,
  type CreatorSaveResult,
} from "../services/billCreator";
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
} from "../services/creatorForm";
import type { InvoiceLogo } from "../types/invoiceLogo";
import type { JobType } from "../types/job";
import type { BillJobConnection } from "../types/billJobConnections";

/* ──────────────────────────────────────────────
   The form's three modes
   ────────────────────────────────────────────── */

type Mode = "empty" | "profile" | "copy" | "resume";

/**
 * Read the mode out of the query string.
 *
 * `null` means "no mode yet" and is what puts the entry screen up — the page is reached
 * from the sidebar, so arriving with no query is the normal case and is not an error.
 *
 * `copy` carries a bill id and takes priority, because `?copy=X&mode=profile` is a real
 * combination: copying a bill but preloading the current profile over it is exactly the
 * `[x] Use current Invoice Business Profile` box, and a link that could express it is a
 * link somebody will paste into chat.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readMode(params: URLSearchParams): { mode: Mode | null; sourceBillId: string | null } {
  /* Resuming a saved draft. The bill id IS the identity here: there is nothing to
     create, so there is no idempotency key, and every save updates that row. Checked
     before `copy` so an old hand-edited URL cannot turn a resume into a new copy. */
  const draft = (params.get("draft") ?? "").trim();
  if (draft !== "" && UUID_RE.test(draft)) {
    return { mode: "resume", sourceBillId: draft };
  }
  const copy = (params.get("copy") ?? "").trim();
  // `copy=pick` is the picker sentinel, not a bill id.
  if (copy !== "" && copy !== "pick" && UUID_RE.test(copy)) {
    return { mode: "copy", sourceBillId: copy };
  }
  const raw = (params.get("mode") ?? "").trim();
  if (raw === "") return { mode: null, sourceBillId: null };
  return { mode: raw === "profile" ? "profile" : "empty", sourceBillId: null };
}

/** How long typing settles before the draft is saved. */
const AUTOSAVE_MS = 1200;

/* ──────────────────────────────────────────────
   A highlighted field on a copy
   ────────────────────────────────────────────── */

/**
 * One field, marked when a copy's admin is likely to need to change it.
 *
 * The value is KEPT and the box is outlined. Clearing instead would turn "review this
 * copy" into "rebuild this copy", and every field the admin did not refill would silently
 * revert to blank — which on an invoice means the customer, the address and the tax
 * treatment disappear. A highlighted field left alone is a correct bill; a cleared field
 * left alone is a broken one.
 *
 * The marker is a border and a word, never a colour alone: it has to be legible to
 * somebody who cannot tell the warning colour from the primary colour, and it has to be
 * visible at a glance in a long form.
 */
function ReviewField({
  label,
  hint,
  wide,
  highlight = false,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <div className="flex items-baseline gap-2">
        <span className={labelCls}>{label}</span>
        {highlight && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-warning">
            <AlertTriangle size={11} />
            check this
          </span>
        )}
      </div>
      <div
        className={
          highlight
            ? "rounded-lg ring-2 ring-warning/70 ring-offset-2 ring-offset-[var(--color-surface)]"
            : undefined
        }
      >
        {children}
      </div>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

/* ──────────────────────────────────────────────
   The page: which mode, and the entry screen
   ────────────────────────────────────────────── */

export default function CreateBillPage({ documentType = "tax_invoice" }: { documentType?: BillDocumentType }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, sourceBillId } = useMemo(() => readMode(params), [params]);
  const info = DOCUMENT_TYPE_INFO[documentType];
  const challan = documentType === "delivery_challan";

  /**
   * This creation intent's id.
   *
   * Minted once when the route is first opened, then written into the URL so a refresh
   * resumes the SAME intent. Two separate "Create Bill" clicks mount this page twice
   * and therefore get two ids, which is what stops the second from reusing the first's
   * idempotency key. A resumed draft does not need one. The initial value is read from
   * the URL so a refresh reuses the stored key instead of minting a new one.
   */
  const [sessionId] = useState(
    () => draftSessionFromSearch(location.search) ?? newDraftKey()
  );

  useEffect(() => {
    if (mode === null || mode === "resume") return;
    if (draftSessionFromSearch(location.search)) return;
    const next = new URLSearchParams(location.search);
    next.set("session", sessionId);
    setParams(next, { replace: true });
  }, [mode, location.search, sessionId, setParams]);

  /* `copy=pick` is not a mode — it means the picker is open. It lives in the URL so that a
     refresh reopens the dialog rather than silently becoming a blank new bill, which is
     the failure mode of putting transient dialog state in component state. */
  const [anyBillExists, setAnyBillExists] = useState(false);

  useEffect(() => {
    /* Only asked when the entry screen is actually up. One row is enough — this is a
       yes/no, and the total it reports is the same total this page's own list shows, so
       the two cannot disagree about whether anything exists. A failure leaves the button
       hidden rather than showing one that leads to an empty picker: an absent button with
       a line of explanation is a better answer than a button that goes nowhere. */
    if (mode !== null) return;
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
  }, [mode, documentType]);

  if (mode !== null) {
    /* The key is the whole trick, and it is not a performance flourish. Changing mode has
       to produce a genuinely different document, and the honest way to guarantee that is to
       throw the old form away and build a new one — rather than to reset a dozen pieces of
       state inside an effect and hope the list was complete. It also means no state can
       leak from a half-typed copy into the next new bill. */
    return (
      <CreatorForm
        key={`${documentType}:${mode}:${sourceBillId ?? ""}:${sessionId}`}
        mode={mode}
        sourceBillId={sourceBillId}
        sessionId={sessionId}
        documentType={documentType}
      />
    );
  }

  return (
    <div className="max-w-[46rem] mx-auto py-2">
      <div className="panel-flat">
        <header className="px-6 py-5 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text tracking-[-0.01em]">
            How should this {challan ? "challan" : "bill"} start?
          </h2>
          <p className="mt-1 text-[12.5px] text-text-muted leading-relaxed max-w-[38rem]">
            Every option produces the same {info.noun.toLowerCase()}, with the same Original,
            Duplicate and Triplicate PDFs. They differ only in what is filled in when the form
            opens.
          </p>
        </header>
        <div className="p-3 grid gap-1.5">
          <EntryChoice
            icon={<FilePlus2 size={18} />}
            title={challan ? "Create New Challan" : "Create New Bill"}
            body={
              challan
                ? "A blank challan. Fill in the customer, the material rows and the transport details yourself."
                : "A blank bill. Fill in the customer, the line items and the taxes yourself."
            }
            onClick={() => setParams({ mode: "empty" })}
          />
          <EntryChoice
            icon={<UserRound size={18} />}
            title={challan ? "New Challan + Profile" : "New Bill + Profile"}
            body={
              challan
                ? "The same blank challan, with your Invoice Business Profile preloaded — company details, address, contacts and signature wording. No bank or payment terms."
                : "The same blank bill, with your Invoice Business Profile preloaded — company details, bank block, terms and footer wording."
            }
            onClick={() => setParams({ mode: "profile" })}
          />
          {anyBillExists ? (
            <EntryChoice
              icon={<Copy size={18} />}
              title={challan ? "Copy Existing Challan" : "Copy Existing Bill"}
              body={
                challan
                  ? "Start from a challan that already exists. Only Delivery Challans are listed; the original is never changed."
                  : "Start from a bill that already exists. Its data is copied; the original is never changed."
              }
              onClick={() => setParams({ copy: "pick" })}
            />
          ) : (
            /* Absent, not disabled. With nothing to copy there is no decision to make, and
               a greyed-out button invites the question "why is that grey?" — which the
               answer "because there are no bills yet" does not help with. */
            <p className="flex items-start gap-2.5 px-4 py-3 rounded-lg border border-dashed border-border text-[12px] text-text-muted">
              <Info size={14} className="shrink-0 mt-0.5" />
              <span>
                <strong className="font-semibold text-text-secondary">
                  Copy an existing {challan ? "challan" : "bill"}
                </strong>{" "}
                appears once there is one to copy. Upload a workbook under {info.section}, or
                create the first one here.
              </span>
            </p>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={() => navigate(info.route)}
            className="btn btn-ghost btn-sm"
          >
            <ArrowLeft size={14} />
            Back to {info.section}
          </button>
        </div>
      </div>

      <BillSourcePicker
        open={params.get("copy") === "pick"}
        documentType={documentType}
        onClose={() => setParams({})}
        onConfirm={(chosenId) => setParams({ copy: chosenId })}
      />
    </div>
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
}: {
  mode: "empty" | "profile" | "copy" | "resume";
  sourceBillId: string | null;
  sessionId: string;
  documentType: BillDocumentType;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const info = DOCUMENT_TYPE_INFO[documentType];
  const challan = documentType === "delivery_challan";

  /* ── Loading ─────────────────────────────────────────────── */

  /* Starts true and is only ever set from inside a promise, so there is no effect that
     resets it — the component is mounted fresh per mode by the key above. */
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* ── The form ────────────────────────────────────────────── */

  const [values, setValues] = useState<CreatorFormValues>({});
  const [lines, setLines] = useState<CreatorLineDraft[]>([]);
  const [bank, setBankState] = useState<BankDetails>({});
  const [amountInWords, setAmountInWordsState] = useState("");
  /** Whether the admin has touched the words. Decides whether they ride along in the patch. */
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
     change and a Generate click can land before the next render. These refs are updated
     by every mutation helper (and re-synced after each render as a safety net), so
     `buildRequest` always sends the value the admin last typed. */
  const valuesRef = useRef(values);
  const linesRef = useRef(lines);
  const bankRef = useRef(bank);
  const amountInWordsRef = useRef(amountInWords);
  const wordsTouchedRef = useRef(wordsTouched);
  const roundOffRef = useRef(roundOff);
  const reverseChargeRef = useRef(reverseChargeGst);
  const billIdRef = useRef<string | null>(null);
  const logoIdRef = useRef(logoId);
  const folderIdRef = useRef(folderId);
  const jobIdsRef = useRef(jobIds);
  const useCurrentProfileRef = useRef(useCurrentProfile);
  const queueRef = useRef<SaveQueue | null>(null);

  /** Report an edit to the save queue. Refs are updated first, so a Generate in the
      same event still sends the typed value. */
  const markChanged = useCallback(() => {
    queueRef.current?.change();
  }, []);

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

  /* Safety net, not the primary path: the setters above already update their refs. It
     deliberately does not call `change()`, because seeding a form is not an edit. */
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

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [problems, setProblems] = useState<{ field: string; message: string }[]>([]);
  /* The server's own duplicate list, kept as its type rather than narrowed. Its shape is
     the one thing this form must not paraphrase: it is shown to somebody deciding whether
     to reuse an invoice number, and a re-spelled `invoice_no` that became a bare string
     would render an actual NULL as the word "null". */
  const [duplicates, setDuplicates] = useState<CreatorDuplicate[]>([]);
  const [busy, setBusy] = useState<null | "preview" | "finalize">(null);
  /* A synchronous guard, because `busy` only becomes true after React re-renders. Two
     clicks in the same frame would otherwise start two finalizes. */
  const inFlightRef = useRef(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [jobsModalOpen, setJobsModalOpen] = useState(false);
  /** Which tab the jobs dialog opens on. Set by the button that opened it. */
  const [jobsTab, setJobsTab] = useState<JobType>("labour");
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  /* ── Reference data ──────────────────────────────────────── */

  const [folders, setFolders] = useState<BillingFolder[]>([]);
  const [logos, setLogos] = useState<InvoiceLogo[]>([]);
  const [profilePaymentDays, setProfilePaymentDays] = useState<number | null>(null);
  const [profileCompanyName, setProfileCompanyName] = useState<string | null>(null);

  const isCopy = mode === "copy";
  const isResume = mode === "resume";
  /* No key when resuming: the bill id is the identity, and sending a fresh token would
     ask the server to create a second row beside the draft being edited. */
  const draftKey = useMemo(
    () =>
      isResume
        ? ""
        : draftKeyForSession(
            sessionId,
            documentType,
            typeof window === "undefined" ? null : window.sessionStorage
          ),
    [isResume, sessionId, documentType]
  );
  const documentNoun = challan ? "challan" : "bill";

  usePageMeta({
    title: challan ? "Create Challan" : "Create Bill",
    crumbs: [
      { label: info.section, to: info.route },
      { label: `Create ${info.noun}` },
    ],
    subtitle: isCopy
      ? `A new draft from an existing ${documentNoun}. The original is not changed.`
      : `A new ${documentNoun}, saved as a draft until you generate it.`,
  });

  /* ── Loading the form's starting state ───────────────────── */

  const applySeed = useCallback((seed: CreatorSeed) => {
    /* The seed keeps `terms` as its own three-tuple rather than inside `values`, because
       on the server they are not three columns — they are one `terms` array, and
       `termsToPatch` is what decides whether a bill that has all three blank should have
       its stored terms left alone or cleared. Flattening them into `values` here is only
       safe because the network layer reads them back out of `values` and re-joins them
       through that same function, so the decision is still made in one place.

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

  /* `mode` and `sourceBillId` never change for the life of this component — the parent
     remounts it under a new key instead — so this runs exactly once, and every setState
     in it happens after an `await`, i.e. off the render path. There is deliberately no
     "reset everything" preamble: the state this would reset was created fresh, and a
     reset list that has to be maintained is a list that will eventually be wrong. */
  useEffect(() => {
    let live = true;

    (async () => {
      try {
        if (mode === "copy" && sourceBillId) {
          if (!UUID_RE.test(sourceBillId)) {
            setLoadError("The selected bill reference is invalid. Return to the picker and choose a bill again.");
            setLoading(false);
            return;
          }
          /* The SOURCE is read as data - its columns and its line items. Its PDF is
             never opened, downloaded or parsed: re-deriving a bill from a printed
             document would produce a second parser whose disagreements are invisible. */
          const [bill, items, profile] = await Promise.all([
            fetchBill(sourceBillId, documentType),
            fetchBillLineItems(sourceBillId),
            fetchInvoiceBusinessProfile(),
          ]);
          if (!live) return;

          /* `fetchBill` is already scoped, so this is the in-memory check: a stale link
             or a hand-edited URL must not seed a challan from an invoice (or the
             reverse). The server refuses the same request again on create. */
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

          const seed = seedFromRecord(bill as unknown as Record<string, unknown>, items as unknown as Record<string, unknown>[], "copy");
          applySeed(seed);

          /* A copy inherits NO job links, and that is a decision rather than an oversight: the
             jobs the source was for are a different job, and silently attaching a new
             invoice to them is how a labour job gets billed twice. `setJobIds([])` and
             `setConnections([])` are still the initial values, so saying them again here
             would be the reset this file was written to avoid. */
          setLogoId(bill.logo_id ?? null);
        } else if (mode === "resume" && sourceBillId) {
          /* Continue editing. Everything the draft already stores is read back: the
             fields, the line items, the logo, the folder and the linked jobs. Nothing
             is created, so a resume can never add a row, and the server's save is an
             update to this same bill id. */
          if (!UUID_RE.test(sourceBillId)) {
            setLoadError("The draft reference is invalid. Return to the list and open it again.");
            setLoading(false);
            return;
          }
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
          /* The database's status is authoritative. A finalized document is edited
             through the bill editor, never through the draft-save path. */
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
          const profile =
            mode === "profile" ? await fetchInvoiceBusinessProfile() : null;
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
     `connections` starts empty, and a bill id never goes back to null in this component
     because the parent remounts it per mode rather than clearing it. A branch that
     assigned the empty array would be clearing state that is already clear — and the day
     somebody added a "detach this draft" action, that branch would have started hiding a
     real bug instead of being harmless. */
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
         items is refused at finalization anyway — so an empty table is a dead end that looks
         like a form. */
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
    (overrides: Partial<Parameters<typeof saveCreatorDraft>[0]> = {}) => ({
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

  /* The server's own figures, replaced wholesale rather than merged: keeping a previous
     CGST while a new save has none would show a tax the invoice is no longer charging. */
  const applyServerTotals = useCallback((result: CreatorDraftRef) => {
    setServerTotals({
      total_quantity: result.total_quantity,
      amount_before_tax: result.amount_before_tax,
      cgst: result.cgst,
      sgst: result.sgst,
      igst: result.igst,
      total_gst: result.total_gst,
      amount_after_tax: result.amount_after_tax,
    });
    setServerWords(result.amount_in_words);
    // When the user has not manually overridden the wording, reflect the
    // server-generated words in the controlled input. This is not an edit, so it writes
    // the ref and the raw setter instead of going through the save queue.
    if (!wordsTouchedRef.current && result.amount_in_words) {
      amountInWordsRef.current = result.amount_in_words;
      setAmountInWordsState(result.amount_in_words);
    }
  }, []);

  /* The queue is created once and reads the CURRENT save through this ref. Capturing
     `save` directly would freeze the first render's form values, which is the bug the
     queue exists to prevent. */
  const lastSaveError = useRef("The draft could not be saved.");
  const saveRef = useRef<(options?: { silent?: boolean }) => Promise<CreatorSaveResult | null>>(
    async () => null
  );

  /* The ONE write path. Autosave, Save Draft, Preview, Generate and Save & Exit all reach
     the server through the queue, which calls this. Nothing else calls `saveCreatorDraft`
     directly, so two writes can never be in flight at once. */
  const performSave = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (loading) return null;
      setSaveState("saving");
      try {
        const result = await saveCreatorDraft(buildRequest());
        setBillId(result.bill_id);
        applyServerTotals(result);
        setSaveState("saved");
        setProblems([]);
        if (!options.silent) toast.success("Draft saved.");
        return result;
      } catch (err) {
        setSaveState("error");
        lastSaveError.current =
          err instanceof Error ? err.message : "The draft could not be saved.";
        if (err instanceof CreatorError) {
          setProblems(err.problems.map((p) => ({ field: p.field, message: p.message })));
          /* Not toasted. A validation failure is shown on the field it belongs to, and a
             toast that says "could not save" above a form that has not visibly changed
             teaches an admin that the form is broken. */
          if (err.problems.length === 0 && !options.silent) toast.error(err.message);
        } else if (!options.silent) {
          toast.error(err instanceof Error ? err.message : "The draft could not be saved.");
        }
        return null;
      }
    },
    [loading, buildRequest, applyServerTotals, toast, setBillId]
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

  /* ── Autosave ────────────────────────────────────────────── */

  /* The queue owns the debounce and the ordering. Every mutation helper calls
     `markChanged()`, so there is no render-driven effect that could report a seeded form
     as an edit. */

  /* Browser-level protection for refresh, tab close and an accidental navigation that
     leaves the page. It is registered for the life of the form and asks only while the
     queue still holds an unsaved version; a fully saved draft closes without a prompt. */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!queueRef.current?.isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /* ── Leaving with unsaved work ───────────────────────────── */

  const [exitOpen, setExitOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);

  const leave = useCallback(() => {
    navigate(info.route);
  }, [navigate, info.route]);

  const requestExit = useCallback(() => {
    const queue = queueRef.current;
    if (queue && (queue.isDirty() || queue.state().status === "error")) {
      setExitOpen(true);
      return;
    }
    leave();
  }, [leave]);

  const saveAndExit = useCallback(async () => {
    setExitBusy(true);
    const saved = (await queueRef.current?.flush()) === true;
    setExitBusy(false);
    if (!saved) {
      /* Stay here. Navigating away from a failed save is the exact outcome the exit
         prompt exists to prevent. */
      toast.error("The latest changes could not be saved, so you are still here. Retry, or leave the draft as last saved.");
      return;
    }
    setExitOpen(false);
    leave();
  }, [toast, leave]);

  /* Save Draft forces a write even when no autosave has been scheduled yet, which is what
     makes it work on a brand-new form. It goes through the same queue, so it can never run
     beside an autosave. */
  const saveDraft = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const saved = (await queueRef.current?.saveNow()) === true;
      if (saved) toast.success("Draft saved.");
      else toast.error(lastSaveError.current);
    } finally {
      inFlightRef.current = false;
    }
  }, [toast]);

  /* Leave draft cancels the debounce, waits for a request that is already on the wire,
     discards every version it never confirmed, and starts no further save. */
  const leaveDraft = useCallback(async () => {
    setExitBusy(true);
    await queueRef.current?.abandon();
    setExitBusy(false);
    setExitOpen(false);
    leave();
  }, [leave]);

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
        toast.error(lastSaveError.current);
        return;
      }
      const result = await previewCreatorDraft(buildRequest({ billId: id }));
      setBillId(result.bill_id);
      applyServerTotals(result);
      const outcome = openCreatorPreview(result.pdf_base64, result.filename);
      if (outcome === "opened") toast.success("Preview opened. Nothing has been generated yet.");
      else if (outcome === "downloaded") toast.info("Pop-ups are blocked, so the preview was downloaded.");
      else toast.error("The preview could not be shown. Try again.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The preview could not be produced.");
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  }, [buildRequest, applyServerTotals, toast, setBillId]);

  /* ── Finalize ────────────────────────────────────────────── */

  const finalize = useCallback(
    async (confirmDuplicate: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy("finalize");
      setDuplicates([]);
      try {
        /* Persist the newest values and confirm the canonical row BEFORE generating. */
        const saved = (await queueRef.current?.flush()) === true;
        const id = billIdRef.current;
        if (!saved || !id) {
          toast.error(
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
        const said = `${notice.title}. ${notice.body}`;
        if (notice.tone === "warning") toast.warning(said);
        else toast.success(said);
        /* Only now, with the server having confirmed the generated bill, is the
           creation session retired. A failed finalize leaves the key in place, so the
           admin's retry still updates this draft instead of starting another. */
        completeDraftSession(
          sessionId,
          documentType,
          typeof window === "undefined" ? null : window.sessionStorage
        );
        /* Nothing typed during generation is saved onto a finalized row. */
        await queueRef.current?.abandon();
        /* Away to the section's own list, because the work is done and the list is where
           an admin verifies it. Staying here would show a form for a document that can
           no longer be edited. */
        navigate(info.route);
      } catch (err) {
        if (err instanceof CreatorError && err.isDuplicateInvoiceNo) {
          /* The draft is saved and intact; only the finalize was refused. The bills that
             already use the number are shown so the admin can go and look at them before
             deciding — which is the whole reason the server refuses rather than allowing
             it. */
          setDuplicates(err.duplicates);
        } else if (err instanceof CreatorError) {
          setProblems(err.problems.map((p) => ({ field: p.field, message: p.message })));
          toast.error(err.message);
        } else {
          toast.error(err instanceof Error ? err.message : "The invoice could not be generated.");
        }
      } finally {
        inFlightRef.current = false;
        setBusy(null);
      }
    },
    [buildRequest, toast, navigate, challan, documentNoun, info.route, sessionId, documentType, setBillId]
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
        toast.error(err instanceof Error ? err.message : "That job could not be unlinked.");
      }
    },
    [billId, refreshConnections, toast, setJobIds]
  );

  /* ── Folders ─────────────────────────────────────────────── */

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (name === "") return;
    /* `createBillingFolder` reports `ok: false` rather than throwing, because "that folder
       already exists" is an answer rather than a fault — and this form must treat it as
       one. An admin who types a name they have used before wants that folder, not an error
       telling them to invent a different name for the same month. */
    /* The folder type comes from the section, not from a default: creating a
       `billing` folder from the Challan Creator would produce a folder the challan
       can never be filed in. */
    const result = await createBillingFolder(name, documentType);
    const created = result.data;
    if (!result.ok || !created) {
      toast.error(result.error ?? "The folder could not be created.");
      return;
    }
    setFolders((previous) =>
      previous.some((folder) => folder.id === created.id) ? previous : [...previous, created]
    );
    setFolderId(created.id);
    setNewFolderName("");
    setFolderPickerOpen(false);
    toast.success(`Folder “${created.name}” created and selected.`);
  }, [newFolderName, toast, documentType, setFolderId]);

  /* ── Derived, display only ───────────────────────────────── */

  /* The one number this page computes, and it is quantity x rate shown while typing.
     The server recomputes it, and the Tax section below reads the server's figures, so
     the two cannot disagree about a stored total. */
  const lineTotals = useMemo(() => creatorTotals(lines), [lines]);

  const problemFor = useCallback(
    (field: string) => problems.find((p) => p.field === field)?.message ?? null,
    [problems]
  );

  const hi = useCallback((field: string) => isCopy && isLikelyToChange(field), [isCopy]);

  /* ── Loading ─────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-16 justify-center text-sm text-text-muted">
        <Loader2 size={18} className="animate-spin" />
        {isCopy ? `Reading the ${documentNoun} being copied…` : `Opening the ${challan ? "challan" : "bill"} creator…`}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <div className="rounded-xl border border-danger/40 bg-danger-muted px-5 py-4">
          <h3 className="text-sm font-bold text-danger">This bill could not be opened</h3>
          <p className="mt-1 text-sm text-text-secondary">{loadError}</p>
          <button
            type="button"
            onClick={() => navigate(info.route)}
            className="mt-3 px-3 py-2 rounded-lg border border-border text-xs font-bold text-text-secondary hover:bg-surface-hover cursor-pointer"
          >
            Back to {info.section}
          </button>
        </div>
      </div>
    );
  }

  /* ── The form ────────────────────────────────────────────── */

  return (
    <div className="animate-appear pb-32">
      <div className="px-4 pt-5 max-w-[100rem] mx-auto">
        {/* One line telling the admin what this document is and what state it is in. */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="text-lg font-bold text-text">
            {isResume
              ? `Continue ${documentNoun} draft`
              : isCopy
                ? `New ${documentNoun} from a previous ${documentNoun}`
                : `New ${documentNoun}`}
          </h2>
          <span className="px-2 py-0.5 rounded-md bg-warning-muted text-warning text-[11px] font-bold uppercase tracking-wider">
            Draft — not generated
          </span>
          <span className="text-xs text-text-muted" aria-live="polite">
            {queueState.status === "saving" && "Saving…"}
            {queueState.status === "pending" && "Unsaved changes"}
            {queueState.status === "saved" &&
              queueState.savedAt &&
              `Saved at ${new Date(queueState.savedAt).toLocaleTimeString()}`}
            {queueState.status === "idle" && "Changes save automatically"}
            {queueState.status === "error" && "Couldn't save"}
          </span>
          {queueState.status === "error" && (
            <button
              type="button"
              onClick={() => void queueRef.current?.flush()}
              className="text-xs font-bold text-danger hover:underline cursor-pointer"
            >
              Retry
            </button>
          )}
        </div>

        {isCopy && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary-muted/30 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
              <input
                type="checkbox"
                checked={useCurrentProfile}
                onChange={(event) => setUseCurrentProfile(event.target.checked)}
                className="w-4 h-4 accent-[var(--color-primary)]"
              />
              <span>
                Use the current Invoice Business Profile
                {profileCompanyName && (
                  <span className="text-text-muted"> ({profileCompanyName})</span>
                )}
              </span>
            </label>
            <p className="text-xs text-text-muted basis-full sm:basis-auto sm:flex-1 min-w-[18rem]">
              {useCurrentProfile
                ? challan
                  ? "The company details, address, contacts and signature wording below have been replaced with today's profile. Bank and payment terms are never put on a challan."
                  : "The company details, bank block, terms and footer wording below have been replaced with today's profile."
                : `Unticked, this ${documentNoun} keeps the wording the source ${documentNoun} was finalized with — so a change to the profile cannot rewrite one that was already issued.`}
            </p>
          </div>
        )}

        {problems.length > 0 && (
          <div className="mb-4 rounded-xl border border-danger/40 bg-danger-muted px-4 py-3">
            <h3 className="text-sm font-bold text-danger">
              {problems.length === 1 ? "One field needs attention" : `${problems.length} fields need attention`}
            </h3>
            <ul className="mt-1 space-y-0.5 text-sm text-text-secondary">
              {problems.map((problem) => (
                <li key={`${problem.field}:${problem.message}`}>
                  <strong className="text-text">{fieldLabel(problem.field, challan)}:</strong> {problem.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4">
          {/* ── A. Invoice Information ───────────────────────── */}
          <SectionCard
            title={challan ? "A. Challan Information" : "A. Invoice Information"}
            cols={3}
          >
            <ReviewField
              label={challan ? "Challan number" : "Invoice number"}
              highlight={hi("invoice_no")}
              hint={problemFor("invoice_no") ?? undefined}
            >
              <TextInput
                value={values.invoice_no ?? ""}
                onChange={(v) => setField("invoice_no", v)}
                placeholder={challan ? "CH/2026/001" : "INV/2026/001"}
              />
            </ReviewField>
            <ReviewField
              label={challan ? "Challan date" : "Invoice date"}
              highlight={hi("invoice_date")}
              hint={problemFor("invoice_date") ?? undefined}
            >
              <TextInput type="date" value={values.invoice_date ?? ""} onChange={(v) => setField("invoice_date", v)} />
            </ReviewField>
            {!challan && (
              <>
                <ReviewField label="Our challan no." highlight={hi("our_challan_no")}>
                  <TextInput value={values.our_challan_no ?? ""} onChange={(v) => setField("our_challan_no", v)} />
                </ReviewField>
                <ReviewField label="Our challan date" highlight={hi("our_challan_date")}>
                  <TextInput type="date" value={values.our_challan_date ?? ""} onChange={(v) => setField("our_challan_date", v)} />
                </ReviewField>
              </>
            )}
            <ReviewField label="Your challan no." highlight={hi("your_challan_no")}>
              <TextInput value={values.your_challan_no ?? ""} onChange={(v) => setField("your_challan_no", v)} />
            </ReviewField>
            <ReviewField label="Your challan date" highlight={hi("your_challan_date")}>
              <TextInput type="date" value={values.your_challan_date ?? ""} onChange={(v) => setField("your_challan_date", v)} />
            </ReviewField>
            <ReviewField
              label={challan ? "Service / purchase / sales order no." : "Order number"}
              highlight={hi("order_no")}
              hint="The label beside it is the workbook's own — a 'Service Order No.' stays that."
            >
              <TextInput value={values.order_no ?? ""} onChange={(v) => setField("order_no", v)} />
            </ReviewField>
            <ReviewField label="Order number label" hint="Printed exactly as typed, above the number.">
              <TextInput value={values.order_no_label ?? ""} onChange={(v) => setField("order_no_label", v)} placeholder="Service Order No." />
            </ReviewField>
            <ReviewField label="Order date" highlight={hi("order_date")}>
              <TextInput type="date" value={values.order_date ?? ""} onChange={(v) => setField("order_date", v)} />
            </ReviewField>
            {!challan && (
              <>
                <ReviewField label="E-way bill no." highlight={hi("eway_bill_no")}>
                  <TextInput value={values.eway_bill_no ?? ""} onChange={(v) => setField("eway_bill_no", v)} />
                </ReviewField>
                <ReviewField label="E-way bill date" highlight={hi("eway_bill_date")}>
                  <TextInput type="date" value={values.eway_bill_date ?? ""} onChange={(v) => setField("eway_bill_date", v)} />
                </ReviewField>
              </>
            )}
            <ReviewField label="Transporter mode" wide>
              <TextInput value={values.transporter_mode ?? ""} onChange={(v) => setField("transporter_mode", v)} />
            </ReviewField>
            <ReviewField label="Vehicle number" wide>
              <TextInput value={values.vehicle_number ?? ""} onChange={(v) => setField("vehicle_number", v)} />
            </ReviewField>
          </SectionCard>

          {/* ── B. Customer / Recipient ─────────────────────── */}
          <SectionCard title={challan ? "B. Customer / Party" : "B. Customer / Recipient"} cols={2}>
            {!challan && (
              <>
                <ReviewField label="Recipient heading" hint="Printed above the customer's name, e.g. 'Bill To'.">
                  <TextInput value={values.recipient_label ?? ""} onChange={(v) => setField("recipient_label", v)} />
                </ReviewField>
              </>
            )}
            <ReviewField
              label={challan ? "Customer / party name" : "Recipient name"}
              highlight={hi("party_name")}
              hint={problemFor("party_name") ?? undefined}
            >
              <TextInput value={values.party_name ?? ""} onChange={(v) => setField("party_name", v)} />
            </ReviewField>
            {!challan && (
              <ReviewField label="Recipient note" wide hint="A second line under the name, e.g. 'Kindly attend'.">
                <TextInput value={values.recipient_note ?? ""} onChange={(v) => setField("recipient_note", v)} />
              </ReviewField>
            )}
            <ReviewField label="Address" wide hint="One line per row is printed as one line.">
              <TextArea value={values.party_address ?? ""} onChange={(v) => setField("party_address", v)} rows={4} />
            </ReviewField>
            <ReviewField label={challan ? "Party GST number" : "Customer GST number"} hint={problemFor("party_gst_no") ?? undefined}>
              <TextInput value={values.party_gst_no ?? ""} onChange={(v) => setField("party_gst_no", v)} inputMode="text" />
            </ReviewField>
            {!challan && (
              <ReviewField label="Place of supply" hint="Decided by IGST versus CGST/SGST. The tax section below reads the same way.">
                <TextInput value={values.place_of_supply ?? ""} onChange={(v) => setField("place_of_supply", v)} />
              </ReviewField>
            )}
            <ReviewField label="State">
              <TextInput value={values.state ?? ""} onChange={(v) => setField("state", v)} />
            </ReviewField>
            <ReviewField label="State code">
              <TextInput value={values.state_code ?? ""} onChange={(v) => setField("state_code", v)} />
            </ReviewField>
          </SectionCard>

          {/* ── C. Seller / Business ────────────────────────── */}
          <SectionCard
            title="C. Seller / Business"
            cols={2}
            description={
              isCopy && !useCurrentProfile
                ? "These are the source bill's own values, kept as it was issued."
                : "Preloaded from the Invoice Business Profile. Anything typed here overrides it."
            }
          >
            <ReviewField label="Company name" wide>
              <TextInput value={values.seller_name ?? ""} onChange={(v) => setField("seller_name", v)} />
            </ReviewField>
            <ReviewField label="Business description" wide>
              <TextArea value={values.seller_descriptor ?? ""} onChange={(v) => setField("seller_descriptor", v)} rows={2} />
            </ReviewField>
            <ReviewField
              label="GST / MSME line"
              wide
              hint="One printed line: GST number first, then MSME. Leave it exactly as the profile has it."
            >
              <TextInput value={values.seller_tax_line ?? ""} onChange={(v) => setField("seller_tax_line", v)} />
            </ReviewField>
            <ReviewField label="Office address" wide>
              <TextArea value={values.seller_address ?? ""} onChange={(v) => setField("seller_address", v)} rows={3} />
            </ReviewField>
            <ReviewField label="Email / mobile" wide>
              <TextInput value={values.seller_contact ?? ""} onChange={(v) => setField("seller_contact", v)} />
            </ReviewField>
          </SectionCard>

          {/* ── D. Line Items ───────────────────────────────── */}
          <SectionCard title="D. Line Items" cols={1}>
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    <th className="w-10 py-1">Sr</th>
                    <th className="py-1">Description</th>
                    <th className="w-24 py-1">HSN</th>
                    <th className="w-20 py-1">UOM</th>
                    <th className="w-28 py-1">Qty</th>
                    {challan ? (
                      <th className="w-48 py-1">Remarks</th>
                    ) : (
                      <>
                        <th className="w-28 py-1">Rate</th>
                        <th className="w-28 py-1 text-right">Amount</th>
                      </>
                    )}
                    <th className="w-24 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.key} className="align-top">
                      <td className="py-1 pr-1">
                        <TextInput value={line.srNo} onChange={(v) => setLine(line.key, "srNo", v)} />
                      </td>
                      <td className="py-1 pr-1">
                        <TextArea value={line.description} onChange={(v) => setLine(line.key, "description", v)} rows={1} />
                      </td>
                      <td className="py-1 pr-1">
                        <TextInput value={line.hsnCode} onChange={(v) => setLine(line.key, "hsnCode", v)} />
                      </td>
                      <td className="py-1 pr-1">
                        <TextInput value={line.uom} onChange={(v) => setLine(line.key, "uom", v)} />
                      </td>
                      <td className="py-1 pr-1">
                        <NumberInput value={line.quantity} onChange={(v) => setLine(line.key, "quantity", v)} />
                      </td>
                      {challan ? (
                        <td className="py-1 pr-1">
                          <TextInput value={line.remarks} onChange={(v) => setLine(line.key, "remarks", v)} />
                        </td>
                      ) : (
                        <>
                          <td className="py-1 pr-1">
                            <NumberInput value={line.rate} onChange={(v) => setLine(line.key, "rate", v)} align="right" />
                          </td>
                          <td className="py-1 pr-1 text-right tabular-nums text-text-secondary">
                            {/* Read-only. The amount is quantity x rate and the server
                                recomputes it; showing a figure an admin could edit here would
                                be showing a number the invoice does not use. */}
                            {lineAmount(line) === null ? "—" : formatMoney(lineAmount(line))}
                          </td>
                        </>
                      )}
                      <td className="py-1">
                        <div className="flex items-center gap-0.5">
                          <RowButton title="Move up" disabled={lines[0]?.key === line.key} onClick={() => moveLine(line.key, -1)}>
                            <ArrowUp size={13} />
                          </RowButton>
                          <RowButton title="Move down" disabled={lines[lines.length - 1]?.key === line.key} onClick={() => moveLine(line.key, 1)}>
                            <ArrowDown size={13} />
                          </RowButton>
                          <RowButton title="Delete this line" onClick={() => removeLine(line.key)}>
                            <Trash2 size={13} />
                          </RowButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={challan ? 5 : 6} className="pt-2">
                      <button
                        type="button"
                        onClick={addLine}
                        className="btn btn-primary"
                      >
                        <Plus size={14} />
                        Add line
                      </button>
                    </td>
                    <td className="pt-2 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
                      {lines.length === 0 ? "No lines" : `${lines.length} line${lines.length === 1 ? "" : "s"}`}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Rows with no description are not saved. That is the one rule worth knowing: a
              half-typed row cannot quietly add itself to the total.
            </p>
          </SectionCard>

          {/* ── E. Tax & Totals (Tax Invoice only) ──────────── */}
          {!challan && (
          <SectionCard
            title="E. Tax & Totals"
            cols={3}
            description="Amounts are the server's, read back after every save — the same numbers the PDF will print."
          >
            <Field label="CGST rate %" hint={problemFor("cgst_rate") ?? undefined}>
              <NumberInput value={values.cgst_rate ?? ""} onChange={(v) => setField("cgst_rate", v)} align="right" />
            </Field>
            <Field label="SGST rate %">
              <NumberInput value={values.sgst_rate ?? ""} onChange={(v) => setField("sgst_rate", v)} align="right" />
            </Field>
            <Field label="IGST rate %">
              <NumberInput value={values.igst_rate ?? ""} onChange={(v) => setField("igst_rate", v)} align="right" />
            </Field>

            <Field label="GST payable on reverse charge" hint="Left blank, the row still prints.">
              <select
                value={reverseChargeGst ?? ""}
                onChange={(e) => setReverseChargeGst(e.target.value === "" ? null : e.target.value)}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Not specified</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </Field>
            <Field label="Round off" hint="Leave blank and the total is not rounded.">
              <NumberInput value={roundOff ?? ""} onChange={setRoundOff} align="right" />
            </Field>
            <Field label="Amount in words">
              <TextInput
                value={amountInWords}
                onChange={(v) => {
                  setAmountInWords(v);
                  setWordsTouched(true);
                }}
                placeholder={serverWords ?? "Generated from the total"}
              />
            </Field>

            <div className="sm:col-span-3 mt-1 grid gap-2 sm:grid-cols-2">
              <Calculated label="Amount before tax" value={formatMoney(serverTotals?.amount_before_tax ?? lineTotals.amountBeforeTax)} />
              <Calculated label="CGST" value={formatMoney(serverTotals?.cgst)} />
              <Calculated label="SGST" value={formatMoney(serverTotals?.sgst)} />
              <Calculated label="IGST" value={formatMoney(serverTotals?.igst)} />
              <Calculated label="Total GST" value={formatMoney(serverTotals?.total_gst)} />
              <Calculated label="Amount after tax" value={formatMoney(serverTotals?.amount_after_tax ?? lineTotals.amountBeforeTax)} strong />
            </div>

            {!billId && (
              <p className="sm:col-span-3 text-xs text-text-muted">
                The exact figures appear once the draft is saved. Until then only the amount
                before tax is known, because it is the only one that depends only on the line
                items.
              </p>
            )}
            {serverWords && !amountInWords && (
              <p className="sm:col-span-3 text-xs text-text-muted">
                Generated wording: <em>&ldquo;{serverWords}&rdquo;</em>. Leave the box empty and
                it is regenerated whenever the total changes.
              </p>
            )}
          </SectionCard>
          )}

          {/* ── E. Summary (Delivery Challan only) ──────────── */}
          {challan && (
            <SectionCard
              title="E. Summary"
              cols={2}
              description="A challan moves material; it charges nothing. Only the total quantity and the job type are printed."
            >
              <Field label="Total quantity" hint="Recalculated from the line items on every save.">
                <div className="px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm text-text tabular-nums">
                  {serverTotals?.total_quantity ?? lineTotals.totalQuantity ?? "—"}
                </div>
              </Field>
              <Field label="Job type" hint="Printed beside the total quantity as LABOUR JOB or WITH METAL.">
                <select
                  value={values.job_kind ?? ""}
                  onChange={(event) => setField("job_kind", event.target.value)}
                  className="w-full rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Not specified</option>
                  <option value="LABOUR JOB">Labour Job</option>
                  <option value="WITH METAL">With Metal</option>
                </select>
              </Field>
            </SectionCard>
          )}

          {/* ── F. Bank Details (Tax Invoice only) ──────────── */}
          {!challan && (
          <SectionCard
            title="F. Bank Details"
            cols={2}
            description="Preloaded from the Invoice Business Profile. Typing here overrides the profile for this bill only."
          >
            {BANK_FIELD_ORDER_LABEL.map(({ key, label }) => (
              <Field key={key} label={label}>
                <TextInput
                  value={bank[key]?.value ?? ""}
                  onChange={(v) => setBank((previous) => ({ ...previous, [key]: { label: previous[key]?.label ?? "", value: v } }))}
                />
              </Field>
            ))}
            <p className="sm:col-span-2 text-xs text-text-muted">
              {Object.values(bank).some((part) => part.value.trim() === "")
                ? "A blank bank line still prints its label. Clear the whole block on the Invoice Profile to stop it appearing."
                : "These four lines are printed exactly as shown, in this order."}
            </p>
          </SectionCard>
          )}

          {/* ── F. Terms & Conditions (Tax Invoice only) ────── */}
          {!challan && (
          <SectionCard title="F. Terms & Conditions" cols={1}>
            {([1, 2, 3] as const).map((n) => (
              <Field
                key={n}
                label={`Term ${n}`}
                hint={
                  (values[`term_${n}`] ?? "").includes("{")
                    ? `Prints as “${fillTemplate(values[`term_${n}`] ?? "", {
                        PAYMENT_DAYS: profilePaymentDays,
                        COMPANY_NAME: profileCompanyName,
                      })}”`
                    : undefined
                }
              >
                <TextArea
                  value={values[`term_${n}`] ?? ""}
                  onChange={(v) => setField(`term_${n}`, v)}
                  rows={2}
                />
              </Field>
            ))}
            <p className="text-xs text-text-muted">
              {profilePaymentDays === null ? (
                <>
                  No payment window is set on the Invoice Profile.{" "}
                  {TEMPLATE_VARIABLES.map((variable) => (
                    <code key={variable} className="px-1 mx-0.5 rounded bg-bg-secondary text-text-secondary">
                      {"{"}
                      {variable}
                      {"}"}
                    </code>
                  ))}{" "}
                  are substituted when the invoice prints, so a term containing one will show
                  the placeholder until the profile has a value for it.
                </>
              ) : (
                <>
                  Your profile asks for payment within {profilePaymentDays} day
                  {profilePaymentDays === 1 ? "" : "s"}.{" "}
                  {TEMPLATE_VARIABLES.map((variable) => (
                    <code key={variable} className="px-1 mx-0.5 rounded bg-bg-secondary text-text-secondary">
                      {"{"}
                      {variable}
                      {"}"}
                    </code>
                  ))}{" "}
                  in a term are replaced with that when the invoice prints. This bill&rsquo;s own
                  wording is never rewritten to match.
                </>
              )}
              {paymentDaysFromTerms([
                values.term_1 ?? "",
                values.term_2 ?? "",
                values.term_3 ?? "",
              ]) !== null && (
                <>
                  {" "}
                  This bill&rsquo;s terms state their own window
                  {" — "}
                  which is what it was written to say, and is left alone.
                </>
              )}
            </p>
          </SectionCard>
          )}

          {/* ── G. Closing / Signatures ─────────────────────── */}
          <SectionCard
            title={challan ? "F. Closing / Signatures" : "G. Footer / Signature"}
            cols={2}
          >
            <ReviewField
              label={challan ? "Material receipt acknowledgement" : "Certification"}
              wide
              hint={
                challan
                  ? "The line above the two signature blocks, e.g. 'Received above material in good & condition'."
                  : "The sentence above the two signature blocks."
              }
            >
              <TextArea value={values.certification ?? ""} onChange={(v) => setField("certification", v)} rows={2} />
            </ReviewField>
            <ReviewField label="For, <company>" wide>
              <TextInput value={values.on_behalf_of ?? ""} onChange={(v) => setField("on_behalf_of", v)} />
            </ReviewField>
            <ReviewField label="Authorised signatory designation">
              <TextInput value={values.signature_designation ?? ""} onChange={(v) => setField("signature_designation", v)} />
            </ReviewField>
            <ReviewField label="Receiver's signature label">
              <TextInput value={values.receiver_signature ?? ""} onChange={(v) => setField("receiver_signature", v)} />
            </ReviewField>
            <ReviewField label="Extra notes" wide hint="Anything else printed on the document.">
              <TextArea value={values.notes_extra ?? ""} onChange={(v) => setField("notes_extra", v)} rows={2} />
            </ReviewField>
            {!challan && (
              <Field label="Job type" wide hint="How this bill is grouped with the jobs it is linked to.">
                <TextInput value={values.job_kind ?? ""} onChange={(v) => setField("job_kind", v)} />
              </Field>
            )}
          </SectionCard>

          {/* ── H. Job Assignment ───────────────────────────── */}
          <SectionCard title={challan ? "G. Job Assignment" : "H. Job Assignment"} cols={1}>
            {connections.length === 0 ? (
              <p className="text-sm text-text-muted">
                No jobs linked yet. Linking is optional — a bill does not need a job — and a copy
                does not inherit the source bill&rsquo;s links.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {connections.map((connection) => (
                  <li key={connection.job_id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-text">
                        {connection.job_no ?? connection.job_id.slice(0, 8)}
                      </span>
                      <span className="ml-2 text-xs text-text-muted">
                        {connection.job_type === "labour" ? "Labour" : "With Material"}
                        {connection.job_given_date ? ` · ${formatBillDate(connection.job_given_date)}` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => unlinkJob(connection.job_id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold text-danger hover:bg-danger-muted cursor-pointer"
                    >
                      <Unlink size={13} />
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            )}
            /* Two buttons rather than one, so the dialog opens on the tab the admin meant. They are
               the same dialog and the same RPCs — one door each, not two ways of linking. */
            <div className="flex flex-wrap gap-2">
              <SmallButton
                disabled={!billId}
                title={billId ? undefined : "Saved as a draft first — jobs are linked to the bill, so there has to be one."}
                onClick={() => {
                  setJobsTab("labour");
                  setJobsModalOpen(true);
                }}
              >
                <Plus size={14} />
                Link Labour Jobs
              </SmallButton>
              <SmallButton
                disabled={!billId}
                title={billId ? undefined : "Saved as a draft first."}
                onClick={() => {
                  setJobsTab("with_material");
                  setJobsModalOpen(true);
                }}
              >
                <Plus size={14} />
                Link With Material Jobs
              </SmallButton>
            </div>
            <p className="text-xs text-text-muted">
              Linking is optional — a bill does not need a job — and uses the same connections
              the Bills list already shows, so a bill created here and a bill imported from
              Excel are linked the same way.
            </p>
          </SectionCard>

          {/* ── I. Logo ─────────────────────────────────────── */}
          <SectionCard title={challan ? "H. Challan Logo" : "I. Invoice Logo"} cols={1}>
            <div className="flex flex-wrap items-center gap-3">
              <SmallButton onClick={() => setLogoPickerOpen(true)}>
                {logoId ? "Change logo" : "Choose logo"}
              </SmallButton>
              {logoId !== undefined && logoId !== null && (
                <SmallButton onClick={() => setLogoId(null)}>No logo</SmallButton>
              )}
              <span className="text-sm text-text-secondary">
                {logoId === null
                  ? "No logo — the invoice prints without one."
                  : logoId
                    ? `“${logos.find((logo) => logo.id === logoId)?.name ?? "chosen logo"}”`
                    : "No logo chosen yet."}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              Chosen from the Logo Library. A logo is stored once and referenced by every bill
              that uses it, so renaming it changes all of them — which is why this is a
              selection rather than an upload.
            </p>
          </SectionCard>

          {/* ── J. Folder, Preview & Finalize ───────────────── */}
          <SectionCard
            title={challan ? "I. Preview & Generate" : "J. Preview & Generate"}
            cols={2}
            description="Nothing is generated until you choose to. A draft can be left and finished later."
          >
            <Field label="Billing folder" hint="Where this bill is filed once it exists.">
              <div className="flex gap-2">
                <select
                  value={folderId ?? ""}
                  onChange={(event) => setFolderId(event.target.value || null)}
                  className={inputCls}
                >
                  <option value="">No folder</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setFolderPickerOpen(true)}
                  title="Create a folder"
                  className="shrink-0 px-3 rounded-lg border border-border text-text-secondary hover:bg-surface-hover cursor-pointer"
                >
                  <FolderPlus size={16} />
                </button>
              </div>
            </Field>

            <Field label="Copy designation" hint="Set by the document itself — you do not choose it.">
              <div className="px-3 py-2 rounded-lg bg-bg-secondary border border-border text-sm text-text-secondary">
                {challan
                  ? "All three copies print with the challan's own customer, material table, total quantity and signatures. The only difference is the designation in the corner."
                  : "All three copies print with the bill's own customer, totals, bank, terms and signature. The only difference is the designation in the corner."}
              </div>
            </Field>

            <div className="sm:col-span-2 rounded-xl border border-border bg-bg-secondary px-4 py-3">
              <p className="text-sm text-text-secondary">
                <strong className="text-text">Preview</strong> saves the draft and renders it
                through the same renderer that produces the final documents. It writes nothing
                to storage and changes no state, so it can be used as often as you like.
              </p>
              <button
                type="button"
                onClick={() => void preview()}
                disabled={busy !== null}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-bold text-text hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === "preview" ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                Preview PDF
              </button>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── The sticky action footer ──────────────────────────────
          Sticky, not a modal, because the admin needs to see the fields while deciding.
          Three buttons, always in the same order, so muscle memory survives a long
          session: save, preview, generate. */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-surface/95 backdrop-blur px-4 py-3">
        <div className="max-w-[100rem] mx-auto flex flex-wrap items-center gap-3">
          <span className="text-sm text-text-secondary tabular-nums">
            {challan
              ? `Total quantity ${serverTotals?.total_quantity ?? lineTotals.totalQuantity ?? "—"}`
              : formatMoney(serverTotals?.amount_after_tax ?? lineTotals.amountBeforeTax)}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <FooterButton
              onClick={requestExit}
              disabled={busy !== null}
              icon={busy === null ? <ArrowLeft size={16} /> : <Loader2 size={16} className="animate-spin" />}
            >
              Save &amp; exit
            </FooterButton>
            <FooterButton
              onClick={() => void saveDraft()}
              disabled={busy !== null}
              icon={saveState === "saving" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            >
              Save Draft
            </FooterButton>
            <FooterButton onClick={() => void preview()} disabled={busy !== null} icon={<Eye size={16} />}>
              Preview PDF
            </FooterButton>
            <FooterButton
              onClick={() => void finalize(false)}
              disabled={busy !== null}
              primary
              icon={busy === "finalize" ? <Loader2 size={16} className="animate-spin" /> : <FilePlus2 size={16} />}
            >
              {challan ? "Generate Challan" : "Generate Invoice"}
            </FooterButton>
          </div>
        </div>
        {duplicates.length === 0 && (
          <p className="max-w-[100rem] mx-auto mt-1 text-[11px] text-text-muted">
            Generating writes three PDFs and makes the {documentNoun} final. It cannot be undone.
          </p>
        )}
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────── */}

      <LogoPickerModal
        open={logoPickerOpen}
        onClose={() => setLogoPickerOpen(false)}
        onSelect={(chosen) => {
          setLogoId(chosen);
          setLogoPickerOpen(false);
        }}
        currentLogoId={logoId ?? null}
      />

      <LinkBillsToJobsModal
        open={jobsModalOpen}
        billId={billId ?? ""}
        billLabel={values.invoice_no || values.party_name || `this ${documentNoun}`}
        initialTab={jobsTab}
        onClose={() => setJobsModalOpen(false)}
        onLinked={() => {
          setJobsModalOpen(false);
          void refreshConnections();
          /* Re-save so the link set the modal just wrote is the one the server holds for
             this draft. The links themselves go through the same RPCs the Bills list
             uses — there is no second relationship system for a created bill. */
          void queueRef.current?.saveNow();
        }}
      />

      <Modal
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        title="New billing folder"
        subtitle="Created and selected in one step."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFolderPickerOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:bg-surface-hover cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createFolder()}
              disabled={newFolderName.trim() === ""}
              className="btn btn-primary"
            >
              Create
            </button>
          </div>
        }
      >
        <div className="px-6 py-4">
          <TextInput
            value={newFolderName}
            onChange={setNewFolderName}
            placeholder="October 2026 — Zaveri"
            id="new-billing-folder"
          />
          <p className="mt-2 text-xs text-text-muted">
            Folders are the same ones the Folders section already uses — a billing folder holds
            bills, not jobs, and this bill joins it like any other.
          </p>
        </div>
      </Modal>

      <Modal
        open={duplicates.length > 0}
        onClose={() => setDuplicates([])}
        title={`That ${documentNoun} number is already used`}
        tone="danger"
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDuplicates([])}
              className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:bg-surface-hover cursor-pointer"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => void finalize(true)}
              className="btn btn-danger-solid"
            >
              Generate anyway
            </button>
          </div>
        }
      >
        <div className="px-6 py-4">
          <p className="text-sm text-text-secondary">
            Your draft is saved and nothing has been generated. These {documentNoun}s already
            use this {documentNoun} number:
          </p>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
            {duplicates.map((duplicate) => (
              <li key={duplicate.bill_id} className="px-3 py-2 text-sm">
                <span className="font-bold text-text">{duplicate.invoice_no}</span>
                <span className="ml-2 text-text-secondary">{duplicate.party_name ?? "no customer named"}</span>
                <span className="ml-2 text-xs text-text-muted">
                  {formatBillDate(duplicate.invoice_date)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-muted">
            Generating anyway creates a second {documentNoun} with the same number. Neither is
            overwritten and neither is marked as the wrong one — which is why this is your
            choice and not a default.
          </p>
        </div>
      </Modal>

      {/* Leaving with unsaved work. Save & Exit is the primary action and the only one
          that navigates after a confirmed write; a failure keeps the form open. */}
      <Modal
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        title="Leave this draft?"
        subtitle="The draft is saved automatically until you generate it."
        size="sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={exitBusy}
              onClick={() => setExitOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:bg-surface-hover disabled:opacity-50 cursor-pointer"
            >
              Stay editing
            </button>
            <button
              type="button"
              disabled={exitBusy}
              onClick={() => {
                void leaveDraft();
              }}
              className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:bg-surface-hover disabled:opacity-50 cursor-pointer"
            >
              Leave draft
            </button>
            <button
              type="button"
              disabled={exitBusy}
              onClick={() => void saveAndExit()}
              className="btn btn-primary disabled:opacity-50"
            >
              {exitBusy ? "Saving…" : "Save & exit"}
            </button>
          </div>
        }
      >
        <div className="px-6 py-4 space-y-2 text-sm text-text-secondary">
          <p>
            <strong className="text-text">Save &amp; exit</strong> writes the latest changes and
            leaves only after the server confirms them.
          </p>
          <p>
            <strong className="text-text">Leave draft</strong> goes back now. Anything typed since
            the last successful save will not be kept.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* ──────────────────────────────────────────────
   Small pieces
   ────────────────────────────────────────────── */

function EntryChoice({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3.5 w-full text-left px-4 py-3.5 rounded-[10px] border border-transparent hover:border-border hover:bg-surface-hover transition-colors cursor-pointer"
    >
      <span className="mt-0.5 w-8 h-8 rounded-[8px] border border-primary/25 bg-primary-muted text-primary flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-text">{title}</span>
        <span className="block mt-0.5 text-[12.5px] text-text-muted leading-relaxed">{body}</span>
      </span>
      <ChevronRight
        size={16}
        className="mt-1.5 shrink-0 text-text-muted/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all"
      />
    </button>
  );
}

function RowButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
    >
      {children}
    </button>
  );
}

function SmallButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="btn btn-primary"
    >
      {children}
    </button>
  );
}

function FooterButton({
  onClick,
  disabled,
  icon,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          : "inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-bold text-text hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      }
    >
      {icon}
      {children}
    </button>
  );
}

/** A server-named column, spelled the way the section header above it is. */
function fieldLabel(field: string, challan = false): string {
  const known: Record<string, string> = {
    invoice_no: challan ? "Challan number" : "Invoice number",
    invoice_date: challan ? "Challan date" : "Invoice date",
    party_name: "Customer",
    party_gst_no: "Customer GST number",
    line_items: "Line items",
    amount_in_words: "Amount in words",
    cgst_rate: "CGST rate",
    sgst_rate: "SGST rate",
    igst_rate: "IGST rate",
  };
  return known[field] ?? field.replace(/_/g, " ");
}
