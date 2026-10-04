// src/services/billJobConnections.ts
//
// Data access for the Bill ↔ Job relationship.
//
// Mirrors the rules `src/services/bills.ts` states for itself: everything here uses
// the signed-in admin's own session key, never a service role, and every read and
// write is gated by the database as well — so a worker token is refused by RLS and
// by the functions' own active-admin re-check rather than merely hidden in the UI.
//
// WHY EVERY WRITE IS AN RPC
// `bill_job_connections` grants `authenticated` SELECT and nothing else (migration
// 0013), so a link cannot be written from the client directly even by an active
// admin. Every mutation goes through a SECURITY DEFINER function that validates
// both endpoints, re-checks the caller and runs as one transaction. That is what
// makes a six-job bulk link one round trip that either fully applies or does not.
//
// WHY THE ID LISTS ARE DEDUPED HERE AS WELL AS IN SQL
// The functions absorb duplicates, but the COUNT the UI reports after a bulk link is
// built from what it sent, so a duplicated id would otherwise be reported as two
// jobs linked when only one row exists.

import { supabase } from "../lib/supabase";
import { logAudit } from "./auditLog";
import type {
  BillConnectionCount,
  BillJobConnection,
  JobBillConnection,
  JobConnectionCount,
  LinkOutcome,
  UnlinkOutcome,
} from "../types/billJobConnections";

/** Stable, de-duplicated, order-preserving. */
const uniqueIds = (ids: string[]): string[] => [...new Set(ids.filter(Boolean))];

/** Narrow a Supabase error to something worth showing an admin. */
function messageOf(error: { message: string } | null, fallback: string): string {
  return error?.message?.trim() || fallback;
}

/**
 * The jobs linked to one bill.
 *
 * Returns labour and with-material jobs together, ordered by type then job_no by the
 * function, because the caller splits them into tabs and needs the type to do that.
 */
export async function getBillConnections(billId: string): Promise<BillJobConnection[]> {
  if (!billId) return [];
  const { data, error } = await supabase.rpc("get_bill_job_connections", {
    p_bill_id: billId,
  });
  if (error) throw new Error(messageOf(error, "Could not read this bill's linked jobs."));
  return (data ?? []) as BillJobConnection[];
}

/**
 * The bills linked to the given jobs.
 *
 * `jobIds` is the set of rows the page currently has in hand — the visible page, not
 * the whole database — so a table with hundreds of jobs never asks for connections
 * to rows nobody can see.
 */
export async function getJobConnections(jobIds: string[]): Promise<JobBillConnection[]> {
  const ids = uniqueIds(jobIds);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc("get_job_bill_connections", {
    p_job_ids: ids,
  });
  if (error) throw new Error(messageOf(error, "Could not read these jobs' linked bills."));
  return (data ?? []) as JobBillConnection[];
}

/**
 * How many bills each job is linked to.
 *
 * Returns a plain Map rather than a Record keyed by id so a lookup for a job that was
 * never counted is `undefined`, which is honest, rather than a `0` produced by `??`
 * that would be indistinguishable from a genuine zero.
 */
export async function getJobConnectionCounts(
  jobIds: string[]
): Promise<Map<string, number>> {
  const ids = uniqueIds(jobIds);
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const { data, error } = await supabase.rpc("get_job_connection_counts", {
    p_job_ids: ids,
  });
  if (error) throw new Error(messageOf(error, "Could not read connection counts."));
  for (const row of (data ?? []) as JobConnectionCount[]) {
    counts.set(row.job_id, Number(row.connection_count ?? 0));
  }
  return counts;
}

/** How many jobs each bill is linked to, split by job type. */
export async function getBillConnectionCounts(
  billIds: string[]
): Promise<Map<string, { total: number; labour: number; withMaterial: number }>> {
  const ids = uniqueIds(billIds);
  const counts = new Map<string, { total: number; labour: number; withMaterial: number }>();
  if (ids.length === 0) return counts;
  const { data, error } = await supabase.rpc("get_bill_connection_counts", {
    p_bill_ids: ids,
  });
  if (error) throw new Error(messageOf(error, "Could not read connection counts."));
  for (const row of (data ?? []) as BillConnectionCount[]) {
    counts.set(row.bill_id, {
      total: Number(row.connection_count ?? 0),
      labour: Number(row.labour_count ?? 0),
      withMaterial: Number(row.with_material_count ?? 0),
    });
  }
  return counts;
}

/** What a bulk link actually did, so the toast can say "linked 4, already linked 2". */
export interface LinkResult {
  linked: number;
  alreadyLinked: number;
  /** The pairs that were already there, for the caller to name if it wants to. */
  alreadyLinkedJobIds: string[];
}

/**
 * Link jobs to one bill. Idempotent — an existing pair is left alone.
 *
 * One call for the whole batch, not one per job: six jobs is one request and one
 * transaction, so a failure halfway through leaves nothing behind.
 */
export async function linkJobsToBill(billId: string, jobIds: string[]): Promise<LinkResult> {
  const ids = uniqueIds(jobIds);
  if (!billId || ids.length === 0) {
    throw new Error("Choose a bill and at least one job.");
  }

  const { data, error } = await supabase.rpc("link_bill_jobs", {
    p_bill_id: billId,
    p_job_ids: ids,
  });
  if (error) throw new Error(messageOf(error, "Could not link these jobs to the bill."));

  const rows = (data ?? []) as LinkOutcome[];
  const alreadyLinkedJobIds = rows.filter((r) => !r.linked).map((r) => r.job_id);

  /* Ids and counts only. A connection is a relationship, not a financial fact, and
     the audit trail is readable by other admins — so the invoice number, the party
     and every amount stay out of it. */
  void logAudit({
    action: "bill_job_connections.created",
    targetType: "bill_job_connections",
    targetId: billId,
    detail: {
      jobCount: ids.length,
      newlyLinked: rows.length - alreadyLinkedJobIds.length,
      alreadyLinked: alreadyLinkedJobIds.length,
      jobIds: ids,
    },
  });

  return {
    linked: rows.length - alreadyLinkedJobIds.length,
    alreadyLinked: alreadyLinkedJobIds.length,
    alreadyLinkedJobIds,
  };
}

/** Remove given job links from one bill. Bills and jobs are never touched. */
export async function unlinkJobsFromBill(
  billId: string,
  jobIds: string[]
): Promise<{ unlinked: number }> {
  const ids = uniqueIds(jobIds);
  if (!billId || ids.length === 0) return { unlinked: 0 };

  const { data, error } = await supabase.rpc("unlink_bill_jobs", {
    p_bill_id: billId,
    p_job_ids: ids,
  });
  if (error) throw new Error(messageOf(error, "Could not unlink these jobs."));

  const rows = (data ?? []) as UnlinkOutcome[];
  const unlinked = rows.filter((r) => r.unlinked).length;

  void logAudit({
    action: "bill_job_connections.deleted",
    targetType: "bill_job_connections",
    targetId: billId,
    detail: { jobCount: ids.length, unlinked, jobIds: ids },
  });

  return { unlinked };
}

/**
 * Remove the links formed by the cross product of two id lists.
 *
 * The bill page needs this to take one job out of several selected bills at once;
 * the job page uses it to drop a single bill from a single job without disturbing
 * that job's links to any other bill.
 */
export async function unlinkConnections(
  jobIds: string[],
  billIds: string[]
): Promise<{ unlinked: number }> {
  const jobs = uniqueIds(jobIds);
  const bills = uniqueIds(billIds);
  if (jobs.length === 0 || bills.length === 0) return { unlinked: 0 };

  const { data, error } = await supabase.rpc("unlink_job_bill_links", {
    p_job_ids: jobs,
    p_bill_ids: bills,
  });
  if (error) throw new Error(messageOf(error, "Could not unlink these connections."));

  const rows = (data ?? []) as { job_id: string; bill_id: string }[];

  void logAudit({
    action: "bill_job_connections.deleted",
    targetType: "bill_job_connections",
    detail: { unlinked: rows.length, jobIds: jobs, billIds: bills },
  });

  return { unlinked: rows.length };
}