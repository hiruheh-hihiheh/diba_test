// src/components/shell/NavigationDrawer.tsx
//
// The full "everything" navigation menu sliding out from the left over a
// scrim. Covers the whole shell (header, content and bottom bar) so users can
// jump anywhere from any screen. Closes on backdrop tap, the X button, item
// selection, Android back and web Escape (both orchestrated by AdminShell).
import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  type NavItem,
  type NavSection,
} from "../../navigation/navigationConfig";

const PANEL_WIDTH = Math.min(Dimensions.get("window").width * 0.85, 340);

interface NavigationDrawerProps {
  visible: boolean;
  onClose: () => void;
  onItemPress: (item: NavItem) => void;
  sections: NavSection[];
  currentPath: string;
  signedInAs: string | null;
}

export function NavigationDrawer({
  visible,
  onClose,
  onItemPress,
  sections,
  currentPath,
  signedInAs,
}: NavigationDrawerProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  // Pre-created via useMemo: reading `useRef().current` during render is
  // rejected by the react-hooks/refs compiler rule.
  const translateX = useMemo(() => new Animated.Value(-PANEL_WIDTH), []);
  const scrimOpacity = useMemo(() => new Animated.Value(0), []);
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: theme.motion.base,
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: theme.motion.fast,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: -PANEL_WIDTH,
          duration: theme.motion.fast,
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 0,
          duration: theme.motion.fast,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateX, scrimOpacity, theme.motion]);

  return (
    <View
      style={styles.overlay}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityViewIsModal={visible}
      accessibilityLabel="Navigation menu"
    >
      {/* Scrim */}
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close navigation menu"
        />
      </Animated.View>

      {/* Panel */}
      <Animated.View
        style={[
          styles.panel,
          {
            width: PANEL_WIDTH,
            paddingTop: insets.top,
            backgroundColor: theme.colors.surfaceRaised,
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={[styles.brandRow, { borderBottomColor: theme.colors.border }]}>
          <View style={styles.brandText}>
            <Text style={[styles.brandTitle, { color: theme.colors.text }]}>
              MetalWorker Admin
            </Text>
            <Text style={[styles.brandSub, { color: theme.colors.textMuted }]}>
              Navigation
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close navigation menu"
            hitSlop={8}
            style={({ pressed }) => [
              styles.closeBtn,
              {
                backgroundColor: theme.colors.surfaceHover,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.closeIcon, { color: theme.colors.text }]}>✕</Text>
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 16 }}
        >
          {sections.map((section) => (
            <View key={section.key} style={styles.section}>
              {section.title !== "" && (
                <Text style={[styles.sectionTitle, { color: theme.colors.textMuted }]}>
                  {section.title.toUpperCase()}
                </Text>
              )}
              {section.items.map((item) => {
                const active = item.route === currentPath;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => onItemPress(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={item.label}
                    style={({ pressed }) => [
                      styles.item,
                      active && { backgroundColor: theme.colors.primaryMuted },
                      pressed && !active && { backgroundColor: theme.colors.surfaceHover },
                    ]}
                  >
                    <Text style={[styles.itemIcon, { color: theme.colors.text }]}>
                      {item.icon}
                    </Text>
                    <Text
                      style={[
                        styles.itemLabel,
                        {
                          color: active ? theme.colors.primary : theme.colors.text,
                          fontWeight: active ? "700" : "500",
                        },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>

        {/* Footer: who is signed in */}
        <View
          style={[
            styles.footer,
            {
              borderTopColor: theme.colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <Text
            style={[styles.footerText, { color: theme.colors.textMuted }]}
            numberOfLines={1}
          >
            {signedInAs ? `Signed in as ${signedInAs}` : "Signed in"}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    overlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 100,
    },
    scrim: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.colors.overlay,
    },
    panel: {
      position: "absolute",
      top: 0,
      left: 0,
      bottom: 0,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: "rgba(0,0,0,0.15)",
      ...theme.elevation.overlay,
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    brandText: {
      flex: 1,
    },
    brandTitle: {
      fontSize: 18,
      fontWeight: "800",
    },
    brandSub: {
      fontSize: 12,
      marginTop: 2,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    closeIcon: {
      fontSize: 16,
      fontWeight: "700",
    },
    footer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    footerText: {
      fontSize: 12,
    },
    section: {
      paddingHorizontal: 12,
      paddingTop: 16,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.8,
      paddingHorizontal: 8,
      marginBottom: 6,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingVertical: 12,
      borderRadius: 8,
      gap: 12,
      minHeight: 48,
    },
    itemIcon: {
      fontSize: 18,
      width: 24,
      textAlign: "center",
    },
    itemLabel: {
      fontSize: 15,
      flex: 1,
    },
  });