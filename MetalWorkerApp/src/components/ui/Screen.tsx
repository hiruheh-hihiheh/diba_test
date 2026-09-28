import { type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "../../constants/theme";

interface ScreenProps {
  children: ReactNode;
  /**
   * Pin the content to the top safe inset. Turn off for screens that own a
   * full-bleed image or a native header.
   */
  topInset?: boolean;
  /** Keep content clear of the gesture bar / navigation bar. Default true. */
  bottomInset?: boolean;
  /** Wrap children in a ScrollView. Off for screens that own a FlatList. */
  scroll?: boolean;
  /** Pinned action area that must never scroll away (submit bars). */
  footer?: ReactNode;
  /** Extra padding around the scroll content. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Disable vertical scrolling (e.g. a single centred card). */
  center?: boolean;
  keyboardAware?: boolean;
  testID?: string;
}

/**
 * The single place that knows about safe areas and the keyboard.
 *
 * Every screen previously started at y=0, which put the header behind the
 * status bar on notched phones, and the dispatch form's Submit button was simply
 * the last node inside a very long ScrollView.
 */
export function Screen({
  children,
  topInset = true,
  bottomInset = true,
  scroll = true,
  footer,
  contentStyle,
  center = false,
  keyboardAware = false,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  const padTop = topInset ? insets.top : 0;
  const padBottom = bottomInset ? insets.bottom : 0;

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.content,
        { paddingTop: padTop, paddingBottom: padBottom + theme.spacing.xxl },
        center && styles.centered,
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      showsVerticalScrollIndicator={false}
      testID={testID}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.fill, { paddingTop: padTop }]} testID={testID}>
      {children}
    </View>
  );

  const withKeyboard = keyboardAware ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {body}
    </KeyboardAvoidingView>
  ) : (
    body
  );

  return (
    <View style={styles.flex}>
      {withKeyboard}
      {footer ? (
        <View
          style={[
            styles.footer,
            { paddingBottom: Math.max(insets.bottom, theme.spacing.sm) },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  fill: { width: "100%" },
  content: {
    paddingHorizontal: theme.spacing.lg,
    flexGrow: 1,
  },
  centered: { justifyContent: "center" },
  footer: {
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },
});
