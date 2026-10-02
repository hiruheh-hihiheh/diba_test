-- Migration: Billing summary — say explicitly WHICH bills each figure covers.
--
-- THE PROBLEM
-- A bill's financial columns are nullable by design (migration 0005: "a template
-- may legitimately omit a field"). A bill whose grand total was never imported
-- therefore has `amount_after_tax IS NULL`, and migration 0009's aggregation folded
-- that into the money with `sum(coalesce(x, 0))` while dividing every average by
-- `total_bills`. Two consequences, one of them a real defect:
--
--   * AVERAGES WERE DILUTED. A folder holding bills of ₹10,000 and ₹20,000 plus one
--     bill with no total reported "average bill value ₹10,000", because the missing
--     bill sat in the denominator. The true mean of the bills that HAVE totals is
--     ₹15,000. `avg_bill_value` must be a per-bill mean over bills with a valid
--     total, so the ₹10,000 figure was wrong, not merely differently-labelled.
--
--   * THE UI DESCRIBED BEHAVIOUR THE SQL DID NOT HAVE. Both clients render
--     "N of M bills have no recorded after-tax total, so the totals and averages
--     above leave them out". That was not true: the missing bills were counted IN
--     the averages. The database is the source of truth, so the SQL is what moves —
--     not the sentence.
--
-- WHAT CHANGES IN THE NUMBERS (read this before trusting an old figure)
--   * Money totals: UNCHANGED wherever the missing bills also had no money
--     recorded. `sum(coalesce(x,0))` over all bills equals `sum(x)` over valid
--     bills when an invalid bill's components are all null, so the common case
--     produces an identical total. What changes is the MEANING: a total now
--     describes only the bills whose totals are known.
--   * Money totals: CHANGE where an invoice recorded a PARTIAL total — e.g. a
--     before-tax amount parsed but the grand total did not. Under 0009 those
--     components were added to the folder total, so before-tax + GST + round-off
--     did not add up to after-tax. They are now excluded. A partial invoice no
--     longer inflates a folder's money.
--   * `average_bill_value` and every other MONEY average: CHANGE. Divided by the
--     count of bills with a valid total instead of the count of bills.
--   * `average_quantity`: UNCHANGED. See the population table below.
--   * `min_*` / `max_*`: now NULL instead of 0 when no bill has a figure. This is
--     the null-vs-zero fix: a folder where nothing has a total has no cheapest
--     bill, and "₹0.00" claimed that the cheapest bill was free.
--
-- THE POPULATION TABLE — every aggregate, and which bills it covers
-- The database has one aggregation function, so this list is exhaustive: there is
-- no second opinion anywhere, client or server.
--
--   all bills     = every distinct `bills` row linked to the folder.
--   valid bills   = all bills whose `amount_after_tax` IS NOT NULL, i.e. bills with
--                   a usable grand total. A stored 0 IS a valid total (a genuinely
--                   free invoice); a NULL is not. That is the whole distinction.
--
--   total_bills ..................... all bills    (a record count, not money)
--   total_quantity .................. all bills    (a physical count, and NOT part
--                                                  of the tax identity below)
--   amount_before_tax ............... valid bills  (money)
--   cgst / sgst / igst / total_gst ... valid bills  (money)
--   amount_after_tax ................ valid bills  (money)
--   round_off ....................... valid bills  (money)
--   average_bill_value .............. valid bills  (mean over bills with a total)
--   average_amount_before_tax ....... valid bills  (each average divides by the
--   average_cgst/sgst/igst/gst       same population its own sum covers)
--   average_round_off ............... valid bills
--   average_quantity ................ all bills    (matches total_quantity)
--   min/max_amount_after_tax ........ valid bills, NULL if none
--   min/max_amount_before_tax ....... valid bills, NULL if none
--   bills_with_total ................ valid bills  (new column)
--   bills_without_total ............. all bills    (the excluded count)
--   job_kind_breakdown .............. all bills    (classification, not money)
--
-- WHY QUANTITY IS THE ONE FIGURE OVER ALL BILLS
-- Every money figure above is one term in the identity
-- `amount_before_tax + total_gst + round_off = amount_after_tax`. Mixing bills
-- that contribute to one term but not another produces a number that describes no
-- invoice, so money is taken only from bills whose whole identity is known.
-- Quantity is not in that identity — it is a count of physical items, and a bill
-- that recorded "6 nos" but not the invoice total still recorded 6. Counting it is
-- the truthful answer; inventing 0 for it would not be.
--
-- WHY A COMPONENT CAN STILL BE NULL INSIDE A VALID BILL
-- Intra-state invoices write IGST as "-", so a bill can have a valid grand total
-- and a null igst. `sum(x) FILTER (valid)` already ignores that null, which is the
-- correct answer — the bill contributes nothing to IGST because it genuinely has no
-- IGST. No zero is invented for it.
--
-- NOTHING ELSE CHANGES
-- No column on `bills`, `bill_uploads`, `folder_items` or `admin_folders` is
-- touched. No trigger, policy, grant or edge function changes. 1 physical invoice
-- is still 1 bill record with 3 print copies, and every total is still over unique
-- `bills` rows via the `DISTINCT` in `unique_bills`.
--
-- UPGRADE NOTE
-- `bills_with_total` is ADDED, and `min_*` / `max_*` become nullable. Clients read
-- these columns by name and treat all of them as optional, so a client running
-- against a database that only has 0009 applied keeps working: it shows the
-- figures it has and falls back to "not recorded" rather than a fabricated zero.
--
-- Apply with:  psql "$DATABASE_URL" -f 0010_billing_summary_semantics.sql
-- (or via `supabase db push`, or the Supabase dashboard SQL editor)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) get_folder_bill_summary, with the populations stated in the SQL itself
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaced in place under the SAME name and signature, exactly as 0009 did.
-- `CREATE OR REPLACE` cannot change a return type, and this adds a column, so the
-- body is installed by dropping and recreating. That keeps exactly ONE aggregation
-- function in the database. Postgres DDL is transactional, so a failure here leaves
-- the 0009 version in place rather than no function at all.
--
-- Every column 0006 and 0009 returned is still returned, with the same names; one is
-- added. Both clients map by name, so the addition is backward compatible.
DROP FUNCTION IF EXISTS public.get_folder_bill_summary(uuid);

CREATE FUNCTION public.get_folder_bill_summary(p_folder_id uuid)
RETURNS TABLE (
    -- ── counts and totals (names unchanged from 0006) ──
    total_bills            bigint,
    total_quantity         numeric,
    amount_before_tax      numeric,
    cgst                   numeric,
    sgst                   numeric,
    igst                   numeric,
    total_gst              numeric,
    amount_after_tax       numeric,
    round_off              numeric,
    avg_bill_value         numeric,
    avg_quantity           numeric,
    avg_amount_before_tax  numeric,
    -- ── the remaining averages (0009) ──
    avg_cgst               numeric,
    avg_sgst               numeric,
    avg_igst               numeric,
    avg_total_gst          numeric,
    avg_round_off          numeric,
    -- ── min / max, NULLABLE now (0009) ──
    -- Nullable because NULL means "no bill in this folder has this figure" and 0
    -- means "the cheapest bill in this folder cost nothing". Those are different
    -- statements, and a financial summary must not confuse them.
    min_amount_after_tax   numeric,
    max_amount_after_tax   numeric,
    min_amount_before_tax  numeric,
    max_amount_before_tax  numeric,
    -- ── the two populations, side by side (0009 + this migration) ──
    bills_without_total    bigint,
    bills_with_total       bigint,
    -- ── job-kind breakdown over all bills (0009) ──
    job_kind_breakdown     jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_admin   boolean;
    n_bills    bigint;
    n_valid    bigint;
    v_qty      numeric := 0;
    v_abt      numeric := 0;
    v_cgst     numeric := 0;
    v_sgst     numeric := 0;
    v_igst     numeric := 0;
    v_gst      numeric := 0;
    v_aat      numeric := 0;
    v_round    numeric := 0;
    v_min_aat  numeric;
    v_max_aat  numeric;
    v_min_abt  numeric;
    v_max_abt  numeric;
    v_no_total bigint := 0;
    v_breakdown jsonb;
BEGIN
    -- Authorization FIRST, before any data is read: only an authenticated,
    -- active admin may read folder financial totals.
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
    -- `has_total` is computed ONCE here, rather than being repeated as a
    -- `amount_after_tax IS NOT NULL` predicate in thirteen places below. The
    -- populations must not be able to drift apart: if a later edit loosened the
    -- money FILTER but not the count, the averages would silently divide by a
    -- different number of bills than the sums cover.
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
            b.round_off,
            (b.amount_after_tax IS NOT NULL) AS has_total
        FROM public.folder_items fi
        JOIN public.bills b ON b.id = fi.item_id
        WHERE fi.folder_id = p_folder_id
          AND fi.item_type = 'bill'
    )
    SELECT
        -- ALL BILLS: the record count and the physical quantity.
        count(*),
        count(*) FILTER (WHERE u.has_total),
        coalesce(sum(coalesce(u.total_quantity, 0)), 0),
        -- VALID BILLS ONLY: every money figure. Each FILTER is the same
        -- `u.has_total`, so a bill missing its grand total cannot contribute a
        -- partial component to the folder's money.
        --
        -- `sum()` over the null parts of a valid bill contributes nothing, which is
        -- correct rather than accidental: an intra-state invoice has no IGST, and
        -- zero is not a value for "this invoice has no IGST".
        coalesce(sum(u.amount_before_tax) FILTER (WHERE u.has_total), 0),
        coalesce(sum(u.cgst)            FILTER (WHERE u.has_total), 0),
        coalesce(sum(u.sgst)            FILTER (WHERE u.has_total), 0),
        coalesce(sum(u.igst)            FILTER (WHERE u.has_total), 0),
        coalesce(sum(u.total_gst)       FILTER (WHERE u.has_total), 0),
        coalesce(sum(u.amount_after_tax) FILTER (WHERE u.has_total), 0),
        coalesce(sum(u.round_off)       FILTER (WHERE u.has_total), 0),
        -- Spread over VALID BILLS. Left NULL rather than coalesced to 0: a folder
        -- in which no bill has a total has no cheapest bill, and reporting ₹0.00
        -- would invent one that costs nothing.
        min(u.amount_after_tax)  FILTER (WHERE u.has_total),
        max(u.amount_after_tax)  FILTER (WHERE u.has_total),
        min(u.amount_before_tax) FILTER (WHERE u.has_total),
        max(u.amount_before_tax) FILTER (WHERE u.has_total),
        -- The two populations, reported so the UI can state the scope of the money
        -- above instead of implying that it covers every bill in the folder.
        count(*) FILTER (WHERE NOT u.has_total)
    INTO n_bills, n_valid, v_qty, v_abt, v_cgst, v_sgst, v_igst, v_gst, v_aat, v_round,
         v_min_aat, v_max_aat, v_min_abt, v_max_abt, v_no_total
    FROM unique_bills u;

    total_bills           := n_bills;
    total_quantity        := v_qty;
    amount_before_tax     := v_abt;
    cgst                  := v_cgst;
    sgst                  := v_sgst;
    igst                  := v_igst;
    total_gst             := v_gst;
    amount_after_tax      := v_aat;
    round_off             := v_round;
    min_amount_after_tax  := v_min_aat;
    max_amount_after_tax  := v_max_aat;
    min_amount_before_tax := v_min_abt;
    max_amount_before_tax := v_max_abt;
    bills_without_total   := v_no_total;
    bills_with_total      := n_valid;

    -- Safe division: NULLIF(n, 0) makes an empty folder — or a folder where no
    -- bill has a total — produce 0, not a "division by zero".
    --
    -- MONEY averages divide by the VALID count. This is the change: dividing by
    -- `n_bills` put a bill with no recorded total into the denominator and pulled
    -- every average towards zero, which is how two bills of ₹10,000 and ₹20,000
    -- plus one unpriced bill reported an average of ₹10,000.
    avg_bill_value        := coalesce(round(v_aat / NULLIF(n_valid, 0), 2), 0);
    avg_amount_before_tax := coalesce(round(v_abt / NULLIF(n_valid, 0), 2), 0);
    avg_cgst              := coalesce(round(v_cgst / NULLIF(n_valid, 0), 2), 0);
    avg_sgst              := coalesce(round(v_sgst / NULLIF(n_valid, 0), 2), 0);
    avg_igst              := coalesce(round(v_igst / NULLIF(n_valid, 0), 2), 0);
    avg_total_gst         := coalesce(round(v_gst  / NULLIF(n_valid, 0), 2), 0);
    avg_round_off         := coalesce(round(v_round/ NULLIF(n_valid, 0), 2), 0);
    -- Quantity averages over ALL BILLS, because total_quantity does. An average
    -- must divide by the population its own numerator covers, or the two disagree.
    avg_quantity          := coalesce(round(v_qty / NULLIF(n_bills, 0), 3), 0);

    -- Breakdown by the RAW stored job_kind, built from the SAME de-duplicated set,
    -- so its counts always sum to total_bills.
    --
    -- The inner SELECT de-duplicates to one row per (bill, job_kind); the middle
    -- one counts them per kind; the outer jsonb_agg then collapses those per-kind
    -- rows into ONE array. The nesting matters: aggregating directly over the
    -- per-bill rows would emit one array element per BILL rather than per kind,
    -- and dropping the inner GROUP BY would make the aggregate itself grouped,
    -- returning one row per kind of which only the first would survive INTO.
    --
    -- Classification, not money: this is over ALL bills, including the ones without
    -- a total. A bill that was filed but not priced still counts as one bill of its
    -- job type, and the missing figure is reported separately by the counts above.
    --
    -- jsonb_agg over an empty set is NULL, so an empty folder yields NULL here and
    -- the coalesce below turns that into '[]' — the client never has to normalise.
    SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'job_kind', g.raw_kind,
                 'count',    g.bill_count
             ) ORDER BY g.bill_count DESC, g.raw_kind NULLS LAST), '[]'::jsonb)
    INTO v_breakdown
    FROM (
        SELECT u.raw_kind, count(*) AS bill_count
        FROM (
            SELECT DISTINCT b.id, b.job_kind AS raw_kind
            FROM public.folder_items fi
            JOIN public.bills b ON b.id = fi.item_id
            WHERE fi.folder_id = p_folder_id
              AND fi.item_type = 'bill'
        ) u
        GROUP BY u.raw_kind
    ) g;

    job_kind_breakdown := coalesce(v_breakdown, '[]'::jsonb);

    RETURN NEXT;
END;
$$;

-- Re-issued after the recreate: a function's privileges are dropped with the
-- function, so without these the new body would be executable by `public`.
REVOKE ALL ON FUNCTION public.get_folder_bill_summary(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_folder_bill_summary(uuid) TO authenticated;