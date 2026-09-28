import { useNetworkState } from "expo-network";

export type NetworkStatus = "online" | "offline" | "unknown";

/**
 * Live connectivity, used to explain a stalled screen instead of letting it
 * look frozen. `unknown` is the very first render and while the OS has no
 * answer yet — the UI treats it as "assume online" so we never block a worker
 * on a guess.
 */
export function useNetworkStatus(): { status: NetworkStatus; isOffline: boolean } {
  const state = useNetworkState();

  if (state.isInternetReachable === false) return { status: "offline", isOffline: true };
  if (state.isInternetReachable === true) return { status: "online", isOffline: false };
  return { status: "unknown", isOffline: false };
}
