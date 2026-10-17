// src/components/shell/NavigationDrawer.tsx
//
// The full "everything" navigation menu sliding out from the left over a
// scrim. Covers the whole shell (header, content and bottom bar) so users can
// jump anywhere from any screen. Closes on backdrop tap, the X button, item
// selection, Android back and web Escape (all orchestrated by AdminShell).
import React, { useEffect, useMemo } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import {
  type NavItem,
  type NavSection,
} from "../../navigation/navigationConfig";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";

const PANEL_WIDTH = Math.min(Dimensions.get("window").width * 0.86, 348);

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
  const reduced = useReducedMotion();
  // Pre-created via useMemo: reading `useRef().current` during render is
  // rejected by the react-hooks/refs compiler rule.
  const translateX = useMemo(() => new Animated.Value(-PANEL_WIDTH), []);
  const scrimOpacity = useMemo(() => new Animated.Value(0), []);
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    if (reduced) {
      translateX.setValue(visible ? 0 : -PANEL_WIDTH);
      scrimOpacity.setValue(visible ? 1 : 0);
      return;
    }
    if (visible) {
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          damping: 26,
          stiffness: 260,
          mass: 0.9,
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: theme.motion.fast,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: -PANEL_WIDTH,
          duration: theme.motion.base,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scrimOpacity, {
          toValue: 0,
          duration: theme.motion.fast,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateX, scrimOpacity, theme.motion, reduced]);

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
            backgroundColor: theme.colors.surface,
            borderRightColor: theme.colors.border,
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Icon name="hammer" size={19} color={theme.colors.primaryButtonText} />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.brandTitle}>MetalWorker</Text>
            <Text style={styles.brandSub}>Admin console</Text>
          </View>
          <IconButton
            icon="close"
            accessibilityLabel="Close navigation menu"
            onPress={onClose}
            variant="soft"
            size={34}
            iconSize={15}
          />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {sections.map((section) => (
            <View key={section.key} style={styles.section}>
              {section.title !== "" && (
                <Text style={styles.sectionTitle}>
                  {section.title.toUpperCase()}
                </Text>
              )}
              {section.items.map((item) => {
                const active = item.route === currentPath;
                const danger = item.action === "signout";
                const tint = danger
                  ? theme.colors.danger
                  : active
                  ? theme.colors.primary
                  : theme.colors.textSecondary;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => onItemPress(item)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={item.label}
                    style={({ pressed }) => [
                      styles.item,
                      active && { backgroundColor: theme.colors.primarySoft },
                      pressed && { backgroundColor: theme.colors.surfaceHover },
                    ]}
                  >
                    {active ? <View style={styles.activeBar} /> : null}
                    <View style={styles.itemIcon}>
                      <Icon name={item.icon} size={18} color={tint} />
                    </View>
                    <Text
                      style={[
                        styles.itemLabel,
                        {
                          color: dangerousColor(danger, active, theme),
                          fontWeight: active ? "700" : "500",
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    {active ? (
                      <View style={styles.activeDot} />
                    ) : (
                      <Icon
                        name="chevronRight"
                        size={14}
                        color={theme.colors.textMuted}
                      />
                    )}
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
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View style={styles.userIcon}>
            <Icon name="users" size={16} color={theme.colors.textMuted} />
          </View>
          <View style={styles.userText}>
            <Text style={styles.userCaption}>Signed in as</Text>
            <Text style={styles.userEmail} numberOfLines={1}>
              {signedInAs ?? "Admin"}
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function dangerousColor(
  danger: boolean,
  active: boolean,
  theme: AppTheme
): string {
  if (danger) return theme.colors.danger;
  if (active) return theme.colors.primary;
  return theme.colors.text;
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
      borderTopRightRadius: theme.radius.xl,
      borderBottomRightRadius: theme.radius.xl,
      borderRightWidth: 1,
      overflow: "hidden",
      ...theme.elevation.overlay,
    },
    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 14,
    },
    brandMark: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: theme.colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    brandText: { flex: 1, minWidth: 0 },
    brandTitle: {
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      fontWeight: "800",
      letterSpacing: -0.3,
    },
    brandSub: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 1,
    },
    scrollContent: { paddingBottom: 8 },
    section: { paddingHorizontal: 10, paddingTop: 10 },
    sectionTitle: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 1.2,
      paddingHorizontal: 10,
      marginBottom: 3,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: theme.radius.md,
      minHeight: 44,
      overflow: "hidden",
    },
    activeBar: {
      position: "absolute",
      left: 0,
      top: 9,
      bottom: 9,
      width: 3,
      borderRadius: 2,
      backgroundColor: theme.colors.primary,
    },
    activeDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.primary,
    },
    itemIcon: { width: 22, alignItems: "center" },
    itemLabel: { fontSize: theme.textSizes.sm, flex: 1 },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      paddingHorizontal: 16,
      paddingTop: 12,
      backgroundColor: theme.colors.surfaceSecondary,
    },
    userIcon: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceHover,
    },
    userText: { flex: 1, minWidth: 0 },
    userCaption: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "600",
      letterSpacing: 0.4,
    },
    userEmail: {
      color: theme.colors.text,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
      marginTop: 1,
    },
  });
