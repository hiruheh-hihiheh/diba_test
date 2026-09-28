-- Migration: enforce uniqueness on folder_items (folder_id, item_type, item_id)
--
-- Duplicates were previously only prevented by client-side heuristics (string-
-- matching Postgres error messages), so duplicate rows can exist. Applying a
-- unique index on a table that already contains duplicates FAILS, so this
-- migration first consolidates any pre-existing duplicates deterministically
-- (keeps the EARLIEST row per key — lowest id — and removes the later copies),
-- then creates the index so new duplicates are rejected by the database.
--
-- Audit before applying (optional — shows every duplicate you would keep):
--     SELECT folder_id, item_type, item_id, min(id) AS kept_id, count(*) AS copies
--     FROM folder_items
--     GROUP BY folder_id, item_type, item_id
--     HAVING count(*) > 1;

-- 1) Consolidate exact duplicate triples. This only ever removes duplicate
--    COPIES of an existing (folder, type, item) row — never a unique row, and
--    never a folder's item list — so no real data is discarded.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY folder_id, item_type, item_id
               ORDER BY id ASC
           ) AS rn
    FROM folder_items
)
DELETE FROM folder_items
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Prevent new duplicates at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS folder_items_folder_type_item_key
    ON folder_items (folder_id, item_type, item_id);