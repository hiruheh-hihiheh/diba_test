import { useCallback, useEffect, useRef, useState } from "react";

import { fetchMyDispatches, type Dispatch, type DispatchStatus } from "../services/dispatch";
import { readableError, type ReadableError } from "../utils/readableError";

export interface DispatchListParams {
  limit?: number;
  search?: string;
  status?: DispatchStatus | "all";
  /** Set false to keep the hook dormant, e.g. on a processor's dashboard. */
  enabled?: boolean;
}

export interface DispatchListState {
  rows: Dispatch[];
  /** Server-side match count, or null when the backend did not report one. */
  total: number | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: ReadableError | null;
  /** Full reload from offset 0, showing the pull-to-refresh spinner. */
  refresh: () => void;
  loadMore: () => void;
}

/**
 * The one place dispatch data is fetched.
 *
 * Both the dashboard and the history list used to carry their own copy of this
 * logic, so they disagreed: the dashboard's version swallowed failures and
 * reported an empty list, and the history version had no guards at all.
 *
 * Three specific hazards this handles:
 *  - **Stale writes.** Search is debounced, so a slow request for "ABC" can
 *    resolve after a fast one for "ABCD". A monotonic sequence number means
 *    only the newest request is allowed to touch state.
 *  - **Writes after unmount.** A worker who backs out mid-request must not
 *    crash the app.
 *  - **Duplicate page loads.** `onEndReached` fires repeatedly while the user
 *    keeps scrolling at the end of the list, so a separate in-flight ref gates
 *    the append.
 */
export function useDispatchList({
  limit = 20,
  search = "",
  status = "all",
  enabled = true,
}: DispatchListParams = {}): DispatchListState {
  const [rows, setRows] = useState<Dispatch[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ReadableError | null>(null);

  // Debounced so typing a plate number costs one request, not one per key.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    if (search === debouncedSearch) return;
    const id = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search, debouncedSearch]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Only the newest request may write state.
  const seq = useRef(0);
  // How many rows we believe we hold; the offset for the next page.
  const loaded = useRef(0);
  const moreInFlight = useRef(false);

  /**
   * @param mode   `replace` restarts at offset 0; `append` adds the next page.
   * @param silent suppresses the full-screen `loading` spinner, which is what
   *               pull-to-refresh and "load more" must never trigger.
   */
  const run = useCallback(
    async (mode: "replace" | "append", silent = false) => {
      if (!enabled) return;

      const append = mode === "append";
      if (append) {
        if (moreInFlight.current) return;
        moreInFlight.current = true;
      }

      const offset = append ? loaded.current : 0;
      const mySeq = ++seq.current;

      if (append) setLoadingMore(true);
      else if (!silent) setLoading(true);
      setError(null);

      let result: Awaited<ReturnType<typeof fetchMyDispatches>>;
      try {
        result = await fetchMyDispatches({ limit, offset, search: debouncedSearch, status });
      } finally {
        // Must happen on *every* exit path. If an append is superseded by a
        // filter change and we skip this, `moreInFlight` stays true and
        // "load more" is dead for the rest of the screen's life.
        if (append) {
          moreInFlight.current = false;
          if (mounted.current) setLoadingMore(false);
        } else if (mounted.current) {
          setLoading(false);
        }
      }

      // A newer request started, or the screen went away: drop this result.
      if (!mounted.current || mySeq !== seq.current) return;

      if (!result.ok) {
        setError(readableError(result.error));
        // An append that fails must not clear the rows already on screen.
        return;
      }

      const page = result.data.rows;
      setRows((prev) => (append ? [...prev, ...page] : page));
      loaded.current = offset + page.length;
      setTotal(result.data.total);

      setHasMore(
        result.data.total !== null ? loaded.current < result.data.total : page.length === limit,
      );
    },
    [debouncedSearch, enabled, limit, status],
  );

  // First page, and a re-fetch whenever the query actually changes.
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setTotal(null);
      setHasMore(false);
      return;
    }
    loaded.current = 0;
    void run("replace");
  }, [enabled, run]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void run("replace", true).finally(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, [run]);

  const loadMore = useCallback(() => {
    void run("append");
  }, [run]);

  return {
    rows,
    total,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
  };
}

const SEARCH_DEBOUNCE_MS = 300;
