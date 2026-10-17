import { Platform } from "react-native";
import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ThemeProvider, useTheme } from "../context/ThemeContext";
import { AdminShell } from "../components/shell/AdminShell";
import { ToastHost } from "../components/ui/Toast";

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
        // Android's default stack transition is abrupt; the platform-accurate
        // rightward slide keeps screen changes feeling continuous. Other
        // platforms keep their native default.
        animation: Platform.OS === "android" ? "slide_from_right" : "default",
      }}
    />
  );

  return (
    <>
      <StatusBar style={themeMode === "light" ? "dark" : "light"} />
      {isBare ? stack : <AdminShell>{stack}</AdminShell>}
      <ToastHost />
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