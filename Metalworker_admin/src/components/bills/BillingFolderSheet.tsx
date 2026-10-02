// src/components/bills/BillingFolderSheet.tsx
//
// The Billing section's own folder workspace: a list of bill folders, and the
// folder-level analysis behind each one.
//
// WHY A SEPARATE SHEET
// Bills are filed in their OWN folders, not in job folders. The alternative — dropping
// bill links into the existing `admin_folders` rows the Jobs and Folders screens show
// — would mean a "September Analysis" folder appearing among Labour jobs, with the
// worker app's job counts quietly including invoices. So this opens its own workspace,
// and the folders it creates carry `folder_type = 'billing'`, which is what keeps them
// out of those screens (see `services/billingFolders.ts`).
//
// WHAT A FOLDER SHOWS, AND WHY
// A list of bills is not the point of filing them. The point is comparing several
// imports at once, so the opened folder leads with totals, then the per-bill
// averages, then the spread and the job-kind split. Every figure comes from
// `get_folder_bill_summary` — this component formats them and never adds them up
// itself, which is what keeps the admin app and the desktop app from disagreeing
// about the same folder.
//
// ONE INVOICE IS ONE BILL
// The bill count here is a count of bills. The three print copies of an invoice are
// three PDFs on one bill and are not counted, listed or totalled separately anywhere
// in this screen.

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  addBillsToBillingFolder,
  createBillingFolder,
  deleteBillingFolder,
  emptyBillingFolder,
  fetchBillingFolders,
  moveBillsBetweenBillingFolders,
  removeBillsFromBillingFolder,
  renameBillingFolder,
  type BillingFolder,
} from "../../services/billingFolders";
import {
  exportFolderSummaryPdf,
  fetchBills,
  fetchFolderBillSummary,
  formatBillDate,
  formatJobKind,
  formatMoney,
  formatQuantity,
} from "../../services/bills";
import type { Bill, BulkProgress, FolderBillSummary } from "../../types/bill";
import { notify } from "../../utils/notify";
import { BillSummaryScopeNote } from "./BillSummaryScopeNote";
import { BulkOperationOverlay, type BulkOperation } from "./BulkOperationOverlay";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Input } from "../ui/Input";

/** Bills per page inside an opened folder. Matches the Bills list's own page size. */
const PAGE_SIZE = 20;

interface BillingFolderSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * Bills to file when the user opens this sheet from a selection on the Bills list.
   *
   * Carried as ids rather than as a count, because the operation has to name the
   * bills it is about to touch: "File 50 bills" with no record of which 50 is not a
   * confirmation anyone can check. `null` when the sheet was opened just to browse.
   */
  pendingBillIds?: string[] | null;
  /** Called after anything that changes folders or their bill counts. */
  onChanged: () => void;
  /** Opens a bill on the Bills screen behind this sheet. */
  onOpenBill?: (billId: string) => void;
}

export function BillingFolderSheet({
  visible,
  onClose,
  pendingBillIds = null,
  onChanged,
  onOpenBill,
}: BillingFolderSheetProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [folders, setFolders] = useState<BillingFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  /**
   * Has a read ever completed?
   *
   * Separate from `foldersLoading` because the two answer different questions:
   * `foldersLoading` is "a read the user asked for is running", and `foldersLoaded`
   * is "there is a real answer on screen yet". The difference is what stops an empty
   * folder list from flashing "No billing folders yet" on every open before the first
   * read comes back.
   */
  const [foldersLoaded, setFoldersLoaded] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkOperation | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const [confirm, setConfirm] = useState<
    | { kind: "delete"; folder: BillingFolder }
    | { kind: "empty"; folder: BillingFolder }
    | null
  >(null);

  /** The folder list, and nothing else. No state is touched here. */
  const readFolders = useCallback(() => fetchBillingFolders(), []);

  /** Commit a read, or record why it failed. Always ends by clearing the spinner. */
  const commitFolders = useCallback((list: BillingFolder[]) => {
    setFolders(list);
    setFoldersError(null);
    setFoldersLoaded(true);
    setFoldersLoading(false);
  }, []);

  /**
   * The effect-driven read, on open.
   *
   * `readFolders` holds no `setState`, so the only writes happen inside the promise
   * callbacks below — which is what makes calling this from an effect safe rather than
   * a synchronous render cascade.
   */
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    readFolders().then(
      (list) => {
        if (cancelled) return;
        commitFolders(list);
      },
      (err: unknown) => {
        if (cancelled) return;
        /* Failure is not fatal: the workspace still opens, and the user can retry.
           An unreadable folder list must not look like an empty one. */
        setFoldersError(
          err instanceof Error ? err.message : "Billing folders could not be loaded."
        );
        setFoldersLoaded(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [visible, readFolders, commitFolders]);

  /**
   * Re-read, showing the spinner.
   *
   * The click-driven counterpart, used after a create, a rename, a delete and by
   * "Try again". Raising the flag here responds to a click, so it costs nothing. It
   * must never be the effect's entry point — that is `readFolders` above.
   */
  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    setFoldersError(null);
    try {
      commitFolders(await readFolders());
    } catch (err) {
      setFoldersError(err instanceof Error ? err.message : "Billing folders could not be loaded.");
      setFoldersLoading(false);
    }
  }, [readFolders, commitFolders]);

  /** Close the sheet, leaving no state behind for the next visit. */
  function handleClose() {
    setOpenId(null);
    setNewName("");
    setRenamingId(null);
    setRenameText("");
    setBulk(null);
    onClose();
  }

  /** Step back from an opened folder to the list. */
  function closeFolder() {
    setOpenId(null);
    setRenamingId(null);
    setRenameText("");
    setConfirm(null);
  }

  const openFolder = folders.find((f) => f.id === openId) ?? null;

  /* The pending selection is consumed on arrival, so closing the sheet does not leave
     a stale set of ids armed for the next "Add to folder". */
  const pendingCount = pendingBillIds?.length ?? 0;

  async function handleCreate() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await createBillingFolder(name);
      if (!res.ok) {
        notify("The folder was not created", res.error ?? "Please try again.");
        return;
      }
      setNewName("");
      notify("Billing folder created", `${name} is ready for bills.`);
      await loadFolders();
      onChanged();
    } finally {
      setCreating(false);
    }
  }

  async function handleRename(folder: BillingFolder) {
    const name = renameText.trim();
    if (!name) return;
    const res = await renameBillingFolder(folder.id, name);
    if (!res.ok) {
      notify("The folder was not renamed", res.error ?? "Please try again.");
      return;
    }
    setRenamingId(null);
    setRenameText("");
    await loadFolders();
    onChanged();
  }

  async function handleDelete(folder: BillingFolder) {
    setConfirm(null);
    setBulk({
      title: "Deleting billing folder",
      subtitle: folder.name,
      /* One request per step here, so there is no real `done / total` to show and the
         overlay says "Please wait..." rather than inventing a fraction. */
    });
    try {
      const res = await deleteBillingFolder(folder.id);
      if (!res.ok) {
        notify("The folder was not deleted", res.error ?? "Please try again.");
        await loadFolders();
        return;
      }
      const detached = res.bills_detached ?? 0;
      setOpenId((id) => (id === folder.id ? null : id));
      notify(
        "Billing folder deleted",
        detached === 0
          ? "The folder was empty. No bills were affected."
          : `${detached} ${
              detached === 1 ? "bill is" : "bills are"
            } still in All Bills — deleting a folder never deletes a bill.`,
      );
      await loadFolders();
      onChanged();
    } finally {
      setBulk(null);
    }
  }

  async function handleEmpty(folder: BillingFolder) {
    setConfirm(null);
    setBulk({ title: "Emptying billing folder", subtitle: folder.name });
    try {
      const res = await emptyBillingFolder(folder.id);
      if (!res.ok) {
        notify("The folder was not emptied", res.error ?? "Please try again.");
        return;
      }
      notify(
        "Folder emptied",
        `Removed ${res.bills_removed ?? 0} ${
          (res.bills_removed ?? 0) === 1 ? "bill" : "bills"
        } from the folder. The bills themselves are untouched.`,
      );
      setOpenId(null);
      await loadFolders();
      onChanged();
    } finally {
      setBulk(null);
    }
  }

  /** File the bills that came in with the sheet. Progress is real: chunked inserts. */
  async function handleFilePending(folder: BillingFolder) {
    if (!pendingBillIds?.length) return;
    setBulk({
      title: "Filing bills",
      subtitle: `${pendingBillIds.length} ${
        pendingBillIds.length === 1 ? "bill" : "bills"
      } → ${folder.name}`,
      progressLabel: "Filing",
      progress: { done: 0, total: pendingBillIds.length },
    });
    try {
      const res = await addBillsToBillingFolder(folder.id, pendingBillIds, (progress: BulkProgress) =>
        setBulk((prev) => (prev ? { ...prev, progress } : prev))
      );
      if (!res.ok) {
        notify("Filing did not finish", res.error ?? "Please try again.");
        await loadFolders();
        onChanged();
        return;
      }
      const parts = [`Filed ${res.changed} in ${folder.name}.`];
      /* "already in there" is reported, not hidden: the user asked to file N bills and
         needs to know why the number is smaller than they expected. */
      if (res.skipped > 0) {
        parts.push(`${res.skipped} ${res.skipped === 1 ? "was" : "were"} already in the folder.`);
      }
      notify("Bills filed", parts.join(" "));
      await loadFolders();
      onChanged();
    } finally {
      setBulk(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
        <View style={styles.header}>
          <Pressable
            onPress={() => (openId ? closeFolder() : handleClose())}
            accessibilityRole="button"
            accessibilityLabel={openId ? "Back to the billing folders" : "Close billing folders"}
            hitSlop={8}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Text style={styles.backText}>{openId ? "← Folders" : "← Close"}</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {openFolder ? openFolder.name : "Billing Folders"}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {openFolder ? (
            <BillingFolderDetail
              folder={openFolder}
              onChanged={async () => {
                await loadFolders();
                onChanged();
              }}
              onOpenBill={(billId) => {
                /* Opening a bill from inside the folder is a navigation, so the sheet
                   steps out of the way. Closing is routed through `handleClose` rather
                   than the raw `onClose` so the folder's own state is cleared too and
                   the next visit starts from the list. */
                if (!onOpenBill) return;
                onOpenBill(billId);
                handleClose();
              }}
            />
          ) : (
            <>
              {/* The pending selection is announced here, at the point of action, so
                  the user can see what "File these bills" is about to do. */}
              {pendingCount > 0 && (
                <View style={styles.pendingBanner}>
                  <Text style={styles.pendingText}>
                    {pendingCount} {pendingCount === 1 ? "bill" : "bills"} ready to file
                  </Text>
                  <Text style={styles.pendingHint}>
                    Pick a folder below. Or create one if it does not exist yet.
                  </Text>
                </View>
              )}

              <View style={styles.createRow}>
                <View style={styles.createInput}>
                  <Input
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="New billing folder name"
                    autoCapitalize="words"
                  />
                </View>
                <Button
                  title="Create"
                  onPress={() => void handleCreate()}
                  loading={creating}
                  disabled={creating || newName.trim().length === 0}
                />
              </View>

              {/* A spinner while a read is running AND the first read has not
                  answered yet, or while a user-initiated reload is in flight. The
                  list it replaces is either empty or already-known-good, so showing
                  both at once would be a flash of the wrong thing. */}
              {foldersLoading && folders.length === 0 && (
                <View style={styles.centered}>
                  <ActivityIndicator color={theme.colors.primary} />
                </View>
              )}

              {!foldersLoading && foldersError && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{foldersError}</Text>
                  <Button title="Try again" onPress={() => void loadFolders()} variant="ghost" />
                </View>
              )}

              {/* The empty state waits for a real answer. Without `foldersLoaded`
                  this would flash "No billing folders yet" every time the sheet
                  opened, and for a workspace that has 40 folders that is alarming. */}
              {foldersLoaded && !foldersLoading && !foldersError && folders.length === 0 && (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>No billing folders yet</Text>
                  <Text style={styles.emptyText}>
                    Upload some bills, select them on the Bills list, then tap “Add to
                    folder”. File a group of invoices here to compare their totals and
                    averages.
                  </Text>
                </View>
              )}

              {folders.map((folder) => (
                <View key={folder.id} style={styles.folderRow}>
                  <Pressable
                    onPress={() => setOpenId(folder.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${folder.name}, ${folder.bill_count} ${
                      folder.bill_count === 1 ? "bill" : "bills"
                    }`}
                    style={({ pressed }) => [styles.folderMain, pressed && styles.pressed]}
                  >
                    <Text style={styles.folderName} numberOfLines={1}>
                      {folder.name}
                    </Text>
                    <Text style={styles.folderCount}>
                      {folder.bill_count} {folder.bill_count === 1 ? "bill" : "bills"}
                    </Text>
                  </Pressable>

                  {renamingId === folder.id ? (
                    <View style={styles.renameRow}>
                      <View style={styles.createInput}>
                        <Input value={renameText} onChangeText={setRenameText} />
                      </View>
                      <Button title="Save" onPress={() => void handleRename(folder)} />
                      <Pressable
                        onPress={() => setRenamingId(null)}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel the rename"
                        style={({ pressed }) => [pressed && styles.pressed]}
                      >
                        <Text style={styles.actionTextSecondary}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.folderActions}>
                      <Pressable
                        onPress={() => {
                          setRenamingId(folder.id);
                          setRenameText(folder.name);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Rename ${folder.name}`}
                        style={({ pressed }) => [pressed && styles.pressed]}
                      >
                        <Text style={styles.actionTextSecondary}>Rename</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setConfirm({ kind: "delete", folder })}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${folder.name}`}
                        style={({ pressed }) => [pressed && styles.pressed]}
                      >
                        <Text style={styles.actionTextDanger}>Delete</Text>
                      </Pressable>
                    </View>
                  )}

                  {pendingCount > 0 && (
                    <Button
                      title={`File ${pendingCount} here`}
                      onPress={() => void handleFilePending(folder)}
                      variant="ghost"
                    />
                  )}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <ConfirmDialog
        visible={!!confirm}
        title={confirm?.kind === "empty" ? "Empty this folder?" : "Delete this billing folder?"}
        message={
          confirm?.kind === "empty"
            ? `All ${confirm?.folder.bill_count ?? 0} bills will be removed from "${
                confirm?.folder.name ?? ""
              }". The bills themselves are NOT deleted — they stay in All Bills with their print copies.`
            : `The folder "${confirm?.folder.name ?? ""}" and its ${
                confirm?.folder.bill_count ?? 0
              } bill links will be removed. The bills themselves are NOT deleted — they stay in All Bills with their print copies.`
        }
        confirmLabel={confirm?.kind === "empty" ? "Empty folder" : "Delete folder"}
        destructive
        busy={!!bulk}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "empty") void handleEmpty(confirm.folder);
          else void handleDelete(confirm.folder);
        }}
        onCancel={() => setConfirm(null)}
      />

      <BulkOperationOverlay operation={bulk} />
    </Modal>
  );
}

/* ──────────────────────────────────────────────
   THE OPENED FOLDER
   ────────────────────────────────────────────── */

interface BillingFolderDetailProps {
  folder: BillingFolder;
  onChanged: () => Promise<void>;
  onOpenBill?: (billId: string) => void;
}

function BillingFolderDetail({ folder, onChanged, onOpenBill }: BillingFolderDetailProps) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  const [summary, setSummary] = useState<FolderBillSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billTotal, setBillTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  /** True while the summary PDF is being produced, so the button cannot double-fire. */
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkOperation | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "empty" } | null>(null);
  const [destinations, setDestinations] = useState<BillingFolder[]>([]);

  /**
   * The two reads, and nothing else. No state is touched here.
   *
   * Keeping this function free of `setState` is what lets it be called from an effect:
   * a function that writes state, invoked in an effect body, renders a second time
   * before anything has been fetched. Splitting the read from the write means the
   * effect only writes inside a promise callback, which is a real response.
   *
   * The two reads are started together and neither blocks the other — the folder's
   * money and the folder's contents are independent, so waiting for the slower one
   * would blank the panel for no reason.
   */
  const readFolder = useCallback(async () => {
    const [summaryResult, billPage] = await Promise.all([
      fetchFolderBillSummary(folder.id),
      fetchBills({ folderId: folder.id, page, pageSize: PAGE_SIZE }),
    ]);
    return { summaryResult, billPage };
  }, [folder.id, page]);

  /**
   * Commit a read, or record why it failed. Always ends by taking the spinner down,
   * so a failure cannot leave the panel spinning forever.
   */
  const commit = useCallback(
    (result: { summaryResult: FolderBillSummary; billPage: { rows: Bill[]; total: number } }) => {
      setSummary(result.summaryResult);
      setBills(result.billPage.rows);
      setBillTotal(result.billPage.total);
      setSummaryError(null);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    readFolder().then(
      (result) => {
        /* A response that arrives after the user has moved on is dropped. Writing it
           anyway would put page 1's bills back under a header that says page 2. */
        if (cancelled) return;
        commit(result);
      },
      (err: unknown) => {
        if (cancelled) return;
        setSummaryError(err instanceof Error ? err.message : "This folder could not be read.");
        setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [readFolder, commit]);

  /**
   * Re-read after something the user just did, showing the spinner while it happens.
   *
   * The click-driven path, so raising `loading` here responds to an action rather than
   * cascading a render. Clearing the error first matters: a stale message would sit
   * under the spinner and come back describing the PREVIOUS failure.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    setSummaryError(null);
    try {
      commit(await readFolder());
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "This folder could not be read.");
      setLoading(false);
    }
  }, [readFolder, commit]);

  /**
   * No pruning of the selection against the loaded page.
   *
   * An earlier version dropped ids not present on the current page, which is wrong in
   * two ways at once: it cost an extra render on every load, and it cannot tell "this
   * bill was removed from the folder" from "this bill is on page 2" — so a selection
   * made on page 1 was silently discarded the moment page 2 loaded.
   *
   * Instead the selection is only ever cleared by the actions that could invalidate
   * it, and those clear it completely: `handleRemoveSelected`, `handleMove` and
   * `handleEmpty` all `setSelected([])` once the database has confirmed the change.
   * So the count on the bar is always the number the user is about to act on.
   */

  useEffect(() => {
    void fetchBillingFolders()
      .then((all) => setDestinations(all.filter((f) => f.id !== folder.id)))
      .catch(() => setDestinations([]));
  }, [folder.id]);

  /**
   * Turn the page.
   *
   * Raises `loading` first, because the effect that follows the page change calls
   * `load`, which no longer does. The spinner therefore appears on the click rather
   * than waiting for the request to be issued.
   */
  function goToPage(next: number) {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === page) return;
    setLoading(true);
    setPage(clamped);
  }

  const totalPages = Math.max(1, Math.ceil(billTotal / PAGE_SIZE));
  const allOnPageSelected = bills.length > 0 && bills.every((b) => selected.includes(b.id));

  async function handleRemoveSelected() {
    if (selected.length === 0) return;
    setBulk({
      title: "Removing bills from folder",
      subtitle: `${selected.length} ${selected.length === 1 ? "bill" : "bills"} · ${
        folder.name
      }`,
    });
    try {
      const res = await removeBillsFromBillingFolder(folder.id, selected);
      if (!res.ok) {
        notify("Nothing was removed", res.error ?? "Please try again.");
        return;
      }
      notify(
        `${res.changed} ${res.changed === 1 ? "bill" : "bills"} unfiled`,
        "The bills are still in All Bills — removing a bill from a folder never deletes it.",
      );
      setSelected([]);
      await refresh();
      await onChanged();
    } finally {
      setBulk(null);
    }
  }

  async function handleMove() {
    if (!moveTarget || selected.length === 0) return;
    const target = destinations.find((f) => f.id === moveTarget);
    if (!target) return;
    setBulk({
      title: "Moving bills",
      subtitle: `${selected.length} ${selected.length === 1 ? "bill" : "bills"} → ${target.name}`,
      progressLabel: "Moving",
      progress: { done: 0, total: selected.length },
    });
    try {
      const res = await moveBillsBetweenBillingFolders(
        folder.id,
        target.id,
        selected,
        (progress) => setBulk((prev) => (prev ? { ...prev, progress } : prev))
      );
      if (!res.ok) {
        notify("The move did not finish", res.error ?? "Please try again.");
        await refresh();
        await onChanged();
        return;
      }
      notify(`${res.changed} ${res.changed === 1 ? "bill" : "bills"} moved`, `Now in ${target.name}.`);
      setSelected([]);
      setMoveTarget(null);
      await refresh();
      await onChanged();
    } finally {
      setBulk(null);
    }
  }

  /**
   * Export this folder's summary to a PDF.
   *
   * It exports the `summary` already on screen — the one the scope note above is
   * describing — rather than re-reading the folder. That is what makes the exported
   * figures and the displayed figures the same numbers: there is only one of them.
   * The bill list is included when the folder is a single page, which is every
   * folder small enough to read; a larger one would export the figures alone, and
   * the button says so rather than quietly truncating the appendix.
   */
  async function handleExportSummary() {
    if (!summary) return;
    setExporting(true);
    try {
      await exportFolderSummaryPdf({
        folderName: folder.name,
        summary,
        bills: bills.length < billTotal ? undefined : bills,
      });
    } catch (err) {
      notify(
        "The summary was not exported",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleEmpty() {
    setConfirm(null);
    setBulk({ title: "Emptying billing folder", subtitle: folder.name });
    try {
      const res = await emptyBillingFolder(folder.id);
      if (!res.ok) {
        notify("The folder was not emptied", res.error ?? "Please try again.");
        return;
      }
      notify(
        "Folder emptied",
        `${res.bills_removed ?? 0} bills unfiled. The bills themselves are untouched.`,
      );
      setSelected([]);
      await refresh();
      await onChanged();
    } finally {
      setBulk(null);
    }
  }

  return (
    <>
      <View style={styles.detailHead}>
        <Text style={styles.detailCount}>
          {billTotal} {billTotal === 1 ? "bill" : "bills"}
        </Text>
        {billTotal > 0 && (
          <Text style={styles.detailNote}>
            Each bill is one invoice. Its original, duplicate and triplicate are three
            print copies of it and are counted once here.
          </Text>
        )}
      </View>

      <View style={styles.actionRow}>
        <Button
          title={exporting ? "Preparing…" : "Export summary"}
          onPress={() => void handleExportSummary()}
          variant="ghost"
          disabled={!summary || exporting}
        />
        <Button
          title="Empty folder"
          onPress={() => setConfirm({ kind: "empty" })}
          variant="ghost"
          disabled={billTotal === 0}
        />
      </View>

      {/* Said up front rather than discovered in the PDF: a paged folder exports its
          figures only, because the per-bill appendix would otherwise list just the
          current page and read as though it were the whole folder. */}
      {summary && bills.length < billTotal && (
        <Text style={styles.hintText}>
          The export will contain this folder&rsquo;s figures. Its {billTotal} bills span
          more than one page, so the per-bill list is left out rather than truncated.
        </Text>
      )}

      {summaryError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{summaryError}</Text>
          <Button title="Try again" onPress={() => void refresh()} variant="ghost" />
        </View>
      )}

      {loading && !summary && (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      )}

      {summary && (
        <>
          {/* Stated BEFORE the figures, not after: it is the scope of every number
              below it, so it has to be read first. */}
          <BillSummaryScopeNote summary={summary} />

          <SummarySection title="Totals" styles={styles}>
            <Figure label="Total quantity" value={formatQuantity(summary.total_quantity)} />
            <Figure label="Before tax" value={formatMoney(summary.total_amount_before_tax)} />
            <Figure label="CGST" value={formatMoney(summary.total_cgst)} />
            <Figure label="SGST" value={formatMoney(summary.total_sgst)} />
            <Figure label="IGST" value={formatMoney(summary.total_igst)} />
            <Figure label="GST" value={formatMoney(summary.total_gst)} />
            <Figure label="After tax" value={formatMoney(summary.total_amount_after_tax)} />
            <Figure label="Round off" value={formatMoney(summary.total_round_off)} />
          </SummarySection>

          <SummarySection title="Average per bill" styles={styles}>
            <Figure label="Quantity" value={formatQuantity(summary.average_quantity)} />
            <Figure label="Before tax" value={formatMoney(summary.average_amount_before_tax)} />
            <Figure label="CGST" value={formatMoney(summary.average_cgst)} />
            <Figure label="SGST" value={formatMoney(summary.average_sgst)} />
            <Figure label="IGST" value={formatMoney(summary.average_igst)} />
            <Figure label="GST" value={formatMoney(summary.average_gst)} />
            <Figure label="After tax" value={formatMoney(summary.average_bill_value)} />
          </SummarySection>

          <SummarySection title="Spread" styles={styles}>
            {/* No `total_bills === 0` guard is needed: a missing figure arrives as
                `null` and `formatMoney` already renders "—", which is both the
                empty-folder case and the no-bill-has-a-total case. */}
            <Figure label="Lowest bill" value={formatMoney(summary.min_amount_after_tax)} />
            <Figure label="Highest bill" value={formatMoney(summary.max_amount_after_tax)} />
            <Figure label="Lowest, before tax" value={formatMoney(summary.min_amount_before_tax)} />
            <Figure label="Highest, before tax" value={formatMoney(summary.max_amount_before_tax)} />
          </SummarySection>

          {/* No category is invented: these are the raw `bills.job_kind` values that
              actually exist in this folder, cleaned up for display only. */}
          {summary.job_kind_breakdown.length > 0 && (
            <SummarySection title="Bill breakdown" styles={styles}>
              {summary.job_kind_breakdown.map((bucket, index) => (
                <Figure
                  key={`${bucket.job_kind ?? "none"}-${index}`}
                  label={
                    bucket.job_kind ? formatJobKind(bucket.job_kind) ?? bucket.job_kind : "Unclassified"
                  }
                  value={`${bucket.count} ${
                    bucket.count === 1 ? "bill" : "bills"
                  }`}
                />
              ))}
            </SummarySection>
          )}
        </>
      )}

      <Text style={styles.sectionTitle}>Bills in this folder</Text>

      {bills.length > 0 && (
        <>
          <View style={styles.actionRow}>
            <Pressable
              onPress={() =>
                setSelected(allOnPageSelected ? [] : bills.map((b) => b.id))
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allOnPageSelected }}
              accessibilityLabel={
                allOnPageSelected
                  ? "Clear the selection in this folder"
                  : "Select every bill on this page in this folder"
              }
              style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
            >
              <View
                style={[
                  styles.checkbox,
                  allOnPageSelected && {
                    backgroundColor: theme.colors.primary,
                    borderColor: theme.colors.primary,
                  },
                ]}
              >
                {allOnPageSelected && <Text style={styles.checkboxTick}>✓</Text>}
              </View>
              <Text style={styles.actionTextSecondary}>
                {allOnPageSelected ? "Clear selection" : "Select all on this page"}
              </Text>
            </Pressable>
          </View>

          {selected.length > 0 && (
            <View style={styles.bulkBar} accessibilityLiveRegion="polite">
              <Text style={styles.bulkCount}>
                {selected.length} {selected.length === 1 ? "bill" : "bills"} selected
              </Text>
              <View style={styles.bulkActions}>
                <Pressable
                  onPress={() => void handleRemoveSelected()}
                  accessibilityRole="button"
                  accessibilityLabel="Remove the selected bills from this folder"
                  style={({ pressed }) => [styles.bulkBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.actionText}>Remove from folder</Text>
                </Pressable>
                <Pressable
                  onPress={() => setMoveTarget(moveTarget ? null : "choose")}
                  accessibilityRole="button"
                  accessibilityLabel="Move the selected bills to another billing folder"
                  style={({ pressed }) => [styles.bulkBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.actionText}>Move…</Text>
                </Pressable>
                <Pressable
                  onPress={() => setSelected([])}
                  accessibilityRole="button"
                  accessibilityLabel="Clear the selection"
                  style={({ pressed }) => [styles.bulkBtnGhost, pressed && styles.pressed]}
                >
                  <Text style={styles.actionTextSecondary}>Clear</Text>
                </Pressable>
              </View>

              {moveTarget && (
                <View style={styles.moveBox}>
                  {destinations.length === 0 ? (
                    <Text style={styles.warnNote}>
                      There is no other billing folder to move these into. Create one from
                      the folder list first.
                    </Text>
                  ) : (
                    destinations.map((dest) => (
                      <Pressable
                        key={dest.id}
                        onPress={() => setMoveTarget(dest.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: moveTarget === dest.id }}
                        accessibilityLabel={`Move into ${dest.name}`}
                        style={({ pressed }) => [styles.moveRow, pressed && styles.pressed]}
                      >
                        <Text style={styles.moveName}>{dest.name}</Text>
                        <Text style={styles.folderCount}>
                          {dest.bill_count} {dest.bill_count === 1 ? "bill" : "bills"}
                        </Text>
                      </Pressable>
                    ))
                  )}
                  <View style={styles.moveActions}>
                    <Button title="Move here" onPress={() => void handleMove()} disabled={!moveTarget} />
                    <Pressable
                      onPress={() => setMoveTarget(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel the move"
                      style={({ pressed }) => [pressed && styles.pressed]}
                    >
                      <Text style={styles.actionTextSecondary}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          )}

          {bills.map((bill) => {
            const isSelected = selected.includes(bill.id);
            const jobKind = formatJobKind(bill.job_kind);
            return (
              <View
                key={bill.id}
                style={[
                  styles.billCard,
                  isSelected && styles.billCardSelected,
                ]}
              >
                <Pressable
                  onPress={() =>
                    setSelected((prev) =>
                      prev.includes(bill.id)
                        ? prev.filter((x) => x !== bill.id)
                        : [...prev, bill.id]
                    )
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`Select bill ${bill.invoice_no || bill.sheet_name}`}
                  hitSlop={8}
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <View
                    style={[
                      styles.checkbox,
                      isSelected && {
                        backgroundColor: theme.colors.primary,
                        borderColor: theme.colors.primary,
                      },
                    ]}
                  >
                    {isSelected && <Text style={styles.checkboxTick}>✓</Text>}
                  </View>
                </Pressable>

                <Pressable
                  style={styles.billMain}
                  onPress={() => onOpenBill?.(bill.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open bill ${bill.invoice_no || bill.sheet_name}`}
                >
                  <Text style={styles.invoiceNo} numberOfLines={1}>
                    {bill.invoice_no || "No invoice number"}
                  </Text>
                  <Text style={styles.billSub} numberOfLines={1}>
                    {bill.party_name ? `${bill.party_name} · ` : ""}
                    {`${formatBillDate(bill.invoice_date)} · ${bill.original_filename}`}
                  </Text>
                  {jobKind && <Text style={styles.jobKindText}>{jobKind}</Text>}
                </Pressable>

                <View style={styles.amountCell}>
                  <Text style={styles.amountValue}>
                    {formatMoney(bill.amount_after_tax)}
                  </Text>
                  <Text style={styles.amountLabel}>
                    Qty {formatQuantity(bill.total_quantity)}
                  </Text>
                </View>
              </View>
            );
          })}

          {totalPages > 1 && (
            <View style={styles.actionRow}>
              <Button
                title="Previous"
                onPress={() => goToPage(page - 1)}
                variant="ghost"
                disabled={page <= 1}
              />
              <Text style={styles.pageNote}>
                Page {page} of {totalPages}
              </Text>
              <Button
                title="Next"
                onPress={() => goToPage(page + 1)}
                variant="ghost"
                disabled={page >= totalPages}
              />
            </View>
          )}
        </>
      )}

      {loading && bills.length === 0 && (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.primary} />
        </View>
      )}

      {!loading && bills.length === 0 && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>This folder is empty</Text>
          <Text style={styles.emptyText}>
            File bills into it from the Bills list, or use “File here” on the folder list.
          </Text>
        </View>
      )}

      <ConfirmDialog
        visible={!!confirm}
        title="Empty this folder?"
        message={`All ${billTotal} bills will be removed from "${folder.name}". The bills themselves are NOT deleted — they stay in All Bills with their print copies.`}
        confirmLabel="Empty folder"
        destructive
        busy={!!bulk}
        onConfirm={() => void handleEmpty()}
        onCancel={() => setConfirm(null)}
      />

      <BulkOperationOverlay operation={bulk} />
    </>
  );
}

/* ──────────────────────────────────────────────
   FORMATTING PIECES
   ────────────────────────────────────────────── */

type SheetStyles = ReturnType<typeof createStyles>;

function SummarySection({
  title,
  styles,
  children,
}: {
  title: string;
  styles: SheetStyles;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.summarySection}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * One label / value line.
 *
 * No maths here: `value` is always a figure that already came out of the summary RPC.
 */
function Figure({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.figureRow}>
      <Text style={styles.figureLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.figureValue}>{value}</Text>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.background },
    pressed: { opacity: 0.6 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.sm,
    },
    headerTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "700",
      textAlign: "center",
    },
    headerSpacer: { width: 64 },
    backText: { color: theme.colors.primary, fontSize: theme.textSizes.sm, fontWeight: "600" },
    content: { padding: theme.spacing.md, gap: theme.spacing.sm, paddingBottom: theme.spacing.xl },
    centered: { paddingVertical: theme.spacing.lg, alignItems: "center" },

    /* Folder list */
    createRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
    createInput: { flex: 1 },
    folderRow: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    folderMain: { gap: 2 },
    folderName: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "600" },
    folderCount: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs },
    folderActions: { flexDirection: "row", gap: theme.spacing.md, alignItems: "center" },
    renameRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
    pendingBanner: {
      backgroundColor: theme.colors.primaryMuted,
      borderRadius: theme.radius.md,
      padding: theme.spacing.md,
      gap: 2,
    },
    pendingText: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
    },
    pendingHint: { color: theme.colors.textSecondary, fontSize: theme.textSizes.xs },

    /* Opened folder */
    detailHead: { gap: 2 },
    detailCount: { color: theme.colors.text, fontSize: theme.textSizes.lg, fontWeight: "700" },
    detailNote: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs },
    summarySection: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
    },
    sectionTitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginBottom: theme.spacing.xs,
    },
    figureRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing.md,
      paddingVertical: 3,
    },
    figureLabel: { flex: 1, color: theme.colors.textSecondary, fontSize: theme.textSizes.sm },
    figureValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "600",
      fontVariant: ["tabular-nums"],
    },
    warnNote: { color: theme.colors.warning, fontSize: theme.textSizes.xs },
    /* Not a warning: this describes what the export will contain. */
    hintText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      lineHeight: 16,
      marginBottom: theme.spacing.xs,
    },

    /* Bills inside the folder */
    billCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
    },
    billCardSelected: { borderColor: theme.colors.primary },
    billMain: { flex: 1, gap: 2 },
    invoiceNo: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "600" },
    billSub: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs },
    jobKindText: { color: theme.colors.textSecondary, fontSize: theme.textSizes.xs },
    amountCell: { alignItems: "flex-end" },
    amountValue: {
      color: theme.colors.text,
      fontSize: theme.textSizes.sm,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    amountLabel: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs },

    /* Selection + bulk actions */
    checkRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxTick: { color: theme.colors.primaryButtonText, fontSize: 13, fontWeight: "700" },
    actionRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
    pageNote: { color: theme.colors.textMuted, fontSize: theme.textSizes.xs },
    bulkBar: {
      backgroundColor: theme.colors.surfaceSecondary,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    bulkCount: { color: theme.colors.text, fontSize: theme.textSizes.sm, fontWeight: "700" },
    bulkActions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
    bulkBtn: {
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.primary,
    },
    bulkBtnGhost: { paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.sm },
    moveBox: {
      gap: theme.spacing.xs,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingTop: theme.spacing.sm,
    },
    moveRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: theme.spacing.sm,
    },
    moveName: { color: theme.colors.text, fontSize: theme.textSizes.sm },
    moveActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },

    /* Messages */
    errorBox: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.danger,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    errorText: { color: theme.colors.danger, fontSize: theme.textSizes.sm },
    emptyBox: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.lg,
      gap: theme.spacing.xs,
    },
    emptyTitle: { color: theme.colors.text, fontSize: theme.textSizes.md, fontWeight: "600" },
    emptyText: { color: theme.colors.textMuted, fontSize: theme.textSizes.sm },

    actionText: { color: theme.colors.primaryButtonText, fontSize: theme.textSizes.xs, fontWeight: "700" },
    actionTextSecondary: { color: theme.colors.textSecondary, fontSize: theme.textSizes.xs, fontWeight: "600" },
    actionTextDanger: { color: theme.colors.danger, fontSize: theme.textSizes.xs, fontWeight: "700" },
  });
}