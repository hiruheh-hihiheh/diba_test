// src/utils/notify.ts
import { Alert, Platform } from "react-native";

import { hasToastHost, showToast, type ToastTone } from "../components/ui/Toast";

/**
 * Cross-platform user message.
 *
 * Success / failure feedback should not interrupt the person mid-task, and
 * React Native's `Alert.alert` is a no-op on web (react-native-web does not
 * implement it), which previously swallowed every error on the web build.
 *
 * When the toast host is mounted (it is, for every screen in the shell) the
 * message appears as a themed banner. The platform alert remains only as a
 * bootstrap fallback for calls made before the host exists.
 */
function inferTone(title: string, message?: string): ToastTone {
  const text = `${title} ${message ?? ""}`;
  if (
    /(fail|error|could not|couldn't|unable|invalid|missing|denied|unavailable|problem|wrong|required|not allowed|expired)/i.test(
      text
    )
  ) {
    return "error";
  }
  if (
    /(success|created|updated|deleted|saved|added|removed|sent|complete|copied|assigned|uploaded|imported|approved|rejected|moved|renamed|linked|unlinked|restored)/i.test(
      text
    )
  ) {
    return "success";
  }
  return "info";
}

export function notify(title: string, message?: string): void {
  if (hasToastHost()) {
    showToast({ title, message, tone: inferTone(title, message) });
    return;
  }

  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}
