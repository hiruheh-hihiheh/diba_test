// src/types/billJobConnections.ts
//
// Types for the Bill ↔ Job relationship.
//
// NOTHING HERE IS A COPY OF A BILL OR A JOB
// Every record below carries ids for both endpoints plus the label fields the UI has
// to draw. Those labels are read from the real `bills` / `jobs` rows at query time by
// the functions in migration 0013 — they are not stored on the link and cannot drift.
// The one derived field, `label`, is computed by the database so the wire layer and
// the popover cannot each invent their own idea of what a bill is called.

import type { JobType } from "./job";

/** One job linked to one bill, as `get_bill_job_connections` returns it. */
export interface BillJobConnection {
  job_id: string;
  job_no: string | null;
  job_type: JobType;
  job_given_date: string | null;
  tool_description: string | null;
  tool_part: string | null;
  quantity: string | null;
  status: string | null;
  /** When the LINK was made. Not the job's created_at. */
  linked_at: string;
  /** The admin who made the link, or null if that profile has been deleted. */
  linked_by: string | null;
}

/** One bill linked to one job, as `get_job_bill_connections` returns it. */
export interface JobBillConnection {
  job_id: string;
  bill_id: string;
  invoice_no: string | null;
  party_name: string | null;
  sheet_name: string | null;
  job_kind: string | null;
  /** invoice_no, else sheet_name, else "this bill" — decided by the database. */
  label: string;
  linked_at: string;
  linked_by: string | null;
}

/** `get_job_connection_counts` — one row per requested job id, zero included. */
export interface JobConnectionCount {
  job_id: string;
  connection_count: number;
}

/** `get_bill_connection_counts` — one row per requested bill id, zero included. */
export interface BillConnectionCount {
  bill_id: string;
  connection_count: number;
  labour_count: number;
  with_material_count: number;
}

/** One row of `link_bill_jobs`: was this pair created, or did it already exist? */
export interface LinkOutcome {
  job_id: string;
  linked: boolean;
}

/** One row of `unlink_bill_jobs`. */
export interface UnlinkOutcome {
  job_id: string;
  unlinked: boolean;
}

/**
 * Everything one job's wires need, in the shape the SVG layer consumes.
 *
 * Grouped per job rather than kept as a flat list because the wire layer draws one
 * path per (job, bill) pair and needs both endpoints of a pair together; a flat list
 * would make it re-group on every frame.
 */
export interface JobConnections {
  count: number;
  bills: JobBillConnection[];
}

/**
 * "2 Bills" / "1 Bill" / "—".
 *
 * The count is rendered as TEXT and not only as an icon on purpose: a connection
 * that is only visible as a coloured dot or a drawn wire is invisible to anyone
 * using a screen reader, and invisible to anyone reading the page with the wires
 * turned off.
 */
export function connectionCountLabel(count: number, noun = "Bill"): string {
  if (count <= 0) return "—";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Same, for a bill's job count, which reads better split by type. */
export function jobCountLabel(count: number): string {
  if (count <= 0) return "—";
  return `${count} Job${count === 1 ? "" : "s"}`;
}