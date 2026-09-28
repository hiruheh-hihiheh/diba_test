-- Migration: admin audit/activity log.
--
-- A real backend audit trail for admin actions (WHO did WHAT to WHICH TARGET
-- and WHEN). The admin UI never fabricates log entries client-side; every row
-- is written here by the app's best-effort helper (src/services/auditLog.ts).
--
--   WHO     -> actor_id (the admin's auth uid, FK, ON DELETE SET NULL) +
--              actor_username (denormalized so the row survives even usefully
--              after a user is deleted)
--   WHAT    -> action            e.g. 'user.created', 'folder.renamed'
--   WHEN    -> created_at (defaults to now())
--   TARGET  -> target_type + target_id (+ an optional detail jsonb payload)
--
-- The writes are best-effort from the client: if this table does not exist yet
-- (migration not applied), operations continue silently.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_username text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Common lookups: recent activity, activity for one target, one actor.
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
  ON admin_audit_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
  ON admin_audit_log (actor_id);

-- Anon/public keys are not allowed to read or write the trail; only the
-- authenticated user writing rows and RLS keeping it to their own... nothing:
-- rows are visible only via a service-role admin surface today, so default to
-- deny-all for direct table access until an admin read path exists.
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_no_public_access" ON admin_audit_log;
CREATE POLICY "audit_log_no_public_access"
  ON admin_audit_log
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- The app inserts via the anon-key client with the user's JWT; allow
-- authenticated users to insert (that is the documented best-effort path) but
-- still deny reads/writes/updates so a compromised session cannot tamper or
-- read the trail over the public API.
DROP POLICY IF EXISTS "audit_log_authenticated_insert" ON admin_audit_log;
CREATE POLICY "audit_log_authenticated_insert"
  ON admin_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

DROP POLICY IF EXISTS "audit_log_deny_authenticated_read" ON admin_audit_log;
CREATE POLICY "audit_log_deny_authenticated_read"
  ON admin_audit_log
  FOR SELECT
  TO authenticated
  USING (false);