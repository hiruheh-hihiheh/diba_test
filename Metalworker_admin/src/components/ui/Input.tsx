import React, { useId, useMemo } from "react";
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
}

export function Input({ label, error, required, style, ...rest }: InputProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
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
      <TextInput
        accessibilityLabel={label}
        aria-labelledby={label ? `${fieldId}-label` : undefined}
        aria-invalid={error ? true : undefined}
        aria-required={required ?? undefined}
        placeholderTextColor={theme.colors.textMuted}
        style={[styles.input, error && styles.inputError, style]}
        {...rest}
      />
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
    },
    input: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      minHeight: 50,
      paddingHorizontal: theme.spacing.md,
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
    },
    inputError: {
      borderColor: theme.colors.danger,
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      marginTop: theme.spacing.xs,
    },
  });