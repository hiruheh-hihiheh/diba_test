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
-- SECURITY: only an authenticated ACTIVE ADMIN may insert a row, and the row
-- must claim the caller's own actor_id (auth.uid()). Workers/processors
-- cannot forge audit events through the public API, and nobody can read the
-- trail over the public API (a read surface is service-role only).
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

-- RLS: anon can neither read nor write the trail.
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_no_public_access" ON admin_audit_log;
CREATE POLICY "audit_log_no_public_access"
  ON admin_audit_log
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- Writing is restricted to the caller being an active admin, so a worker or
-- processor session can never write a forged "who" or "what" into the trail.
-- The subquery reads profiles subject to its own RLS: a non-admin is either
-- not allowed to see admin profiles (=> no row => insert rejected) or is an
-- admin themselves (=> row found => allowed). actor_id must equal auth.uid(),
-- so no one can attribute an event to a different user.
DROP POLICY IF EXISTS "audit_log_authenticated_insert" ON admin_audit_log;
DROP POLICY IF EXISTS "audit_log_admin_insert" ON admin_audit_log;
CREATE POLICY "audit_log_admin_insert"
  ON admin_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'admin'
        AND p.is_active = true
    )
  );

-- No public read path: the trail is only readable with the service role (or a
-- future admin-only view/edge function that verifies the caller).
DROP POLICY IF EXISTS "audit_log_deny_authenticated_read" ON admin_audit_log;
CREATE POLICY "audit_log_deny_authenticated_read"
  ON admin_audit_log
  FOR SELECT
  TO authenticated
  USING (false);