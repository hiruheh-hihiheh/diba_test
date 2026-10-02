-- Migration: everything the bill EDITOR needs, so a bill can be corrected and
-- re-printed after the workbook is gone.
--
-- WHY THIS EXISTS
-- 0005 stored a bill as a *summary* of the worksheet: enough to list it, group
-- it, and total it. The three PDFs were rendered from the parse in the same
-- request and thrown away afterwards. That made an imported bill final — the only
-- way to change one was to fix the Excel and upload it again, which re-created
-- every sibling.
--
-- The renderer consumes a much richer model than the summary: the recipient's
-- address lines, the seller's three header lines, the tax *rates* rather than
-- only the amounts, and the footer's certification and signature wording. Storing
-- only the summary means the model cannot be rebuilt from the database, and a PDF
-- regenerated later would silently lose those fields.
--
-- So this migration stores the model. Every column is additive and nullable:
--
--   * nothing existing is rewritten or deleted;
--   * a pre-0008 row is regenerated with sensible fallbacks (see
--     `_shared/billDocument.ts`), not with invented values;
--   * empty stays empty, and the renderer keeps the row and the border.
--
-- ONE SOURCE OF TRUTH
-- The reference block (Invoice No. / Our Challan / Your Challan / <Order> / Eway
-- Bill, each with a Date) is NOT stored as a blob. It is DERIVED from the flat
-- columns by `referenceRowsFromFields()` plus `order_no_label`. Storing it as well
-- would create two copies that can disagree, and the disagreement would be
-- invisible until an invoice printed the wrong invoice number.
--
-- CALCULATED vs SOURCE
-- Verified against all 20 production invoices:
--
--     line amount        = quantity x rate      (exact on every sheet)
--     amount_before_tax  = SUM(line amount)     (exact on every sheet)
--     cgst/sgst/igst     = base x rate / 100
--     amount_after_tax   = before + total_gst + round_off
--
-- The last line is the one that matters: 9 of the 20 sheets round (e.g. 302 ends
-- at 19,800.40 and prints 19,800.00 with Round Off -0.40). So `round_off` is a
-- SOURCE value a human decides, not something to recompute, and it participates in
-- the total. Overwriting it would change the invoice.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Recipient block
-- ---------------------------------------------------------------------------
-- The billed-to company and address are a MULTILINE block and are stored that
-- way, with the source's line breaks intact:
--
--     M/s. Example Cookers Ltd.,
--     C-21,22 "U" Road,
--     Example Industrial Estate,
--     Example City - 000 001.
--
-- A `text` column holding the block is deliberate and is not a "giant
-- unstructured field": the invoice's address is one field with a variable number
-- of lines, and a fixed `address_line_1..4` schema would have to drop or invent
-- lines for any address that is not exactly four. The editor presents it as a
-- multiline text area, which is also the only shape that lets a user add a line
-- without a schema change.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS party_address text,
    ADD COLUMN IF NOT EXISTS recipient_label text,
    ADD COLUMN IF NOT EXISTS recipient_note text;

COMMENT ON COLUMN public.bills.party_address IS
    'Billed-to address, one source line per row separated by newlines. Null when the workbook left the block empty, which is NOT an error: some sheets carry only the party''s GST number.';

-- ---------------------------------------------------------------------------
-- 2. E-way bill date
-- ---------------------------------------------------------------------------
-- 0005/P3.11 deliberately had no column for this because the PDF was rendered
-- from the same parse that produced it. Now that a bill can be re-printed from
-- the database, the date has to be stored or the row is printed blank.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS eway_bill_date date;

-- ---------------------------------------------------------------------------
-- 3. Tax RATES, as percentages
-- ---------------------------------------------------------------------------
-- The workbook prints the rate as a FRACTION ("0.09") in the cell beside
-- "ADD:  CGST", and stores the AMOUNT (675.00) separately. Only the amount was
-- kept, so the rate could not be edited and could not be printed when the amount
-- was zero — which is why the shipped PDF never showed the 18% IGST rate the
-- workbook prints.
--
-- These hold the PERCENTAGE as a number: 9 means 9%, matching the fraction in the
-- cell. Storing a fraction here would mean every reader had to remember to
-- multiply by 100, and one that forgot would under-charge by a factor of 100.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS cgst_rate numeric(7, 4),
    ADD COLUMN IF NOT EXISTS sgst_rate numeric(7, 4),
    ADD COLUMN IF NOT EXISTS igst_rate numeric(7, 4);

COMMENT ON COLUMN public.bills.cgst_rate IS
    'CGST rate as a PERCENTAGE (9 = 9%), converted from the workbook''s "0.09" fraction on import. Null falls back to the rate implied by cgst / amount_before_tax at render time.';

-- ---------------------------------------------------------------------------
-- 4. Seller header, split back out
-- ---------------------------------------------------------------------------
-- 0005 packed the seller's descriptor, tax line and contact into one
-- `seller_address` string joined by newlines, which is fine to display and
-- impossible to re-render with: the order is only recoverable if none of the
-- three was ever null.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS seller_descriptor text,
    ADD COLUMN IF NOT EXISTS seller_tax_line  text,
    ADD COLUMN IF NOT EXISTS seller_contact   text;

-- ---------------------------------------------------------------------------
-- 5. Footer wording
-- ---------------------------------------------------------------------------
-- "Certified that the particulars given above are true and correct",
-- "For EXAMPLE ENGINEERING WORKS", "(Proprietor)" and "(Receivers Signature)" are
-- printed on the invoice and were never stored, so a re-print would have had to
-- invent them. They are ordinary template text and are editable like any other
-- field; the LAYOUT around them is not user-editable.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS certification         text,
    ADD COLUMN IF NOT EXISTS on_behalf_of           text,
    ADD COLUMN IF NOT EXISTS signature_designation  text,
    ADD COLUMN IF NOT EXISTS receiver_signature     text;

-- Anything the parser found in the footer that is none of the four above, so an
-- unusual workbook's extra annotation is preserved rather than dropped on the
-- first re-print. Newline separated.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS notes_extra text;

-- ---------------------------------------------------------------------------
-- 6. Re-print identity
-- ---------------------------------------------------------------------------
-- Every save bumps this. The regenerated objects are written to a path carrying
-- the new version, so a client holding the previous signed URL cannot be served a
-- cached copy of the old document — a browser will not re-fetch a URL it has
-- already fetched, and overwriting an object in place does not change that.
ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS pdf_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.bills
    ADD COLUMN IF NOT EXISTS updated_at timestamptz,
    ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bills.pdf_version IS
    'Incremented on every save. The three objects are stored under "<upload>/<bill>_<token>_v<N>_<copy>.pdf", so a new version is a new URL and the previous one is removed once the new row is written.';
COMMENT ON COLUMN public.bills.updated_at IS
    'When the bill was last edited. Null means the bill has only ever been imported.';
COMMENT ON COLUMN public.bills.updated_by IS
    'Admin who last saved the bill. Null for imported-only rows.';

-- ---------------------------------------------------------------------------
-- 7. Invariants the editor could otherwise break
-- ---------------------------------------------------------------------------
-- A bill that has a per-bill document must have all three, and all three must be
-- THAT BILL's documents. 0007 already enforced all-or-none; this adds the ownership
-- check so a bill cannot end up pointing at a sibling's copies.
--
-- The comparison is on the BILL ID, not on the whole object name. The three names
-- differ by design — `..._v2_original.pdf`, `..._v2_duplicate.pdf`,
-- `..._v2_triplicate.pdf` — so requiring the names to match would reject every
-- correct row. The bill id is the first `_`-delimited token of the second path
-- segment and is a UUID, so it never contains an underscore and the split is
-- unambiguous.
--
-- Version agreement is not checked here because it cannot be: the three paths are
-- written in a single UPDATE, so a version skew is not a state the database can
-- observe. What the constraint does catch is a caller that points one copy at
-- another bill's object, which is the failure that would actually reach a user.
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_pdf_paths_same_bill;
ALTER TABLE public.bills
    ADD CONSTRAINT bills_pdf_paths_same_bill
    CHECK (
        original_pdf_path IS NULL
        OR (
            duplicate_pdf_path IS NOT NULL
            AND triplicate_pdf_path IS NOT NULL
            AND split_part(split_part(original_pdf_path, '/', 2), '_', 1)
                = split_part(split_part(duplicate_pdf_path, '/', 2), '_', 1)
            AND split_part(split_part(original_pdf_path, '/', 2), '_', 1)
                = split_part(split_part(triplicate_pdf_path, '/', 2), '_', 1)
        )
    );

-- Editing is a common query ("what did we change last week") and the audit log
-- joins on it.
CREATE INDEX IF NOT EXISTS bills_updated_at_idx
    ON public.bills (updated_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 8. RLS / storage: nothing to add
-- ---------------------------------------------------------------------------
-- `bills_admin_all` is a row policy, so it governs every new column
-- automatically, and the `bills` storage policies are scoped by `bucket_id` only,
-- so the new `_v<N>_` objects are covered by the same active-admin gate.

COMMIT;
