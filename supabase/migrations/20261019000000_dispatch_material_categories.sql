-- Dispatch material categories: Metal / Non-metal / Other.
--
-- New dispatches store `metal` or `non_metal` instead of the old
-- `ferrous` / `non_ferrous` pair, and Other stores the worker's own wording in
-- `custom_material`.
--
-- The old values are deliberately kept in the allowed list. Historical rows
-- keep their original value and are never rewritten or re-classified; this
-- migration only widens what NEW rows may contain and adds one nullable column.
--
-- Safe to run more than once.

-- 1. Free-text value for Other (null for every other category).
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS custom_material text;

-- 2. Replace the old material_type check with one that also accepts the new
--    categories. The constraint name is discovered rather than assumed, because
--    an inline column check may not be called dispatches_material_type_check on
--    every project.
DO $$
DECLARE
  existing_constraint record;
BEGIN
  FOR existing_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.dispatches'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%material_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.dispatches DROP CONSTRAINT %I',
      existing_constraint.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.dispatches
  ADD CONSTRAINT dispatches_material_type_check
  CHECK (
    material_type = ANY (
      ARRAY[
        'metal'::text,
        'non_metal'::text,
        'other'::text,
        -- historical values, preserved for existing rows
        'scrap'::text,
        'ferrous'::text,
        'non_ferrous'::text
      ]
    )
  );

-- 3. The free-text value must be meaningful when it is present. Historical
--    rows have NULL here and are unaffected.
ALTER TABLE public.dispatches
  DROP CONSTRAINT IF EXISTS dispatches_custom_material_len;

ALTER TABLE public.dispatches
  ADD CONSTRAINT dispatches_custom_material_len
  CHECK (
    custom_material IS NULL
    OR char_length(btrim(custom_material)) BETWEEN 1 AND 120
  );

COMMENT ON COLUMN public.dispatches.custom_material IS
  'Worker-supplied description for material_type = ''other''; null otherwise.';
