// src/services/auditLog.ts
import { supabase } from "./supabase";

export interface AuditLogEntry {
  /** WHO: the acting admin. When omitted, the current session user is used. */
  actorId?: string;
  actorUsername?: string;
  /** WHAT, e.g. "user.created", "folder.renamed", "dispatch.status_changed". */
  action: string;
  /** TARGET: e.g. "user", "folder", "folder_item", "job", "dispatch", "stock", "group". */
  targetType: string;
  targetId?: string | null;
  /** Optional extra context (before/after values, counts, ids). */
  detail?: Record<string, unknown>;
}

/**
 * Best-effort audit log writer backed by the real `admin_audit_log` table
 * (see supabase/migrations/0003_admin_audit_log.sql).
 *
 * Design rules:
 *  - Never throws, never blocks, never fails a mutation. The audit trail must
 *    not be able to break real operations.
 *  - Runs async in the background (`void logAudit(...)`) at call sites so the
 *    main mutation's response never waits on it.
 *  - If the table doesn't exist yet (migration pending) the write is skipped
 *    with a console.warn — callers are unaffected.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUser = sessionData.session?.user ?? null;

    const row = {
      actor_id: entry.actorId ?? sessionUser?.id ?? null,
      actor_username: entry.actorUsername ?? sessionUser?.user_metadata?.username ?? null,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      detail: entry.detail ?? null,
    };

    const { error } = await supabase.from("admin_audit_log").insert(row);
    if (error) {
      // Expected when the migration is not applied yet — never surface.
      console.warn("Audit log write skipped:", error.message);
    }
  } catch (err) {
    console.warn(
      "Audit log write skipped:",
      err instanceof Error ? err.message : String(err)
    );
  }
}