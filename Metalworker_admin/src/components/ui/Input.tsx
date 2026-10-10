// src/components/ui/Input.tsx
import React, { useId, useMemo, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  /** Marks the field as required in the label and for screen readers. */
  required?: boolean;
  /** Optional leading glyph (emoji) inside the field. */
  icon?: string;
  /** Optional trailing element, e.g. a show/hide-password toggle. */
  rightAccessory?: React.ReactNode;
}

export function Input({
  label,
  error,
  required,
  icon,
  rightAccessory,
  style,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);
  // Associate the label with the field so screen readers announce it (on web
  // this maps to a real `<label htmlFor>` relationship).
  const fieldId = useId();

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={styles.label} nativeID={`${fieldId}-label`}>
          {label}
          {required ? " *" : ""}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          focused && !error && styles.fieldFocused,
          error && styles.fieldError,
        ]}
      >
        {icon ? (
          <Text style={styles.icon} aria-hidden={true}>
            {icon}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          aria-labelledby={label ? `${fieldId}-label` : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required ?? undefined}
          placeholderTextColor={theme.colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, style]}
          {...rest}
        />
        {rightAccessory ? <View style={styles.accessory}>{rightAccessory}</View> : null}
      </View>
      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: { marginBottom: theme.spacing.md },
    label: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginBottom: theme.spacing.xs,
      letterSpacing: 0.5,
      fontWeight: "600",
    },
    field: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      minHeight: 50,
      paddingHorizontal: theme.spacing.md,
    },
    fieldFocused: {
      borderColor: theme.colors.primary,
      borderWidth: 1.5,
    },
    fieldError: {
      borderColor: theme.colors.danger,
    },
    icon: {
      fontSize: 16,
      marginRight: theme.spacing.sm,
    },
    input: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      paddingVertical: 12,
    },
    accessory: {
      marginLeft: theme.spacing.sm,
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      marginTop: theme.spacing.xs,
    },
  });