// src/components/ui/BottomSheet.tsx
//
// The app's one bottom-sheet implementation: a dimmed scrim that fades, a panel
// that springs up from the bottom edge, a grab handle that can be dragged down
// to dismiss, safe-area foot padding and keyboard avoidance. Android back and
// the scrim both close it.
//
// This replaces the ad-hoc RN `<Modal animationType="slide">` sheets, which
// could not animate their scrim and snapped open rather than springing.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { IconButton } from "./IconButton";

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Pinned below the scroll region (e.g. primary actions). */
  footer?: React.ReactNode;
  /** Fraction of screen height the panel may occupy. */
  maxHeightRatio?: number;
  contentStyle?: StyleProp<ViewStyle>;
  /** Wrap children in a ScrollView. Defaults to true. */
  scrollable?: boolean;
  /** Optional node on the right of the title row. */
  headerRight?: React.ReactNode;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxHeightRatio = 0.88,
  contentStyle,
  scrollable = true,
  headerRight,
}: BottomSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [mounted, setMounted] = useState(false);
  const openStarted = useRef(false);
  const [translateY] = useState(() => new Animated.Value(600));
  const [scrim] = useState(() => new Animated.Value(0));

  const animateOpen = useCallback(() => {
    if (reduced) {
      translateY.setValue(0);
      scrim.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.timing(scrim, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        damping: 24,
        stiffness: 250,
        mass: 0.9,
        useNativeDriver: true,
      }),
    ]).start();
  }, [reduced, scrim, translateY]);

  const animateClose = useCallback(
    (after?: () => void) => {
      if (reduced) {
        scrim.setValue(0);
        after?.();
        return;
      }
      Animated.parallel([
        Animated.timing(scrim, {
          toValue: 0,
          duration: 150,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 600,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) after?.();
      });
    },
    [reduced, scrim, translateY]
  );

  // Mount first, animate on the frame after layout exists.
  useEffect(() => {
    if (visible) {
      openStarted.current = false;
      translateY.setValue(reduced ? 0 : 600);
      scrim.setValue(0);
      /* Mount on the next frame so the entrance starts from the hidden
         position rather than painting one frame at rest. */
      const frame = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(frame);
    } else if (mounted) {
      animateClose(() => setMounted(false));
    }
    // `mounted` is intentionally excluded: this effect responds to visibility
    // changes only, and reads the latest mounted value through the closure of
    // the render that triggered the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || !mounted || openStarted.current) return;
    openStarted.current = true;
    const frame = requestAnimationFrame(animateOpen);
    return () => cancelAnimationFrame(frame);
  }, [animateOpen, mounted, visible]);

  /** Dragging the handle follows the finger; a short throw dismisses. */
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && g.dy > 0,
        onPanResponderMove: (_e, g) => {
          translateY.setValue(Math.max(0, g.dy));
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 90 || g.vy > 0.85) {
            animateClose(onClose);
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              damping: 22,
              stiffness: 260,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, {
            toValue: 0,
            damping: 22,
            stiffness: 260,
            useNativeDriver: true,
          }).start();
        },
      }),
    [animateClose, onClose, translateY]
  );

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: scrim }]}>
          <Pressable
            onPress={onClose}
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            accessibilityRole="button"
            accessibilityLabel="Close sheet"
          />
        </Animated.View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.avoider}
          pointerEvents="box-none"
        >
          <Animated.View
            style={[
              styles.sheet,
              {
                maxHeight: `${Math.round(maxHeightRatio * 100)}%`,
                paddingBottom: Math.max(insets.bottom, 12),
                transform: [{ translateY }],
              },
            ]}
          >
            <View {...panResponder.panHandlers} style={styles.handleZone}>
              <View style={styles.handle} />
            </View>

            {title ? (
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <Text style={styles.title}>{title}</Text>
                  {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
                </View>
                {headerRight ?? (
                  <IconButton
                    icon="close"
                    accessibilityLabel="Close"
                    onPress={onClose}
                    variant="soft"
                    size={34}
                    iconSize={15}
                  />
                )}
              </View>
            ) : null}

            {scrollable ? (
              <ScrollView
                contentContainerStyle={[styles.content, contentStyle]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bounces={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={[styles.content, contentStyle]}>{children}</View>
            )}

            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    avoider: { justifyContent: "flex-end" },
    sheet: {
      backgroundColor: theme.colors.surfaceRaised,
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: theme.colors.border,
      overflow: "hidden",
      ...theme.elevation.overlay,
    },
    handleZone: { paddingTop: 10, paddingBottom: 4, alignItems: "center" },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.borderStrong,
      opacity: 0.7,
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing.md,
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 12,
    },
    headerText: { flex: 1, minWidth: 0 },
    title: {
      color: theme.colors.text,
      fontSize: theme.textSizes.lg,
      fontWeight: "700",
      letterSpacing: -0.3,
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      lineHeight: 18,
      marginTop: 3,
    },
    content: { paddingHorizontal: 20, paddingBottom: 8 },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceRaised,
      gap: theme.spacing.sm,
    },
  });
