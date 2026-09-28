// src/utils/notify.ts
import { Alert, Platform } from "react-native";

/**
 * Cross-platform user message.
 *
 * React Native's `Alert.alert` is a no-op on web (react-native-web does not
 * implement it), so screens using it on web silently swallow every error and
 * success notification. This helper routes web to `window.alert` instead.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}