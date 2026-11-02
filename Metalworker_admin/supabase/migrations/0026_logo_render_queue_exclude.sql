-- Migration: allow the logo render queue to skip already-attempted failures.
--
-- The queue returns bills whose logo_rendered_logo_id differs from logo_id.
-- A permanently failing bill stays in that queue forever, so a caller that
-- simply pages through the oldest rows would re-read the same failures on every
-- invocation and never reach the bills behind them. Adding an optional exclude
-- list lets one processing run skip the IDs it has already attempted and failed,
-- while leaving them retryable by a later run that does not exclude them.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_bills_needing_logo_render(
    p_limit integer DEFAULT 100,
    p_exclude uuid[] DEFAULT NULL
)
RETURNS TABLE (
    id            uuid,
    bill_upload_id uuid,
    logo_id       uuid,
    has_logo      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.id, b.bill_upload_id, b.logo_id, b.logo_id IS NOT NULL AS has_logo
    FROM public.bills b
    WHERE b.logo_rendered_logo_id IS DISTINCT FROM b.logo_id
      AND (p_exclude IS NULL OR NOT (b.id = ANY (p_exclude)))
      AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role = 'admin' AND p.is_active = true
          )
    -- Oldest invoice first, so a backlog drains from the beginning rather than
    -- re-printing the same recent rows on every pass.
    ORDER BY b.invoice_date NULLS LAST, b.created_at
    LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

REVOKE ALL ON FUNCTION public.list_bills_needing_logo_render(integer, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.list_bills_needing_logo_render(integer, uuid[]) TO authenticated;

COMMIT;