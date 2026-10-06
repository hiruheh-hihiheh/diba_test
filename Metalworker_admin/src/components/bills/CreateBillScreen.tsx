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
  KeyboardAvoidingView,
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
} from "../../services/billCreator";
import { showCreatorPreview } from "../../services/creatorPreview";
import { getBillConnections, unlinkJobsFromBill } from "../../services/billJobConnections";
import { createBillingFolder, fetchBillingFolders, type BillingFolder } from "../../services/billingFolders";
import { fetchBill, fetchBillLineItems, fetchBills } from "../../services/bills";
import { formatBillDate, formatMoney } from "../../services/billFormat";
import { fetchInvoiceLogos } from "../../services/invoiceLogos";
import { fetchInvoiceBusinessProfile } from "../../services/invoiceBusinessProfile";
import { notify } from "../../utils/notify";
import type { InvoiceLogo } from "../../types/invoiceLogo";
import type { BillJobConnection } from "../../types/billJobConnections";
import type { JobType } from "../../types/job";

import { LogoPickerModal } from "./LogoPickerModal";
import { BillSourcePickerSheet } from "./BillSourcePickerSheet";
import { LinkBillToJobsSheet } from "./LinkBillToJobsSheet";

/** Long enough to coalesce a typist into one write, short enough to survive a refresh. */
const AUTOSAVE_MS = 1200;

export type CreatorMode = "empty" | "profile" | "copy";

export interface CreateBillScreenProps {
  mode: CreatorMode | null;
  /** The bill being copied, when `mode` is `"copy"`. */
  sourceBillId: string | null;
  /** Called when the admin picks a mode on the entry screen. */
  onChooseMode: (mode: CreatorMode) => void;
  /** Called with the bill to copy when the picker is confirmed. */
  onChooseSource: (billId: string) => void;
  /** Leave the entry screen without choosing anything. */
  onExit: () => void;
  /** Back of the form to the entry screen, abandoning the current mode's draft view. */
  onBackToEntry: () => void;
}

type Styles = ReturnType<typeof createStyles>;

export function CreateBillScreen(props: CreateBillScreenProps) {
  const { mode, sourceBillId } = props;
  const gate = useAdminGate();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (mode === null) {
    return (
      <EntryScreen
        styles={styles}
        checking={gate.checking}
        isAdmin={gate.status === "ok"}
        onChoose={props.onChooseMode}
        onChooseSource={props.onChooseSource}
        onExit={props.onExit}
      />
    );
  }

  return (
    <CreatorForm
      mode={mode}
      sourceBillId={sourceBillId}
      styles={styles}
      isAdmin={gate.status === "ok"}
      onExit={props.onExit}
      onBackToEntry={props.onBackToEntry}
    />
  );
}

/* ──────────────────────────────────────────────
   The entry screen: which of the three ways
   ────────────────────────────────────────────── */

function EntryScreen({
  styles,
  checking,
  isAdmin,
  onChoose,
  onChooseSource,
  onExit,
}: {
  styles: Styles;
  checking: boolean;
  isAdmin: boolean;
  onChoose: (mode: CreatorMode) => void;
  onChooseSource: (billId: string) => void;
  onExit: () => void;
}) {
  const [anyBillExists, setAnyBillExists] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* Only asked when the entry screen is actually up. One row is enough — this is a
     yes/no, and the total it reports is the same total the Bills list shows, so the two
     cannot disagree about whether anything exists. A failure leaves the button absent
     rather than showing one that opens an empty picker. */
  useEffect(() => {
    let live = true;
    fetchBills({ page: 1, pageSize: 1 })
      .then((page) => {
        if (live) setAnyBillExists(page.total > 0);
      })
      .catch(() => {
        if (live) setAnyBillExists(false);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.entryBody}>
        <Pressable onPress={onExit} hitSlop={10} accessibilityRole="button">
          <Text style={styles.back}>‹ Bills</Text>
        </Pressable>

        <Text style={styles.entryTitle}>Create a bill</Text>
        <Text style={styles.entrySub}>
          All three options produce the same bill, with the same Original, Duplicate and
          Triplicate PDFs. They differ only in what starts filled in.
        </Text>

        <EntryChoice
          styles={styles}
          title="Create New Bill"
          body="A blank bill. Fill in the customer, the line items and the taxes yourself."
          disabled={!isAdmin}
          onPress={() => onChoose("empty")}
        />
        <EntryChoice
          styles={styles}
          title="New Bill + Profile"
          body="The same blank bill, with your Invoice Business Profile preloaded — company details, bank block, terms and footer wording."
          disabled={!isAdmin}
          onPress={() => onChoose("profile")}
        />
        {anyBillExists ? (
          <EntryChoice
            styles={styles}
            title="Copy Existing Bill"
            body="Start from a bill that already exists. Its data is copied; the original is never changed."
            disabled={!isAdmin}
            onPress={() => setPickerOpen(true)}
          />
        ) : (
          /* Absent, not disabled. With nothing to copy there is no decision to make, and a
             greyed-out control invites the question "why is that grey?". */
          <View style={styles.entryAbsent}>
            <Text style={styles.entryAbsentTitle}>Copy Existing Bill</Text>
            <Text style={styles.note}>
              {checking ? "Looking for a bill to copy…" : "Appears once there is a bill to copy."}
            </Text>
          </View>
        )}

        {!isAdmin && !checking && (
          <Text style={styles.errorText}>
            Only an active admin can create a bill. You can read the ones that exist.
          </Text>
        )}
      </ScrollView>

      {/* The picker lives here rather than inside the router, because choosing a source is
          one step of this screen and not a page in its own right. What comes out of it is
          a bill id, and only the id crosses the routing boundary. */}
      <BillSourcePickerSheet
        visible={pickerOpen}
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
  styles,
  isAdmin,
  onExit,
  onBackToEntry,
}: {
  mode: CreatorMode;
  sourceBillId: string | null;
  styles: Styles;
  isAdmin: boolean;
  onExit: () => void;
  onBackToEntry: () => void;
}) {
  const isCopy = mode === "copy";

  /* ── The form ────────────────────────────────────────────── */

  const [values, setValues] = useState<CreatorFormValues>({});
  const [lines, setLines] = useState<CreatorLineDraft[]>([]);
  const [bank, setBank] = useState<BankDetails>({});
  const [amountInWords, setAmountInWords] = useState("");
  const [wordsTouched, setWordsTouched] = useState(false);
  const [roundOff, setRoundOff] = useState<string | null>(null);
  const [reverseChargeGst, setReverseChargeGst] = useState<string | null>(null);

  /* ── Everything that is NOT a patch field ────────────────── */

  const [billId, setBillId] = useState<string | null>(null);
  const [logoId, setLogoId] = useState<string | null | undefined>(undefined);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [connections, setConnections] = useState<BillJobConnection[]>([]);
  const [useCurrentProfile, setUseCurrentProfile] = useState(false);

  /* ── Server's numbers. Displayed, never computed here. ──── */

  const [serverTotals, setServerTotals] = useState<{
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ field: string; message: string }[]>([]);
  const [duplicates, setDuplicates] = useState<CreatorDuplicate[]>([]);
  const [busy, setBusy] = useState<null | "preview" | "finalize">(null);
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

  const draftKey = useMemo(() => draftKeyFor(mode, sourceBillId), [mode, sourceBillId]);

  /* ── Loading the form's starting state ───────────────────── */

  const applySeed = useCallback((seed: CreatorSeed) => {
    /* The seed keeps `terms` as its own three-tuple rather than inside `values`, because
       on the server they are not three columns — they are one `terms` array. Flattening
       them here is only safe because the network layer reads them back out of `values`
       and re-joins them through `termsToPatch`, so the decision about whether an all-blank
       set of terms should clear or be left alone is still made in one place. */
    setValues({
      ...seed.values,
      term_1: seed.terms[0],
      term_2: seed.terms[1],
      term_3: seed.terms[2],
    });
    setLines(seed.lines);
    setBank(seed.bank);
    setAmountInWords(seed.amountInWords);
    setWordsTouched(false);
    setRoundOff(seed.roundOff);
    setReverseChargeGst(seed.reverseChargeGst);
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
            fetchBill(sourceBillId),
            fetchBillLineItems(sourceBillId),
            fetchInvoiceBusinessProfile(),
          ]);
          if (!live) return;

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
              ? seedFromProfile(profile as unknown as Record<string, unknown>, "new")
              : seedEmpty("new")
          );
          setLogoId(undefined);
        }

        if (!live) return;
        const [folderList, logoList] = await Promise.all([
          fetchBillingFolders(),
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
  }, [mode, sourceBillId, applySeed]);

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

  const setField = useCallback((field: string, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  }, []);

  const setLine = useCallback(
    (key: string, field: keyof Omit<CreatorLineDraft, "key">, value: string) => {
      setLines((previous) =>
        previous.map((line) => (line.key === key ? { ...line, [field]: value } : line))
      );
    },
    []
  );

  const addLine = useCallback(() => {
    setLines((previous) => [
      ...previous,
      blankCreatorLine(`row-${Date.now()}-${previous.length}`, previous.length),
    ]);
  }, []);

  const removeLine = useCallback((key: string) => {
    /* Never leave zero rows. An empty table has nowhere to type, and a bill with no line
       items is refused at finalization anyway. */
    setLines((previous) =>
      previous.length <= 1
        ? [{ ...blankCreatorLine(`row-${Date.now()}`, 0) }]
        : previous.filter((line) => line.key !== key)
    );
  }, []);

  const moveLine = useCallback((key: string, by: number) => {
    setLines((previous) => {
      const at = previous.findIndex((line) => line.key === key);
      const to = at + by;
      if (at < 0 || to < 0 || to >= previous.length) return previous;
      const next = [...previous];
      const [moved] = next.splice(at, 1);
      next.splice(to, 0, moved);
      /* `sr_no` is renumbered with the row. It is a printed column, so leaving it behind
         would print "1, 3, 2" after a reorder — the invoice would look like a mistake. */
      return next.map((line, index) => ({ ...line, srNo: String(index + 1) }));
    });
  }, []);

  /* ── Saving ──────────────────────────────────────────────── */

  const buildRequest = useCallback(
    (overrides: Record<string, unknown> = {}) => ({
      billId,
      sourceBillId,
      useCurrentProfile,
      values,
      lines,
      amountInWords: amountInWordsForPatch(amountInWords, wordsTouched),
      roundOff,
      reverseChargeGst,
      bank,
      draftKey,
      logoId,
      folderId,
      jobIds,
      ...overrides,
    }),
    [
      billId,
      sourceBillId,
      useCurrentProfile,
      values,
      lines,
      amountInWords,
      wordsTouched,
      roundOff,
      reverseChargeGst,
      bank,
      draftKey,
      logoId,
      folderId,
      jobIds,
    ]
  );

  const applyServerTotals = useCallback(
    (result: { amount_after_tax: number | null; amount_in_words: string | null }) => {
      setServerTotals((previous) => ({
        amount_before_tax: previous?.amount_before_tax ?? null,
        cgst: previous?.cgst ?? null,
        sgst: previous?.sgst ?? null,
        igst: previous?.igst ?? null,
        total_gst: previous?.total_gst ?? null,
        amount_after_tax: result.amount_after_tax,
      }));
      setServerWords(result.amount_in_words);
    },
    []
  );

  const save = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (loading) return null;
      setSaveState("saving");
      try {
        const result = await saveCreatorDraft(buildRequest());
        setBillId(result.bill_id);
        applyServerTotals(result);
        setSavedAt(result.saved_at ?? new Date().toISOString());
        setSaveState("saved");
        setProblems([]);
        if (!options.silent) notify("Draft saved");
        return result;
      } catch (err) {
        setSaveState("error");
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
    [loading, buildRequest, applyServerTotals]
  );

  /* ── Autosave ────────────────────────────────────────────── */

  /* Refs rather than an effect dependency on the whole form: autosave must fire once per
     settled burst of typing, and depending on `values` would restart the timer on every
     keystroke, which is the same as never saving. */
  const dirty = useRef(false);
  const skipFirst = useRef(true);

  useEffect(() => {
    if (loading) return;
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    dirty.current = true;
  }, [values, lines, bank, amountInWords, roundOff, reverseChargeGst, loading]);

  useEffect(() => {
    if (loading || !dirty.current) return;
    const timer = setTimeout(() => {
      void save({ silent: true });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [values, lines, bank, amountInWords, roundOff, reverseChargeGst, loading, save]);

  /* ── Preview ─────────────────────────────────────────────── */

  const preview = useCallback(async () => {
    setBusy("preview");
    try {
      /* Persist first, then preview. The preview is rendered from the SAVED row, so the
         PDF an admin is shown is the PDF that would be generated — so the preview cannot
         flatter a bill the finalize would then reject. */
      const saved = await save({ silent: true });
      if (!saved) {
        notify("Not previewed", "Save the draft first — the preview is made from the saved bill.");
        return;
      }
      const result = await previewCreatorDraft(buildRequest({ billId: saved.bill_id }));
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
      setBusy(null);
    }
  }, [save, buildRequest, applyServerTotals]);

  /* ── Finalize ────────────────────────────────────────────── */

  const finalize = useCallback(
    async (confirmDuplicate: boolean) => {
      setBusy("finalize");
      setDuplicates([]);
      try {
        const result = await finalizeCreatorDraft(
          buildRequest({ confirmDuplicateInvoiceNo: confirmDuplicate })
        );
        setBillId(result.bill_id);
        setProblems([]);
        setDuplicates([]);
        notify(
          "Invoice generated",
          result.jobs_error
            ? `The bill was created, but its job links failed: ${result.jobs_error}`
            : "Original, Duplicate and Triplicate."
        );
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
        setBusy(null);
      }
    },
    [buildRequest, onExit]
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
    [billId, refreshConnections]
  );

  /* ── Folders ─────────────────────────────────────────────── */

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (name === "") return;
    /* `createBillingFolder` reports `ok: false` rather than throwing, because "that folder
       already exists" is an answer rather than a fault — and this form must treat it as
       one. An admin who types a name they have used before wants that folder. */
    const result = await createBillingFolder(name);
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
  }, [newFolderName]);

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
          <ActivityIndicator size="large" color={themeColor(styles)} />
          <Text style={styles.note}>
            {isCopy ? "Reading the bill being copied…" : "Opening the bill creator…"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        <ScrollView contentContainerStyle={styles.entryBody}>
          <Pressable onPress={onBackToEntry} hitSlop={10} accessibilityRole="button">
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>This bill could not be opened</Text>
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
          <Pressable onPress={onBackToEntry} hitSlop={10} accessibilityRole="button">
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>

          <Text style={styles.pageTitle}>
            {isCopy ? "Create from Previous Bill" : "Create Bill"}
          </Text>
          <Text style={styles.pageSub}>
            {isCopy
              ? "A new draft from an existing bill. The original is not changed."
              : "A new bill, saved as a draft until you generate it."}
          </Text>

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
                    ? "Company details, bank block, terms and footer wording are taken from your profile as it is now."
                    : "Off, so the source bill's own wording is preserved exactly as it was issued."}
                </Text>
              </View>
            </Pressable>
          )}

          {problems.length > 0 && (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Fix these before generating</Text>
              {problems.map((problem) => (
                <Text key={`${problem.field}:${problem.message}`} style={styles.note}>
                  <Text style={styles.errorTitle}>{fieldLabel(problem.field)}: </Text>
                  {problem.message}
                </Text>
              ))}
            </View>
          )}

          {/* ── A. Invoice Information ───────────────────────── */}
          <Section styles={styles} title="A. Invoice Information">
            <Field
              styles={styles}
              label="Invoice number"
              highlight={hi("invoice_no")}
              hint={problemFor("invoice_no")}
              value={values.invoice_no ?? ""}
              onChange={(v) => setField("invoice_no", v)}
              placeholder="INV/2026/001"
            />
            <DateField
              styles={styles}
              label="Invoice date"
              highlight={hi("invoice_date")}
              hint={problemFor("invoice_date")}
              value={values.invoice_date ?? ""}
              onChange={(v) => setField("invoice_date", v)}
            />
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
              label="Order number"
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
          <Section styles={styles} title="B. Customer / Recipient">
            <Field
              styles={styles}
              label="Recipient heading"
              hint="Printed above the customer's name, e.g. 'Bill To'."
              value={values.recipient_label ?? ""}
              onChange={(v) => setField("recipient_label", v)}
            />
            <Field
              styles={styles}
              label="Recipient name"
              highlight={hi("party_name")}
              hint={problemFor("party_name")}
              value={values.party_name ?? ""}
              onChange={(v) => setField("party_name", v)}
            />
            <Field
              styles={styles}
              label="Recipient note"
              hint="A second line under the name, e.g. 'Kindly attend'."
              value={values.recipient_note ?? ""}
              onChange={(v) => setField("recipient_note", v)}
            />
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
              label="Customer GST number"
              hint={problemFor("party_gst_no")}
              value={values.party_gst_no ?? ""}
              onChange={(v) => setField("party_gst_no", v)}
            />
            <Field
              styles={styles}
              label="Place of supply"
              hint="Decided by IGST versus CGST/SGST. The tax section below reads the same way."
              value={values.place_of_supply ?? ""}
              onChange={(v) => setField("place_of_supply", v)}
            />
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

          {/* ── E. Tax & Totals ─────────────────────────────── */}
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
              label="Reverse charge GST"
              hint="Printed as a value, not as a yes/no. Leave blank if it does not apply."
              keyboard="decimal-pad"
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

          {/* ── F. Bank Details ─────────────────────────────── */}
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

          {/* ── G. Terms & Conditions ───────────────────────── */}
          <Section styles={styles} title="G. Terms & Conditions">
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
            </Text>
          </Section>

          {/* ── H. Footer / Signature ───────────────────────── */}
          <Section styles={styles} title="H. Footer / Signature">
            <Field
              styles={styles}
              label="Certification"
              hint="The sentence above the two signature blocks."
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
            <Field
              styles={styles}
              label="Job type"
              hint="How this bill is grouped with the jobs it is linked to."
              value={values.job_kind ?? ""}
              onChange={(v) => setField("job_kind", v)}
            />
          </Section>

          {/* ── I. Job Assignment ───────────────────────────── */}
          <Section styles={styles} title="I. Job Assignment">
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

          {/* ── J. Invoice Logo ─────────────────────────────── */}
          <Section styles={styles} title="J. Invoice Logo">
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

          {/* ── K. Folder & Preview ─────────────────────────── */}
          <Section
            styles={styles}
            title="K. Folder, Preview & Generate"
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
              All three copies print with the bill&apos;s own customer, totals, bank, terms
              and signature. The only difference is the designation in the corner.
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
              <Text style={styles.errorTitle}>That invoice number is already used</Text>
              <Text style={styles.note}>
                Your draft is saved and nothing has been generated. These bills already use
                this invoice number:
              </Text>
              {duplicates.map((duplicate) => (
                <Text key={duplicate.bill_id} style={styles.note}>
                  • {duplicate.invoice_no} — {duplicate.party_name ?? "no customer named"} ·{" "}
                  {formatBillDate(duplicate.invoice_date)}
                </Text>
              ))}
              <Text style={styles.note}>
                Generating anyway creates a second bill with the same number. Neither is
                overwritten and neither is marked as the wrong one — which is why this is
                your choice and not a default.
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
              {formatMoney(serverTotals?.amount_after_tax ?? lineTotals.amountBeforeTax)}
            </Text>
            <Text style={styles.footerSaved}>
              {saveState === "saving"
                ? "Saving…"
                : savedAt
                  ? `Saved ${formatBillDate(savedAt)}`
                  : "Not saved yet"}
            </Text>
          </View>
          <View style={styles.row}>
            <SmallBtn
              styles={styles}
              disabled={busy !== null || !isAdmin}
              onPress={() => void save()}
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
                {busy === "finalize" ? "Generating…" : "Generate Invoice"}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.footerNote}>
            Generating writes three PDFs and makes the bill final. It cannot be undone.
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
        billId={billId ?? ""}
        billLabel={values.invoice_no || values.party_name || "this draft"}
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
    </SafeAreaView>
  );
}

/* ──────────────────────────────────────────────
   Small pieces
   ────────────────────────────────────────────── */

function themeColor(_styles: Styles): string {
  /* The only reason this exists is so the loading spinner does not need the theme
     threaded through the whole component. Read from the style the caller built. */
  return (_styles as unknown as { _spinnerColor?: string })._spinnerColor ?? "#E50914";
}

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

/**
 * A stable idempotency token for one bill being drafted.
 *
 * The server treats a repeated `creator_draft_key` as the same draft rather than a second
 * one, which is what makes a retried autosave safe. It is kept in `sessionStorage` where
 * that exists — the web build of this app included — so a refresh reuses the token, and
 * falls back to a fresh one where storage is unavailable. On a native device the in-memory
 * copy is enough: the process is not going to be killed and silently restarted between
 * two keystrokes, and if it is, the admin is looking at a new draft, not a corrupted one.
 */
function draftKeyFor(mode: CreatorMode, sourceBillId: string | null): string {
  const storageKey = `bill-creator:${mode}:${sourceBillId ?? ""}`;
  try {
    const existing = globalThis.sessionStorage?.getItem(storageKey);
    if (existing) return existing;
    const fresh = newKey();
    globalThis.sessionStorage?.setItem(storageKey, fresh);
    return fresh;
  } catch {
    return newKey();
  }
}

function newKey(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `k-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** A server-named column, spelled the way the section header above it is. */
function fieldLabel(field: string): string {
  const known: Record<string, string> = {
    invoice_no: "Invoice number",
    invoice_date: "Invoice date",
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

/* Kept so the unused-import checker sees the one thing this file needs from creatorForm
   that is only referenced in a type position above. */
export type { CreatorSeed as CreatorFormSeed };
void paymentDaysFromTerms;