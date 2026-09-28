// src/hooks/useFocusLoader.ts
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Shared loading/refresh lifecycle for list screens.
 *
 * Every simple list screen in the app repeats the same pattern:
 *   - `useFocusEffect` reloads data every time the screen regains focus
 *     (so returning from a detail/edit modal reflects backend state);
 *   - a RefreshControl drives the pull-to-refresh flag.
 *
 * This hook owns both so one fix (e.g. guarding a double-fire) lands once.
 */
export function useFocusLoader(load: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { refreshing, onRefresh };
}