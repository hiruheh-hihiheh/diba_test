// src/components/shell/NavSheet.tsx
//
// The Jobs and More destinations open this sheet. It uses the shared
// BottomSheet (spring entrance, draggable handle, scrim) and renders each
// destination as a full-width row with its icon, a one-line description and a
// chevron. Sections are labelled rather than tabbed so the whole menu is
// scannable in one swipe.
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import {
  type NavItem,
  type NavSection,
} from "../../navigation/navigationConfig";
import { BottomSheet } from "../ui/BottomSheet";
import { Icon } from "../ui/Icon";

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
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle="Choose where to go"
    >
      {sections.map((section) => (
        <View key={section.key} style={styles.section}>
          {section.title !== "" ? (
            <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
          ) : null}
          {section.items.map((item) => {
            const danger = item.action === "signout";
            return (
              <Pressable
                key={item.key}
                onPress={() => onItemPress(item)}
                accessibilityRole="button"
                accessibilityLabel={
                  item.description ? `${item.label}. ${item.description}` : item.label
                }
                style={({ pressed }) => [
                  styles.item,
                  pressed && { backgroundColor: theme.colors.surfaceHover },
                ]}
              >
                <View
                  style={[
                    styles.iconBubble,
                    {
                      backgroundColor: danger
                        ? theme.colors.dangerMuted
                        : theme.colors.primarySoft,
                    },
                  ]}
                >
                  <Icon
                    name={item.icon}
                    size={18}
                    color={danger ? theme.colors.danger : theme.colors.primary}
                  />
                </View>
                <View style={styles.itemText}>
                  <Text
                    style={[
                      styles.itemLabel,
                      { color: danger ? theme.colors.danger : theme.colors.text },
                    ]}
                  >
                    {item.label}
                  </Text>
                  {item.description ? (
                    <Text style={styles.itemDescription} numberOfLines={1}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                <Icon name="chevronRight" size={16} color={theme.colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </BottomSheet>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    section: { marginBottom: theme.spacing.sm },
    sectionTitle: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      fontWeight: "700",
      letterSpacing: 1.1,
      marginTop: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
      paddingHorizontal: 2,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm + 2,
      paddingVertical: 10,
      paddingHorizontal: 8,
      marginHorizontal: -8,
      borderRadius: theme.radius.md,
      minHeight: 56,
    },
    iconBubble: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    itemText: { flex: 1, minWidth: 0 },
    itemLabel: { fontSize: theme.textSizes.md, fontWeight: "600" },
    itemDescription: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.caption,
      marginTop: 2,
    },
  });
