import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { AdminShell } from "../components/shell/AdminShell";

/**
 * Routes rendered WITHOUT the admin shell chrome. Login keeps its own
 * full-screen layout; the splash (`/`) redirects before it matters; the
 * auto-generated sitemap is a dev tool.
 */
const BARE_ROUTES = ["/login", "/", "/_sitemap"];

function RootContent() {
  const { theme, themeMode } = useTheme();
  const pathname = usePathname();

  const isBare =
    BARE_ROUTES.includes(pathname) || pathname.startsWith("/_sitemap");

  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );

  return (
    <>
      <StatusBar style={themeMode === "light" ? "dark" : "light"} />
      {isBare ? stack : <AdminShell>{stack}</AdminShell>}
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <RootContent />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}