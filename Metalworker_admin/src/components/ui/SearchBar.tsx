// src/components/ui/SearchBar.tsx
//
// Search input used across list screens: leading icon, quiet surface, clear
// affordance and a visible focus ring. It keeps the same text/placeholder
// contract as a plain TextInput so screens can swap it in without touching
// their filtering logic.
import React, { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Icon } from "./Icon";

interface SearchBarProps extends Omit<TextInputProps, "style"> {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  /** Extra control pinned to the right of the field. */
  accessory?: React.ReactNode;
  /** Required when the visible placeholder is not descriptive enough. */
  accessibilityLabel?: string;
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = "Search…",
  style,
  accessory,
  accessibilityLabel,
  onFocus,
  onBlur,
  ...rest
}: SearchBarProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.wrap,
        focused && { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceRaised },
        style,
      ]}
    >
      <Icon
        name="search"
        size={18}
        color={focused ? theme.colors.primary : theme.colors.textMuted}
      />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        returnKeyType="search"
        autoCorrect={false}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={styles.input}
        {...rest}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText("")}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={10}
          style={({ pressed }) => [styles.clear, pressed && { opacity: 0.6 }]}
        >
          <Icon name="close" size={13} color={theme.colors.textMuted} strokeWidth={2.1} />
        </Pressable>
      ) : null}
      {accessory}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing.sm,
      minHeight: 48,
      paddingHorizontal: 14,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    input: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      paddingVertical: 10,
    },
    clear: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceHover,
    },
  });
