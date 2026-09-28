import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LanguageProvider } from "../contexts/LanguageContext";
import { SessionProvider } from "../contexts/SessionContext";
import { ToastProvider } from "../components/ui/Toast";
import { theme } from "../constants/theme";

export default function RootLayout() {
  return (
    // Order matters: Toast reads safe-area insets, and Session reads the
    // language dictionary for its own error copy.
    <SafeAreaProvider>
      <LanguageProvider>
        <ToastProvider>
          <SessionProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                // Screens render their own header so the safe-area padding and
                // the language switch stay in one place.
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.background },
                animation: "slide_from_right",
              }}
            />
          </SessionProvider>
        </ToastProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
