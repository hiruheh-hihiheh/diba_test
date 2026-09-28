// src/services/counts.ts
import { supabase } from "./supabase";

/**
 * Lightweight "control center" statistics for the admin dashboard.
 *
 * Every value is derived from real rows in the existing backend using
 * `head: true` + `count: "exact"` so the requests download zero rows — no
 * large datasets are pulled just to show a number.
 */

export interface SystemCounts {
  users: number;
  labour: number;
  processors: number;
  activeUsers: number;
  jobs: number;
  jobsLabour: number;
  jobsWithMaterial: number;
  folders: number;
  ownerStock: number;
  companyStock: number;
  billGroups: number;
  drawingGroups: number;
  dispatches: number;
}

async function countRows(
  table: string,
  column?: string,
  value?: string | number | boolean
): Promise<number> {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  if (column !== undefined && value !== undefined) {
    query = query.eq(column, value);
  }
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchSystemCounts(): Promise<SystemCounts> {
  const [
    users,
    labour,
    processors,
    activeUsers,
    jobs,
    jobsLabour,
    jobsWithMaterial,
    folders,
    ownerStock,
    companyStock,
    billGroups,
    drawingGroups,
    dispatches,
  ] = await Promise.all([
    countRows("profiles"),
    countRows("profiles", "role", "worker"),
    countRows("profiles", "role", "processor"),
    countRows("profiles", "is_active", true),
    countRows("jobs"),
    countRows("jobs", "job_type", "labour"),
    countRows("jobs", "job_type", "with_material"),
    countRows("admin_folders"),
    countRows("owner_stock"),
    countRows("company_stock"),
    countRows("bill_groups"),
    countRows("drawing_groups"),
    countRows("dispatches"),
  ]);

  return {
    users,
    labour,
    processors,
    activeUsers,
    jobs,
    jobsLabour,
    jobsWithMaterial,
    folders,
    ownerStock,
    companyStock,
    billGroups,
    drawingGroups,
    dispatches,
  };
}