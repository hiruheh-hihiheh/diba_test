-- Migration: transactional "reorder folder items" RPC.
--
-- The admin and desktop clients previously reordered an entire folder as N
-- separate UPDATEs (one per item, via Promise.all). A failure anywhere in the
-- middle left the folder with a partially reordered order and the client could
-- only report "k of n failed" after the fact. This RPC rewrites every position
-- inside ONE transaction and refuses to run for non-admin callers, so either
-- the whole order is saved or nothing is.
--
-- Contract:
--   * p_item_ids is the FULL ordered list of folder_item ids for p_folder_id in
--     their new order (the client always submits the complete list).
--   * Every supplied id must belong to p_folder_id and the set must cover every
--     item in the folder; anything else RAISEs and aborts the whole reorder.
--   * Positions are assigned 0..n-1 in array order, matching what the clients
--     compute optimistically today, so the visible order is unchanged.
--
-- The clients call this RPC first and fall back to the old multi-update path
-- only when it is not yet deployed (src/services/folders.ts reorderFolderItems
-- in Metalworker_admin and Metalworker_desktop).
--
-- Apply with:  psql "$DATABASE_URL" -f 0004_reorder_folder_items.sql
-- (or via the Supabase dashboard SQL editor)

CREATE OR REPLACE FUNCTION public.reorder_folder_items(
    p_folder_id uuid,
    p_item_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_admin boolean;
    in_folder integer;
    in_list integer;
    total_in_folder integer;
    item_id uuid;
    pos integer := 0;
BEGIN
    -- Authorization: only an authenticated, active admin may reorganize
    -- folders (same rule as set_primary_drawing).
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

    IF p_item_ids IS NULL THEN
        RAISE EXCEPTION 'item_ids_required';
    END IF;

    -- The provided ids must all belong to this folder...
    SELECT count(*) INTO in_folder
      FROM folder_items
     WHERE folder_id = p_folder_id
       AND id = ANY (p_item_ids);

    in_list := coalesce(array_length(p_item_ids, 1), 0);

    -- ...and the list must cover every item currently in the folder (a partial
    -- list is a caller bug; refuse it instead of silently reordering a subset).
    SELECT count(*) INTO total_in_folder
      FROM folder_items
     WHERE folder_id = p_folder_id;

    IF in_folder <> in_list OR total_in_folder <> in_list THEN
        RAISE EXCEPTION 'invalid_item_ids';
    END IF;

    -- Single transaction: assign new positions in array order.
    FOREACH item_id IN ARRAY p_item_ids LOOP
        UPDATE folder_items SET position = pos WHERE id = item_id;
        pos := pos + 1;
    END LOOP;
END;
$$;

-- Only authenticated users may call it; the admin check above runs before any
-- write, so nothing changes for non-admins.
REVOKE ALL ON FUNCTION public.reorder_folder_items(uuid, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.reorder_folder_items(uuid, uuid[]) TO authenticated;