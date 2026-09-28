import { router } from "expo-router";
import { useEffect, useRef } from "react";

import { Screen } from "../components/ui/Screen";
import { LoadingState } from "../components/ui/States";
import { useLanguage } from "../contexts/LanguageContext";
import { homeForRole, useSession } from "../contexts/SessionContext";

/**
 * Boot gate only. All of the session logic lives in `<SessionProvider>` so that
 * there is exactly one place that decides where an authenticated user belongs.
 *
 * The previous version queried the profile here and called `signOut()` whenever
 * the query came back empty — which meant one bar of signal on a worker's
 * phone logged them out in the middle of a shift.
 */
export default function Index() {
  const { status, role } = useSession();
  const { t } = useLanguage();
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;

    if (status === "signedOut") {
      redirected.current = true;
      router.replace("/login");
      return;
    }

    if (status === "signedIn") {
      redirected.current = true;
      router.replace(homeForRole(role));
    }
    // "unreachable" is rendered in place by <SessionGate> on the next screen,
    // and resolves through the provider's own redirect when it recovers.
  }, [status, role]);

  return (
    <Screen scroll={false} center>
      <LoadingState label={t.loading} />
    </Screen>
  );
}
