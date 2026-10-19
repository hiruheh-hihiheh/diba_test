import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Check .env and restart with npx expo start --clear"
  );
}

/**
 * One client for the whole app.
 *
 * `persistSession: true` alone is NOT enough in React Native: supabase-js only
 * defaults to `localStorage` when that global exists, and otherwise swaps in an
 * in-memory adapter. React Native has no `localStorage`, so the session used to
 * live only in RAM and every cold start looked like a brand-new install —
 * which is why a signed-in admin was sent back to the login screen after
 * closing the app. Handing it AsyncStorage is the actual persistence.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Token refresh in React Native only makes sense while the app is awake.
 * Backgrounding pauses the JS timer, so stop the ticker on the way out and
 * resume it on return; otherwise a session that sat idle for longer than the
 * access-token lifetime is not refreshed until something else asks for it.
 * This never touches stored credentials.
 */
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}

export const LOGIN_EMAIL_DOMAIN = "@metalworker.local";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${LOGIN_EMAIL_DOMAIN}`;
}