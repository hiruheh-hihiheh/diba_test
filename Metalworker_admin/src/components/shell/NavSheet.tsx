// src/components/shell/NavSheet.tsx
//
// Reusable bottom sheet (RN Modal) used for both the Jobs and More tabs.
// - Android back closes it via `onRequestClose`.
// - Items call the shell's handler, which navigates / toggles theme / signs
//   out, then closes the sheet.
// - A visible grab handle and spring slide keep it feeling native.
import React from "react";
import {
  Modal,
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

interface NavSheetProps {
  visible: boolean;
  title: string;
  sections: NavSection[];
  onClose: () => void;
  onItemPress: (item: NavItem) => void;
}

export function NavSheet({
  visible,
  title,
  sections,
  onClose,
  onItemPress,
}: NavSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = React.useMemo(() => createStyles(theme), [theme]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: theme.colors.overlay }]}>
        {/* Scrim */}
        <Pressable
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />

        {/* Sheet */}
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              backgroundColor: theme.colors.surfaceRaised,
            },
          ]}
        >
          <View style={[styles.handleWrap, { backgroundColor: theme.colors.surfaceHover }]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.text }]}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title} menu`}
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  backgroundColor: theme.colors.surfaceHover,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.closeIcon, { color: theme.colors.text }]}>
                ✕
              </Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {sections.map((section) => (
              <View key={section.key} style={styles.section}>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: theme.colors.textMuted },
                  ]}
                >
                  {section.title.toUpperCase()}
                </Text>
                {section.items.map((item) => (
                  <Pressable
                    key={item.key}
                    onPress={() => onItemPress(item)}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    style={({ pressed }) => [
                      styles.item,
                      pressed && { backgroundColor: theme.colors.surfaceHover },
                    ]}
                  >
                    <Text style={[styles.itemIcon, { color: theme.colors.text }]}>
                      {item.icon}
                    </Text>
                    <Text
                      style={[styles.itemLabel, { color: theme.colors.text }]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: "flex-end",
    },
    sheet: {
      width: "100%",
      borderTopLeftRadius: theme.radius.xl,
      borderTopRightRadius: theme.radius.xl,
      paddingTop: 10,
      maxHeight: "78%",
      ...theme.elevation.overlay,
    },
    handleWrap: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      marginBottom: 8,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
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
    section: {
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 10,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.8,
      marginBottom: 4,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 13,
      borderRadius: 8,
      paddingHorizontal: 8,
      gap: 12,
      minHeight: 50,
    },
    itemIcon: {
      fontSize: 18,
      width: 24,
      textAlign: "center",
    },
    itemLabel: {
      fontSize: 15,
    },
  });