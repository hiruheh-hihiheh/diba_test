// src/services/billingFolders.ts
//
// The Billing section's OWN folder workspace.
//
// WHY THIS EXISTS BESIDE `folders.ts`
// `admin_folders` is one table serving Labour folders, With Metal folders, general
// job folders and (new) Billing folders. That reuse is deliberate — no second
// folder engine — but it means the BILLING rules cannot live in the generic
// helpers. They live here instead, in one file, so there is exactly one place
// that knows what a Billing folder is allowed to contain.
//
// WHAT A BILLING FOLDER IS
// A folder in the Billing section. It holds BILLS and nothing else. It is not a job
// folder: it never appears in the Jobs or Folders lists, a labour job cannot be
// dropped into it, and a worker cannot see it.
//
// HOW THE SEPARATION IS ENFORCED
// Three layers, deliberately, because the failure is a quietly wrong financial
// summary and not a crash:
//
//   1. `folder_type = 'billing'` marks the folder (migration 0009). The job-folder
//      screens already filter on `folder_type`, so billing folders stay out of them
//      without a single change to those screens.
//   2. The database refuses a non-bill item in a billing folder — the
//      `enforce_billing_folder_items` trigger. This is the layer that actually
//      holds, because it also covers the other two apps.
//   3. `assertBillingFolder` below checks the kind in the client before writing, so
//      the user gets a sentence instead of a Postgres error.
//
// NOTHING HERE TOUCHES A BILL
// Removing a bill from a folder, emptying a folder and deleting a folder all delete
// `folder_items` LINK rows only. A `bills` row, its line items and its three PDFs
// are untouched. Deleting an invoice stays an explicit, separate operation
// (`deleteBill`), which is why this file does not import it.
//
// 1 physical invoice = 1 bill record = 3 printable PDF copies. The three copies are
// not folder items and are never counted separately — `bill_count` below is a count
// of distinct bill ids.

import { supabase } from "../lib/supabase";
import { logAudit } from "./auditLog";
import { fetchBillingFolderBillCounts } from "./bills";
import type { BulkProgress } from "../types/bill";
import { BILLING_FOLDER_KIND, type AdminFolder } from "../types/folder";

const FOLDERS = "admin_folders";
const ITEMS = "folder_items";

/**
 * How many rows one insert carries.
 *
 * A bulk add is chunked rather than sent as one giant insert so a "select all" over
 * 1000 bills does not become a single 1000-row statement that the connection has
 * to hold open. It also gives the caller's progress bar real steps to move through.
 */
const ADD_CHUNK = 500;

/** A Billing folder, with the one number the list screen needs. */
export interface BillingFolder extends AdminFolder {
  /**
   * How many DISTINCT bills it holds. 1 per physical invoice, never 3.
   *
   * Distinct from the number of PDFs: the three copies (original / duplicate /
   * triplicate) are stored on the bill and are not folder items at all.
   *
   * REQUIRED, not optional. It was optional at first, and that was a trap: a path that
   * forgot to set it would compile, and the list would read `undefined ?? 0` and show
   * "0 bills" for a folder holding 400 — with nothing failing anywhere. Making it
   * required means both read paths (the RPC and the fallback) are checked at compile
   * time, which is where the mistake would otherwise be found only by looking.
   */
  billCount: number;
}

/* ──────────────────────────────────────────────
   READING
   ────────────────────────────────────────────── */

/**
 * Every Billing folder, newest first, with its bill count.
 *
 * RPC-first, with a fallback — the same pattern `reorderFolderItems` already uses.
 * `get_billing_folder_bill_counts` (migration 0009) is the good path: it groups in
 * the database and returns one row per folder, so a workspace with 40 folders costs
 * one request instead of 41.
 *
 * The fallback exists because migration 0009 may not be applied yet on a given
 * environment, and a Billing screen that is simply empty because of a missing
 * function is indistinguishable from a broken one. The fallback reads the folders
 * and one set of link rows; counts are computed here, over DISTINCT bill ids, so
 * both paths agree on the number. If migration 0009 has been applied, the RPC is
 * used and this code does not run.
 */
export async function fetchBillingFolders(): Promise<BillingFolder[]> {
  const { data, error } = await supabase.rpc("get_billing_folder_bill_counts");

  if (!error) {
    const rows = Array.isArray(data) ? data : [];
    return rows.map((raw) => {
      const row = raw as {
        folder_id?: unknown;
        folder_name?: unknown;
        bill_count?: unknown;
        created_at?: unknown;
        updated_at?: unknown;
      };
      return {
        id: typeof row.folder_id === "string" ? row.folder_id : "",
        name: typeof row.folder_name === "string" ? row.folder_name : "",
        folder_type: BILLING_FOLDER_KIND,
        billCount: toCount(row.bill_count),
        created_at: typeof row.created_at === "string" ? row.created_at : "",
        updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
      } satisfies BillingFolder;
    });
  }

  const { data: folderRows, error: folderError } = await supabase
    .from(FOLDERS)
    .select("id, name, created_at, updated_at")
    .eq("folder_type", BILLING_FOLDER_KIND)
    .order("created_at", { ascending: false });

  if (folderError) throw new Error(folderError.message);

  const ids = ((folderRows ?? []) as { id: string }[]).map((r) => r.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: linkRows, error: linkError } = await supabase
      .from(ITEMS)
      .select("folder_id, item_id")
      .eq("item_type", "bill")
      .in("folder_id", ids);
    if (linkError) throw new Error(linkError.message);
    // A Set per folder, so a repeated link cannot inflate the fallback count either.
    const sets = new Map<string, Set<string>>();
    for (const row of (linkRows ?? []) as { folder_id: string; item_id: string }[]) {
      let set = sets.get(row.folder_id);
      if (!set) {
        set = new Set<string>();
        sets.set(row.folder_id, set);
      }
      set.add(row.item_id);
    }
    for (const [folderId, set] of sets) counts.set(folderId, set.size);
  }

  return ((folderRows ?? []) as AdminFolder[]).map((f) => ({
    ...f,
    folder_type: BILLING_FOLDER_KIND,
    billCount: counts.get(f.id) ?? 0,
  }));
}

/* ──────────────────────────────────────────────
   WRITING
   ────────────────────────────────────────────── */

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Confirm the target really is a Billing folder before writing to it.
 *
 * The database would reject a non-bill item in a billing folder with a raw Postgres
 * error, and a non-billing folder has no trigger at all — so without this check a
 * bug in a caller could quietly push bills into a job folder, where the Jobs screen
 * would then show them. One extra read turns that into a refusal with a reason.
 */
async function assertBillingFolder(folderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from(FOLDERS)
    .select("folder_type")
    .eq("id", folderId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  /* A missing folder reads the same as a wrong one. Reporting "not found" for a
     folder that was deleted a second ago is more useful than "wrong type". */
  if (!data) return { ok: false, error: "That billing folder no longer exists." };

  const kind = (data as { folder_type?: unknown }).folder_type;
  if (kind !== BILLING_FOLDER_KIND) {
    return {
      ok: false,
      error: "That is not a billing folder. Create the folder from the Billing section.",
    };
  }
  return { ok: true };
}

/**
 * Create a Billing folder.
 *
 * `folder_type: 'billing'` is the whole difference from a job folder, and it is set
 * here rather than exposed as a choice: the Billing section has no other kind of
 * folder to create.
 */
export async function createBillingFolder(
  name: string
): Promise<{ ok: boolean; data?: BillingFolder; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the folder a name." };

  const { data, error } = await supabase
    .from(FOLDERS)
    .insert({ name: trimmed, folder_type: BILLING_FOLDER_KIND })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const folder = data as AdminFolder;
  void logAudit({
    action: "billing_folder.created",
    targetType: "folder",
    targetId: folder.id,
    detail: { name: trimmed },
  });
  return { ok: true, data: { ...folder, billCount: 0 } };
}

export async function renameBillingFolder(
  id: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Give the folder a name." };

  const guard = await assertBillingFolder(id);
  if (!guard.ok) return guard;

  const { error } = await supabase.from(FOLDERS).update({ name: trimmed }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  void logAudit({
    action: "billing_folder.renamed",
    targetType: "folder",
    targetId: id,
    detail: { to: trimmed },
  });
  return { ok: true };
}

/**
 * Delete a Billing folder. THE BILLS SURVIVE.
 *
 * Only the folder's link rows are removed, then the folder itself. Every `bills`
 * row, its line items and its three PDFs are untouched — a bill that was filed under
 * "September Analysis" is still in All Bills, still editable, still printable, after
 * the folder is gone.
 *
 * `bills_detached` is returned so the confirmation can say what was unfiled instead
 * of the user having to wonder whether anything was lost.
 */
export async function deleteBillingFolder(
  id: string
): Promise<{ ok: boolean; error?: string; bills_detached?: number }> {
  const guard = await assertBillingFolder(id);
  if (!guard.ok) return guard;

  const { data: links, error: linkError } = await supabase
    .from(ITEMS)
    .select("item_id")
    .eq("folder_id", id)
    .eq("item_type", "bill");
  if (linkError) return { ok: false, error: linkError.message };

  const billsDetached = new Set(((links ?? []) as { item_id: string }[]).map((l) => l.item_id)).size;

  /* Links first, folder second, and the link error is surfaced rather than
     swallowed: deleting the folder first would cascade the links away and leave no
     way to report how many bills were in it. */
  const { error: unlinkError } = await supabase.from(ITEMS).delete().eq("folder_id", id);
  if (unlinkError) return { ok: false, error: unlinkError.message };

  const { error } = await supabase.from(FOLDERS).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  void logAudit({
    action: "billing_folder.deleted",
    targetType: "folder",
    targetId: id,
    detail: { bills_detached: billsDetached },
  });
  return { ok: true, bills_detached: billsDetached };
}

/**
 * Empty a Billing folder without deleting it. THE BILLS SURVIVE.
 *
 * The folder row is deliberately kept, so "Empty" and "Delete folder" cannot be
 * confused: emptying leaves the workspace and its name in place, deleting removes it.
 */
export async function emptyBillingFolder(
  id: string
): Promise<{ ok: boolean; error?: string; bills_removed?: number }> {
  const guard = await assertBillingFolder(id);
  if (!guard.ok) return guard;

  /* Restricted to `item_type = 'bill'` rather than deleting every link in the
     folder. A billing folder may only contain bills (migration 0009's trigger), so
     this matches everything — but scoping the statement to what the caller claims to
     be removing means a future relaxation of that rule cannot turn "empty this
     billing folder" into "delete something else". */
  const { data, error } = await supabase
    .from(ITEMS)
    .delete()
    .eq("folder_id", id)
    .eq("item_type", "bill")
    .select("item_id");

  if (error) return { ok: false, error: error.message };

  const removed = new Set(((data ?? []) as { item_id: string }[]).map((l) => l.item_id)).size;

  void logAudit({
    action: "billing_folder.emptied",
    targetType: "folder",
    targetId: id,
    detail: { bills_removed: removed },
  });
  return { ok: true, bills_removed: removed };
}

/* ──────────────────────────────────────────────
   MEMBERSHIP
   ────────────────────────────────────────────── */

/** What one bulk membership change achieved. */
export interface BulkFolderResult {
  ok: boolean;
  error?: string;
  /** Bills actually linked (add) or unlinked (remove). */
  changed: number;
  /**
   * Bills that were already where they were being put, so nothing to do.
   *
   * Reported rather than treated as a failure: adding 50 bills to a folder that
   * already holds 3 of them must file the other 47, not refuse all 50. A number the
   * user can see is better than a silent skip.
   */
  skipped: number;
}

/**
 * Add bills to a Billing folder, reporting real progress.
 *
 * Idempotent per bill, and chunked. Progress is real in the same sense the bulk
 * delete's is: `done` counts links the database has actually accepted, and each
 * chunk is a completed request, so "Filing 500 / 1,240" is never ahead of the work.
 */
export async function addBillsToBillingFolder(
  folderId: string,
  billIds: string[],
  onProgress?: (progress: BulkProgress) => void
): Promise<BulkFolderResult> {
  if (billIds.length === 0) return { ok: true, changed: 0, skipped: 0 };

  const guard = await assertBillingFolder(folderId);
  if (!guard.ok) return { ok: false, changed: 0, skipped: 0, error: guard.error };

  // Already-present bills are filtered out here so the unique index never has to
  // raise, which also means `skipped` is a real count rather than an error path.
  const { data: existing, error: readError } = await supabase
    .from(ITEMS)
    .select("item_id")
    .eq("folder_id", folderId)
    .eq("item_type", "bill")
    .in("item_id", billIds);

  if (readError) return { ok: false, changed: 0, skipped: 0, error: readError.message };

  const present = new Set(((existing ?? []) as { item_id: string }[]).map((r) => r.item_id));
  const wanted = [...new Set(billIds)].filter((id) => !present.has(id));
  const skipped = billIds.length - wanted.length;

  let done = 0;
  onProgress?.({ done, total: billIds.length });

  for (let at = 0; at < wanted.length; at += ADD_CHUNK) {
    const chunk = wanted.slice(at, at + ADD_CHUNK);

    const { error } = await supabase.from(ITEMS).insert(
      chunk.map((itemId, index) => ({
        folder_id: folderId,
        item_type: "bill",
        item_id: itemId,
        // Position is display order within the folder only. Continuing from the
        // chunk's own offset keeps this insert self-consistent without a second read
        // for the current maximum, which matters when the read would race an insert
        // from another session anyway.
        position: at + index,
      }))
    );

    if (error) {
      /* A partial add is reported as a partial add. Whatever went in stays in, and
         the caller refreshes so the screen shows the real state — which is the same
         contract the bulk delete follows. */
      return {
        ok: false,
        changed: done,
        skipped,
        error:
          done > 0
            ? `${done} bills were filed before the error: ${error.message}`
            : error.message,
      };
    }

    done += chunk.length;
    onProgress?.({ done, total: billIds.length });
  }

  void logAudit({
    action: "billing_folder.bills_added",
    targetType: "folder",
    targetId: folderId,
    detail: { changed: done, skipped },
  });
  return { ok: true, changed: done, skipped };
}

/**
 * Remove bills from a Billing folder. THE BILLS SURVIVE.
 *
 * This is deliberately a different function from deleting a bill, and the names keep
 * them apart in the UI too: this unlinks, `deleteBill` destroys. The only rows
 * touched are the link rows.
 */
export async function removeBillsFromBillingFolder(
  folderId: string,
  billIds: string[]
): Promise<BulkFolderResult> {
  if (billIds.length === 0) return { ok: true, changed: 0, skipped: 0 };

  const guard = await assertBillingFolder(folderId);
  if (!guard.ok) return { ok: false, changed: 0, skipped: 0, error: guard.error };

  const { data, error } = await supabase
    .from(ITEMS)
    .delete()
    .eq("folder_id", folderId)
    .eq("item_type", "bill")
    .in("item_id", billIds)
    .select("item_id");

  if (error) return { ok: false, changed: 0, skipped: 0, error: error.message };

  const changed = new Set(((data ?? []) as { item_id: string }[]).map((r) => r.item_id)).size;

  void logAudit({
    action: "billing_folder.bills_removed",
    targetType: "folder",
    targetId: folderId,
    detail: { changed, ids: billIds },
  });
  /* `skipped` is what was asked for but was not linked in the first place, so the
     two numbers add up to the request and the caller can report a clean total. */
  return { ok: true, changed, skipped: billIds.length - changed };
}

/**
 * Move bills from one Billing folder to another. THE BILLS SURVIVE.
 *
 * Add-then-remove, in that order, and the reason matters: if the add fails the bills
 * stay where they were, so a failed move loses nothing. Doing it the other way round
 * would unlink first and risk stranding bills outside every folder.
 *
 * A bill already in the destination is left there and simply dropped from the
 * source, which is what "move it to here" means when it is already here.
 */
export async function moveBillsBetweenBillingFolders(
  fromFolderId: string,
  toFolderId: string,
  billIds: string[],
  onProgress?: (progress: BulkProgress) => void
): Promise<BulkFolderResult> {
  if (fromFolderId === toFolderId) {
    return { ok: false, changed: 0, skipped: 0, error: "The bills are already in that folder." };
  }
  if (billIds.length === 0) return { ok: true, changed: 0, skipped: 0 };

  const added = await addBillsToBillingFolder(toFolderId, billIds);
  if (!added.ok) return added;

  onProgress?.({ done: added.changed, total: billIds.length });

  const removed = await removeBillsFromBillingFolder(fromFolderId, billIds);
  if (!removed.ok) {
    /* The add already succeeded, so this is a partial move, not a failed one: the
       bills are in BOTH folders now, and the message has to say so, because the
       user's next action is to fix it rather than retry blindly. */
    return {
      ok: false,
      changed: added.changed,
      skipped: added.skipped,
      error: `${added.changed} bills were copied into the new folder but could not be removed from the old one: ${removed.error}`,
    };
  }

  onProgress?.({ done: billIds.length, total: billIds.length });
  return { ok: true, changed: added.changed, skipped: added.skipped };
}

/* ──────────────────────────────────────────────
   COUNTS
   ────────────────────────────────────────────── */

/**
 * Bill count for the folder list, straight from the database.
 *
 * Re-exported from `bills.ts` so a caller that only needs the counts imports them
 * from the folder service alongside the rest of the Billing data. One implementation,
 * reached from one place.
 */
export { fetchBillingFolderBillCounts };