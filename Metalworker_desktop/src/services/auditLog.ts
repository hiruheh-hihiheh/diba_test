// src/services/auditLog.ts
//
// Audit-trail writer for the desktop app, mirroring the admin app's helper
// (Metalworker_admin/src/services/auditLog.ts) so every admin action is
// recorded in the same `admin_audit_log` table with the same shape.
//
// Design rules (identical to the admin implementation):
//  - Never throws, never blocks, never fails a mutation. The audit trail must
//    not be able to break real operations.
//  - Call sites fire it as `void logAudit(...)` so the mutation's response
//    never waits on the audit write.
//  - If the table does not exist yet (migration pending) the write is skipped
//    with a console.warn and callers are unaffected.
//
// Security: the `admin_audit_log` INSERT policy (migration 0003) only accepts a
// row whose actor_id is the caller's own uid AND whose caller is an active
// admin, so this client cannot be used to forge another user's audit events.
import { supabase } from "../lib/supabase";

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
      // Almost always "relation does not exist" while migration 0003 is
      // pending. Never surfaced to the user; the mutation already succeeded.
      console.warn("[Audit] log skipped:", error.message);
    }
  } catch (err) {
    console.warn(
      "[Audit] log skipped:",
      err instanceof Error ? err.message : String(err)
    );
  }
}
