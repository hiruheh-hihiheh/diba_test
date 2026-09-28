import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";

import { AppHeader } from "../components/ui/AppHeader";
import { Card, Section } from "../components/ui/Card";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { LanguageSwitch } from "../components/ui/LanguageSwitch";
import { NetworkBanner } from "../components/ui/NetworkBanner";
import { Screen } from "../components/ui/Screen";
import { Button } from "../components/ui/Button";
import { useToast } from "../components/ui/Toast";
import { SessionGate } from "../components/SessionGate";
import { theme } from "../constants/theme";
import { useLanguage } from "../contexts/LanguageContext";
import { useSession } from "../contexts/SessionContext";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

/** `/profile` was a 0-byte file, so the dashboard's Profile card went nowhere. */
export default function ProfileRoute() {
  return (
    <SessionGate>
      <Profile />
    </SessionGate>
  );
}

function Profile() {
  const { t } = useLanguage();
  const { username, fullName, role, userId, signOut } = useSession();
  const { isOffline } = useNetworkStatus();
  const toast = useToast();

  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const result = await signOut();
      if (!result.ok) toast.show(t.unable_to_logout, "error");
    } finally {
      setLoggingOut(false);
      setConfirmLogout(false);
    }
  }

  const version =
    Constants.expoConfig?.version ??
    (Constants.expoConfig?.extra as { version?: string } | undefined)?.version ??
    "1.0.0";

  return (
    <Screen scroll>
      <AppHeader title={t.profile_title} onBack={() => router.back()} />

      {isOffline ? <NetworkBanner t={t} /> : null}

      <Section title={t.your_account}>
        <Card>
          <ProfileRow label={t.username} value={username || "—"} />
          {fullName && fullName !== username ? <ProfileRow label={t.profile_title} value={fullName} /> : null}
          <ProfileRow
            label={t.role_label}
            value={role === "processor" ? t.role_processor : t.role_worker}
          />
          {/* A short, unambiguous slice is enough to let a worker confirm
              which account they are on a shared device. */}
          {userId ? <ProfileRow label={t.session_label} value={`${userId.slice(0, 8)}…`} /> : null}
        </Card>
      </Section>

      <Section title={t.language_label}>
        <Card>
          <LanguageSwitch />
        </Card>
      </Section>

      <Button title={t.logout} onPress={() => setConfirmLogout(true)} variant="danger" />

      <Text style={styles.version} accessibilityLabel={t.app_version}>
        {t.app_version} {version} · {Platform.OS}
      </Text>

      <ConfirmDialog
        visible={confirmLogout}
        title={t.logout_confirm_title}
        body={t.logout_confirm_body}
        confirmLabel={t.logout}
        cancelLabel={t.cancel}
        onConfirm={handleLogout}
        onCancel={() => setConfirmLogout(false)}
        busy={loggingOut}
        destructive
      />
    </Screen>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowLabel: { fontSize: theme.textSizes.xs, color: theme.colors.textMuted, fontWeight: "700" },
  rowValue: { flex: 1, fontSize: theme.textSizes.sm, color: theme.colors.text, fontWeight: "700", textAlign: "right" },
  version: {
    marginTop: theme.spacing.lg,
    textAlign: "center",
    fontSize: theme.textSizes.xs,
    color: theme.colors.textMuted,
  },
});
