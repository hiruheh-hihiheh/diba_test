import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { theme } from "../constants/theme";
import { useLanguage } from "../contexts/LanguageContext";
import { useSession } from "../contexts/SessionContext";
import { ErrorState, LoadingState } from "./ui/States";
import { Button } from "./ui/Button";
import { Screen } from "./ui/Screen";
import type { UserRole } from "../types/profile";

/**
 * Wraps every protected screen.
 *
 * Its whole job is to stop a bad network state from being shown as data, and to
 * stop a missing profile from being shown as "no records". Without this, the
 * old code signed the worker out whenever the profile query failed.
 *
 * `allow` additionally restricts the screen to particular roles. Hiding a card
 * on the dashboard is not enough on its own: `/dispatch` was reachable by any
 * signed-in user who typed the URL, which quietly defeated the Labour/Processor
 * split the rest of the app is built around.
 */
export function SessionGate({
  children,
  allow,
}: {
  children: ReactNode;
  allow?: UserRole[];
}) {
  const { status, role, isActive, error, retrying, refresh } = useSession();
  const { t } = useLanguage();

  if (status === "signedIn" && allow && role && !allow.includes(role)) {
    return (
      <Screen scroll={false} center>
        <View style={styles.gate}>
          <ErrorState
            title={t.role_not_allowed_title}
            body={t.role_not_allowed_body}
          />
          <Button
            title={t.back}
            variant="outline"
            fullWidth
            onPress={() => router.replace("/")}
          />
        </View>
      </Screen>
    );
  }

  if (status === "signedIn") return <>{children}</>;

  if (status === "restoring") {
    return (
      <Screen scroll={false} center>
        <LoadingState label={t.loading} />
      </Screen>
    );
  }

  if (status === "signedOut") {
    // The provider is already navigating to /login. Rendering a spinner rather
    // than a flash of the screen's real content avoids leaking a stale view.
    return (
      <Screen scroll={false} center>
        <LoadingState label={t.loading} />
      </Screen>
    );
  }

  // status === "unreachable": a session exists but we cannot confirm the account.
  //
  // The ordering here is load-bearing. If the profile *read* failed, `isActive`
  // was never written and is still its `false` initial value — so keying the
  // "deactivated" copy off it used to tell a worker their account had been
  // disabled whenever the network merely hiccuped. A connection problem and an
  // unusable account are very different news for someone in the field, and only
  // the latter is the supervisor's to fix.
  //
  // `no_profile` is the one read that succeeded and found nothing, so it is an
  // account problem, not a connection problem.
  const missingProfile = error?.message === "no_profile";

  if (error && !missingProfile) {
    const isConnection = error.kind === "offline" || error.kind === "timeout" || error.kind === "server";

    return (
      <Screen scroll={false} center>
        <View style={styles.gate}>
          <ErrorState
            title={isConnection ? t.no_connection : t.something_went_wrong}
            body={isConnection ? t.login_failed : error.message}
            onRetry={error.retryable ? refresh : undefined}
            retryLabel={t.retry}
            retrying={retrying}
          />
        </View>
      </Screen>
    );
  }

  // The profile came back, so `isActive` and `role` are real values now and the
  // account itself is the problem.
  const message = missingProfile
    ? t.account_not_set_up
    : !isActive
      ? t.account_inactive
      : t.admin_login_unsupported;

  return (
    <Screen scroll={false} center>
      <View style={styles.gate}>
        <ErrorState
          title={message}
          body={message}
          // Only a disabled account is worth re-checking: a supervisor may have
          // reactivated it. A missing profile row will not appear on its own,
          // and re-reading will not turn an admin into a labour user.
          onRetry={!missingProfile && !isActive ? refresh : undefined}
          retryLabel={t.retry}
          retrying={retrying}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gate: { width: "100%", maxWidth: 420, backgroundColor: theme.colors.background },
});
