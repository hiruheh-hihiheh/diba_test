-- Migration: folder Bill Summary RPC.
--
-- When several bills are placed in one folder the folder must show a financial
-- summary. The one invariant that matters: ORIGINAL / DUPLICATE / TRIPLICATE
-- are three physical print copies of ONE bill and must never be counted as
-- three bills.
--
-- That is enforced structurally rather than by convention: the three copies
-- never become separate `bills` rows (see 0005), so this function sums the
-- `bills` rows behind the folder's 'bill' folder_items and counts each bill id
-- once. There is no multiplier anywhere in this file, and none can be added by
-- accident, because there is nothing to multiply by.
--
-- COUNT and SUM are both taken over the same DISTINCT set, so the count and the
-- totals can never disagree with each other.
--
-- Safe division: every average divides by NULLIF(count, 0), so a folder with no
-- bills yields NULL internally and 0 externally — never NaN or Infinity.
--
-- SECURITY: SECURITY DEFINER so it can see `bills` without the caller needing
-- extra grants, and it enforces the same active-admin rule as
-- set_primary_drawing (0002) and reorder_folder_items (0004) BEFORE reading any
-- data.
--
-- Apply with:  psql "$DATABASE_URL" -f 0006_folder_bill_summary.sql

CREATE OR REPLACE FUNCTION public.get_folder_bill_summary(p_folder_id uuid)
RETURNS TABLE (
    total_bills           bigint,
    total_quantity        numeric,
    amount_before_tax     numeric,
    cgst                  numeric,
    sgst                  numeric,
    igst                  numeric,
    total_gst             numeric,
    amount_after_tax      numeric,
    round_off             numeric,
    avg_bill_value        numeric,
    avg_quantity          numeric,
    avg_amount_before_tax numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_admin boolean;
    n_bills  bigint;
    v_qty    numeric := 0;
    v_abt    numeric := 0;
    v_cgst   numeric := 0;
    v_sgst   numeric := 0;
    v_igst   numeric := 0;
    v_gst    numeric := 0;
    v_aat    numeric := 0;
    v_round  numeric := 0;
BEGIN
    -- Authorization first: only an authenticated, active admin may read folder
    -- financial totals.
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role = 'admin'
          AND is_active = true
    ) INTO is_admin;

    IF NOT is_admin THEN
        RAISE EXCEPTION 'admin_required';
    END IF;

    IF p_folder_id IS NULL THEN
        RAISE EXCEPTION 'folder_id_required';
    END IF;

    -- One pass over a DE-DUPLICATED set of bills.
    --
    -- The 0001 uniqueness index on (folder_id, item_type, item_id) already makes
    -- a repeated reference impossible, but the DISTINCT is kept so the count and
    -- the sums are derived from the same set of rows. Without it a duplicated
    -- reference would inflate every total while the bill count stayed right -
    -- the one shape of bug a financial summary must not have.
    WITH unique_bills AS (
        SELECT DISTINCT
            b.id,
            b.total_quantity,
            b.amount_before_tax,
            b.cgst,
            b.sgst,
            b.igst,
            b.total_gst,
            b.amount_after_tax,
            b.round_off
        FROM public.folder_items fi
        JOIN public.bills b ON b.id = fi.item_id
        WHERE fi.folder_id = p_folder_id
          AND fi.item_type = 'bill'
    )
    SELECT
        count(*),
        coalesce(sum(coalesce(u.total_quantity, 0)), 0),
        coalesce(sum(coalesce(u.amount_before_tax, 0)), 0),
        coalesce(sum(coalesce(u.cgst, 0)), 0),
        coalesce(sum(coalesce(u.sgst, 0)), 0),
        coalesce(sum(coalesce(u.igst, 0)), 0),
        coalesce(sum(coalesce(u.total_gst, 0)), 0),
        coalesce(sum(coalesce(u.amount_after_tax, 0)), 0),
        coalesce(sum(coalesce(u.round_off, 0)), 0)
    INTO n_bills, v_qty, v_abt, v_cgst, v_sgst, v_igst, v_gst, v_aat, v_round
    FROM unique_bills u;

    total_bills       := n_bills;
    total_quantity    := v_qty;
    amount_before_tax := v_abt;
    cgst              := v_cgst;
    sgst              := v_sgst;
    igst              := v_igst;
    total_gst         := v_gst;
    amount_after_tax  := v_aat;
    round_off         := v_round;

    -- Safe division: NULLIF(n,0) makes an empty folder produce 0, not NaN.
    avg_bill_value        := coalesce(round(v_aat / NULLIF(n_bills, 0), 2), 0);
    avg_quantity          := coalesce(round(v_qty / NULLIF(n_bills, 0), 3), 0);
    avg_amount_before_tax := coalesce(round(v_abt / NULLIF(n_bills, 0), 2), 0);

    RETURN NEXT;
END;
$$;

-- Only authenticated users may call it; the active-admin check above runs before
-- any data is read.
REVOKE ALL ON FUNCTION public.get_folder_bill_summary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_folder_bill_summary(uuid) TO authenticated;
