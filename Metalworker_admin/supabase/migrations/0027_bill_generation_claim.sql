-- Migration: atomic draft saves and an explicit generation claim.
--
-- Apply after 0026 and before deploying the matching `create-bill` Edge
-- Function.
--
-- WHY THIS EXISTS
--
-- The creator used to write a draft in two separate HTTP round-trips:
--
--   1. UPDATE bills ... WHERE id = draftId
--   2. DELETE/INSERT bill_line_items ... WHERE bill_id = draftId
--
-- A finalize running between those two statements could leave a finalized bill
-- whose line items were replaced afterwards. A status check in the UI cannot
-- prevent that, because the two writes belong to different transactions.
--
-- This migration adds three things:
--
--   * `save_creator_draft` - one transaction that locks the bill row, verifies
--     it is still a draft, updates the columns and replaces the line items.
--     A save that affects zero rows is a conflict, never a success.
--
--   * `claim_bill_generation` - takes a durable, expiring claim on a draft
--     before PDF rendering starts. While a claim is live every ordinary save
--     is refused with `generation_in_progress`.
--
--   * `finalize_bill_generation` / `release_bill_generation` - only the holder
--     of the claim token can record the final paths or release the claim. A
--     stale generation cannot overwrite a newer one.
--
-- The claim is a token in the row, not a transaction-level lock, because
-- rendering three PDFs and uploading them to Storage happens outside the
-- database and can take longer than a sensible row lock.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The claim columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS generation_claim_token uuid,
    ADD COLUMN IF NOT EXISTS generation_claimed_at timestamptz;

COMMENT ON COLUMN public.bills.generation_claim_token IS
    'Non-null while one create-bill finalize owns this draft. Ordinary saves are '
    'refused until it is cleared or expires.';

COMMENT ON COLUMN public.bills.generation_claimed_at IS
    'When the current claim was taken. A claim older than 30 minutes may be '
    'taken over by another request; the old token then no longer matches.';

-- A claim is only meaningful on a draft. Keeping it cleared on finalized rows
-- makes the invariant checkable and stops a finalized bill from looking busy.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'bills_claim_only_on_draft'
          AND conrelid = 'public.bills'::regclass
    ) THEN
        ALTER TABLE public.bills
            ADD CONSTRAINT bills_claim_only_on_draft
            CHECK (
                status <> 'finalized'
                OR (generation_claim_token IS NULL AND generation_claimed_at IS NULL)
            );
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Atomic draft save
-- ---------------------------------------------------------------------------
--
-- `p_patch` is the computed `values` object the Edge Function already builds.
-- Only whitelisted columns are accepted: status, PDF paths, ownership and the
-- claim itself can never arrive through a draft save.
--
-- The result is a JSON object rather than an exception so the Edge Function can
-- map each case to the right HTTP status:
--
--   { ok: true, saved_at }
--   { ok: false, status: 404, reason: 'draft_not_found' }
--   { ok: false, status: 409, reason: 'already_finalized' }
--   { ok: false, status: 409, reason: 'generation_in_progress' }
--   { ok: false, status: 409, reason: 'not_owner' }
--   { ok: false, status: 409, reason: 'document_type_mismatch' }

CREATE OR REPLACE FUNCTION public.save_creator_draft(
    p_bill_id uuid,
    p_user_id uuid,
    p_document_type text,
    p_patch jsonb,
    p_line_items jsonb DEFAULT NULL,
    p_claim_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.bills%ROWTYPE;
    v_allowed text[] := ARRAY[
        'job_kind',
        'invoice_no', 'invoice_date',
        'our_challan_no', 'our_challan_date',
        'your_challan_no', 'your_challan_date',
        'order_no', 'order_no_label', 'order_date',
        'eway_bill_no', 'eway_bill_date',
        'recipient_label', 'recipient_note',
        'party_name', 'party_address', 'party_gst_no',
        'place_of_supply', 'state', 'state_code',
        'transporter_mode', 'vehicle_number',
        'seller_name', 'seller_descriptor', 'seller_tax_line',
        'seller_address', 'seller_contact',
        'cgst_rate', 'sgst_rate', 'igst_rate',
        'reverse_charge_gst', 'round_off',
        'bank_details', 'terms',
        'certification', 'on_behalf_of', 'signature_designation',
        'receiver_signature', 'notes_extra',
        'amount_in_words',
        'total_quantity', 'amount_before_tax',
        'cgst', 'sgst', 'igst', 'total_gst', 'amount_after_tax',
        'logo_id'
    ];
    v_sets text[] := ARRAY['updated_at = now()', 'updated_by = $2'];
    v_key text;
    v_saved_at timestamptz;
BEGIN
    IF p_bill_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_request',
            'message', 'The draft could not be identified.');
    END IF;

    -- Serialize against claim/finalize. Every writer to this row takes the same
    -- lock, so the checks below cannot be invalidated by a concurrent statement.
    SELECT * INTO v_row FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'status', 404, 'reason', 'draft_not_found',
            'message', 'That draft no longer exists.');
    END IF;

    -- Ownership. Drafts written before 0016 have no author; they remain
    -- editable so the feature keeps working for historical rows.
    IF v_row.created_by IS NOT NULL AND v_row.created_by <> p_user_id THEN
        RETURN jsonb_build_object('ok', false, 'status', 404, 'reason', 'draft_not_found',
            'message', 'That draft could not be found.');
    END IF;

    IF v_row.document_type IS DISTINCT FROM p_document_type THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'document_type_mismatch',
            'message', 'That draft belongs to a different document type.');
    END IF;

    IF v_row.status <> 'draft' THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'already_finalized',
            'message', 'This document has already been generated. Open it from Billing to make an edit.');
    END IF;

    -- A live claim belongs to one finalize. Only the holder may write while it
    -- is held. An expired claim is ignored here; `claim_bill_generation` is
    -- what takes it over, and that changes the token.
    IF v_row.generation_claim_token IS NOT NULL
       AND v_row.generation_claimed_at > now() - interval '30 minutes'
       AND (p_claim_token IS NULL OR p_claim_token <> v_row.generation_claim_token) THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'generation_in_progress',
            'message', 'This document is being generated. Wait for it to finish, then try again.');
    END IF;

    IF p_patch IS NOT NULL THEN
        FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
            IF NOT (v_key = ANY (v_allowed)) THEN
                RETURN jsonb_build_object('ok', false, 'status', 400, 'reason', 'unknown_column',
                    'message', format('The draft save contained an unsupported field (%s).', v_key));
            END IF;
            v_sets := v_sets || format('%I = r.%I', v_key, v_key);
        END LOOP;
    END IF;

    EXECUTE format(
        'UPDATE public.bills AS b
            SET %s
           FROM jsonb_populate_record(NULL::public.bills, $1) AS r
          WHERE b.id = $3 AND b.status = ''draft''',
        array_to_string(v_sets, ', ')
    ) USING COALESCE(p_patch, '{}'::jsonb), p_user_id, p_bill_id;

    IF NOT FOUND THEN
        -- The row was locked above, so this can only mean the conditional
        -- predicate failed (another transaction finalized it) or the patch
        -- produced no change. The latter is still a successful save.
        SELECT * INTO v_row FROM public.bills WHERE id = p_bill_id;
        IF NOT FOUND OR v_row.status <> 'draft' THEN
            RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'already_finalized',
                'message', 'This document has already been generated. Open it from Billing to make an edit.');
        END IF;
    END IF;

    -- Line items are replaced only when the caller sent them. `NULL` means
    -- "leave the table alone"; an empty array means "delete every row".
    IF p_line_items IS NOT NULL THEN
        DELETE FROM public.bill_line_items WHERE bill_id = p_bill_id;
        INSERT INTO public.bill_line_items
            (bill_id, sr_no, description, hsn_code, uom, quantity, rate, amount, remarks)
        SELECT p_bill_id, x.sr_no, x.description, x.hsn_code, x.uom,
               x.quantity, x.rate, x.amount, x.remarks
          FROM jsonb_to_recordset(p_line_items)
               AS x(sr_no integer, description text, hsn_code text, uom text,
                    quantity numeric, rate numeric, amount numeric, remarks text)
         WHERE x.description IS NOT NULL;
    END IF;

    SELECT updated_at INTO v_saved_at FROM public.bills WHERE id = p_bill_id;
    RETURN jsonb_build_object('ok', true, 'saved_at', v_saved_at);
END;
$$;

REVOKE ALL ON FUNCTION public.save_creator_draft(uuid, uuid, text, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_creator_draft(uuid, uuid, text, jsonb, jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Claim a draft for generation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_bill_generation(
    p_bill_id uuid,
    p_user_id uuid,
    p_document_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.bills%ROWTYPE;
    v_token uuid := gen_random_uuid();
BEGIN
    IF p_bill_id IS NULL OR p_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_request',
            'message', 'The draft could not be identified.');
    END IF;

    SELECT * INTO v_row FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'status', 404, 'reason', 'draft_not_found',
            'message', 'That draft no longer exists.');
    END IF;

    IF v_row.created_by IS NOT NULL AND v_row.created_by <> p_user_id THEN
        RETURN jsonb_build_object('ok', false, 'status', 404, 'reason', 'draft_not_found',
            'message', 'That draft could not be found.');
    END IF;

    IF v_row.document_type IS DISTINCT FROM p_document_type THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'document_type_mismatch',
            'message', 'That draft belongs to a different document type.');
    END IF;

    IF v_row.status <> 'draft' THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'already_finalized',
            'message', 'This document has already been generated. Open it from Billing to make an edit.');
    END IF;

    IF v_row.generation_claim_token IS NOT NULL
       AND v_row.generation_claimed_at > now() - interval '30 minutes' THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'generation_in_progress',
            'message', 'This document is already being generated. Wait for it to finish, then try again.');
    END IF;

    UPDATE public.bills
       SET generation_claim_token = v_token,
           generation_claimed_at = now()
     WHERE id = p_bill_id;

    RETURN jsonb_build_object('ok', true, 'claim_token', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_bill_generation(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_bill_generation(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Finalize or release the claim
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_bill_generation(
    p_bill_id uuid,
    p_claim_token uuid,
    p_original_path text,
    p_duplicate_path text,
    p_triplicate_path text,
    p_logo_id uuid,
    p_profile_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.bills%ROWTYPE;
    v_now timestamptz := now();
BEGIN
    SELECT * INTO v_row FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'status', 404, 'reason', 'draft_not_found',
            'message', 'That draft no longer exists.');
    END IF;

    IF v_row.status <> 'draft' THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'already_finalized',
            'message', 'This document has already been generated. Open it from Billing to make an edit.');
    END IF;

    IF p_claim_token IS NULL
       OR v_row.generation_claim_token IS DISTINCT FROM p_claim_token THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'claim_lost',
            'message', 'This generation was superseded by another request. Nothing was changed.');
    END IF;

    IF p_original_path IS NULL OR p_duplicate_path IS NULL OR p_triplicate_path IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'status', 400, 'reason', 'invalid_paths',
            'message', 'All three document paths are required.');
    END IF;

    -- ONE statement sets the paths, the version, the logo that was actually
    -- rendered, the profile snapshot, the status and clears the claim.
    -- `bills_draft_has_no_documents` is satisfied because status and paths move
    -- together.
    UPDATE public.bills
       SET original_pdf_path = p_original_path,
           duplicate_pdf_path = p_duplicate_path,
           triplicate_pdf_path = p_triplicate_path,
           pdf_version = 1,
           logo_rendered_logo_id = p_logo_id,
           business_profile_snapshot = p_profile_snapshot,
           status = 'finalized',
           finalized_at = v_now,
           updated_at = v_now,
           generation_claim_token = NULL,
           generation_claimed_at = NULL
     WHERE id = p_bill_id
       AND status = 'draft'
       AND generation_claim_token = p_claim_token;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'reason', 'claim_lost',
            'message', 'This generation was superseded by another request. Nothing was changed.');
    END IF;

    RETURN jsonb_build_object('ok', true, 'finalized_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_bill_generation(uuid, uuid, text, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_bill_generation(uuid, uuid, text, text, text, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.release_bill_generation(
    p_bill_id uuid,
    p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.bills
       SET generation_claim_token = NULL,
           generation_claimed_at = NULL
     WHERE id = p_bill_id
       AND status = 'draft'
       AND generation_claim_token = p_claim_token;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.release_bill_generation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_bill_generation(uuid, uuid) TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- 5. Self-check (runs inside its own transaction and rolls itself back)
-- ---------------------------------------------------------------------------
--
-- This exercises the real functions, including the interleaving the migration
-- exists to prevent:
--
--   save -> claim -> ordinary save refused -> holder save allowed
--        -> finalize -> late save refused -> claim cannot be released
--
-- It needs an active admin and the real `bills`/`bill_line_items` constraints.

BEGIN;

SAVEPOINT bill_generation_claim_selfcheck;

DO $$
DECLARE
    v_admin uuid;
    v_upload uuid;
    v_draft uuid;
    v_second uuid;
    v_claim jsonb;
    v_token uuid;
    v_result jsonb;
    v_ok boolean;
BEGIN
    SELECT p.id INTO v_admin
      FROM public.profiles p
     WHERE p.role = 'admin' AND p.is_active = true
     ORDER BY p.created_at
     LIMIT 1;

    IF v_admin IS NULL THEN
        RAISE NOTICE 'bill-generation claim self-check SKIPPED: no active admin.';
        RETURN;
    END IF;

    INSERT INTO public.bill_uploads
        (original_filename, base_name, status, invoice_count, created_by, creation_source)
    VALUES ('Claim check', 'Claim check', 'completed', 0, v_admin, 'manual')
    RETURNING id INTO v_upload;

    INSERT INTO public.bills
        (bill_upload_id, sheet_name, invoice_no, invoice_date, status, origin,
         created_by, creator_draft_key, document_type)
    VALUES (v_upload, 'CLAIM-CHECK', 'CLAIM-CHECK', '2026-04-01', 'draft', 'manual',
            v_admin, 'claim-check-key-1', 'tax_invoice')
    RETURNING id INTO v_draft;

    INSERT INTO public.bill_line_items (bill_id, sr_no, description, quantity, rate, amount)
    VALUES (v_draft, 1, 'Original line', 1, 100, 100);

    -- 1. A normal save writes the parent and replaces the lines atomically.
    v_result := public.save_creator_draft(
        v_draft, v_admin, 'tax_invoice',
        jsonb_build_object('party_name', 'First party', 'amount_after_tax', 100),
        jsonb_build_array(jsonb_build_object(
            'sr_no', 1, 'description', 'Saved line', 'quantity', 2, 'rate', 50, 'amount', 100)),
        NULL);
    IF (v_result->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'self-check 1: ordinary save failed: %', v_result;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.bill_line_items
        WHERE bill_id = v_draft AND description = 'Saved line'
    ) THEN
        RAISE EXCEPTION 'self-check 1: line items were not replaced';
    END IF;
    RAISE NOTICE 'self-check 1: a draft save updates the parent and its lines.';

    -- 2. Claiming succeeds and returns a token.
    v_claim := public.claim_bill_generation(v_draft, v_admin, 'tax_invoice');
    IF (v_claim->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'self-check 2: claim failed: %', v_claim;
    END IF;
    v_token := (v_claim->>'claim_token')::uuid;
    IF NOT EXISTS (
        SELECT 1 FROM public.bills
        WHERE id = v_draft AND generation_claim_token = v_token
    ) THEN
        RAISE EXCEPTION 'self-check 2: claim token was not stored';
    END IF;
    RAISE NOTICE 'self-check 2: generation takes a durable claim.';

    -- 3. A late autosave without the token is refused and changes nothing.
    v_result := public.save_creator_draft(
        v_draft, v_admin, 'tax_invoice',
        jsonb_build_object('party_name', 'Late autosave'), NULL, NULL);
    IF (v_result->>'reason') IS DISTINCT FROM 'generation_in_progress' THEN
        RAISE EXCEPTION 'self-check 3: late save was not refused: %', v_result;
    END IF;
    IF EXISTS (SELECT 1 FROM public.bills WHERE id = v_draft AND party_name = 'Late autosave') THEN
        RAISE EXCEPTION 'self-check 3: a refused save still wrote the row';
    END IF;
    RAISE NOTICE 'self-check 3: an ordinary save cannot write during generation.';

    -- 4. The claim holder may save (this is how finalize stores the latest values).
    v_result := public.save_creator_draft(
        v_draft, v_admin, 'tax_invoice',
        jsonb_build_object('party_name', 'Holder save'), NULL, v_token);
    IF (v_result->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'self-check 4: holder save failed: %', v_result;
    END IF;
    RAISE NOTICE 'self-check 4: only the claim holder may write during generation.';

    -- 5. A second claim while the first is live is refused.
    v_result := public.claim_bill_generation(v_draft, v_admin, 'tax_invoice');
    IF (v_result->>'reason') IS DISTINCT FROM 'generation_in_progress' THEN
        RAISE EXCEPTION 'self-check 5: a second claim was allowed: %', v_result;
    END IF;
    RAISE NOTICE 'self-check 5: only one generation can claim a draft.';

    -- 6. Finalizing with a wrong token changes nothing.
    v_result := public.finalize_bill_generation(
        v_draft, gen_random_uuid(),
        'manual/x_original.pdf', 'manual/x_duplicate.pdf', 'manual/x_triplicate.pdf',
        NULL, NULL);
    IF (v_result->>'reason') IS DISTINCT FROM 'claim_lost' THEN
        RAISE EXCEPTION 'self-check 6: wrong-token finalize was allowed: %', v_result;
    END IF;
    IF EXISTS (SELECT 1 FROM public.bills WHERE id = v_draft AND status <> 'draft') THEN
        RAISE EXCEPTION 'self-check 6: a wrong-token finalize changed the status';
    END IF;
    RAISE NOTICE 'self-check 6: a stale token cannot finalize.';

    -- 7. Finalizing with the token records the paths and clears the claim.
    v_result := public.finalize_bill_generation(
        v_draft, v_token,
        'manual/' || v_draft::text || '_CLAIM_v1_original.pdf',
        'manual/' || v_draft::text || '_CLAIM_v1_duplicate.pdf',
        'manual/' || v_draft::text || '_CLAIM_v1_triplicate.pdf',
        NULL, jsonb_build_object('company_name', 'Claim check'));
    IF (v_result->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'self-check 7: finalize failed: %', v_result;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.bills
        WHERE id = v_draft
          AND status = 'finalized'
          AND finalized_at IS NOT NULL
          AND generation_claim_token IS NULL
          AND generation_claimed_at IS NULL
    ) THEN
        RAISE EXCEPTION 'self-check 7: finalize did not record the final state';
    END IF;
    RAISE NOTICE 'self-check 7: finalize records paths, status and clears the claim.';

    -- 8. A late save after finalization is refused and cannot touch the lines.
    v_result := public.save_creator_draft(
        v_draft, v_admin, 'tax_invoice',
        jsonb_build_object('party_name', 'After finalize'),
        jsonb_build_array(jsonb_build_object('sr_no', 1, 'description', 'Late line')),
        NULL);
    IF (v_result->>'reason') IS DISTINCT FROM 'already_finalized' THEN
        RAISE EXCEPTION 'self-check 8: late save after finalize was allowed: %', v_result;
    END IF;
    IF EXISTS (SELECT 1 FROM public.bill_line_items WHERE bill_id = v_draft AND description = 'Late line') THEN
        RAISE EXCEPTION 'self-check 8: a late save replaced finalized line items';
    END IF;
    RAISE NOTICE 'self-check 8: a finalized document cannot be changed by a late save.';

    -- 9. A claim cannot be released after finalization, and a stale token cannot
    --    release another generation's claim.
    v_ok := public.release_bill_generation(v_draft, v_token);
    IF v_ok THEN
        RAISE EXCEPTION 'self-check 9: release after finalize reported success';
    END IF;

    INSERT INTO public.bills
        (bill_upload_id, sheet_name, invoice_no, invoice_date, status, origin,
         created_by, creator_draft_key, document_type)
    VALUES (v_upload, 'CLAIM-CHECK-2', 'CLAIM-CHECK-2', '2026-04-02', 'draft', 'manual',
            v_admin, 'claim-check-key-2', 'tax_invoice')
    RETURNING id INTO v_second;

    v_claim := public.claim_bill_generation(v_second, v_admin, 'tax_invoice');
    v_token := (v_claim->>'claim_token')::uuid;

    v_ok := public.release_bill_generation(v_second, gen_random_uuid());
    IF v_ok OR NOT EXISTS (
        SELECT 1 FROM public.bills WHERE id = v_second AND generation_claim_token = v_token
    ) THEN
        RAISE EXCEPTION 'self-check 9: a stale token released the claim';
    END IF;

    v_ok := public.release_bill_generation(v_second, v_token);
    IF NOT v_ok OR EXISTS (
        SELECT 1 FROM public.bills WHERE id = v_second AND generation_claim_token IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'self-check 9: the holder could not release its claim';
    END IF;
    RAISE NOTICE 'self-check 9: claims can only be released by their holder.';

    -- 10. A released draft is saveable again.
    v_result := public.save_creator_draft(
        v_second, v_admin, 'tax_invoice',
        jsonb_build_object('party_name', 'After release'), NULL, NULL);
    IF (v_result->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'self-check 10: save after release failed: %', v_result;
    END IF;
    RAISE NOTICE 'self-check 10: a released draft is retryable.';

    DELETE FROM public.bills WHERE id IN (v_draft, v_second);
    DELETE FROM public.bill_uploads WHERE id = v_upload;

    RAISE NOTICE 'bill-generation claim self-check PASSED.';
END;
$$;

ROLLBACK TO SAVEPOINT bill_generation_claim_selfcheck;

COMMIT;
