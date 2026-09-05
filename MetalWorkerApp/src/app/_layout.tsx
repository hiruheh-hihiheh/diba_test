import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { theme } from "../constants/theme";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      />
    </>
  );
}