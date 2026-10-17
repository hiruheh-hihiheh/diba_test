// src/components/ui/Input.tsx
import React, { useId, useMemo, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";

import { AppTheme } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Icon } from "./Icon";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  /** Supporting copy shown under the field when there is no error. */
  hint?: string;
  /** Marks the field as required in the label and for screen readers. */
  required?: boolean;
  /** Optional leading line icon inside the field. */
  icon?: React.ComponentProps<typeof Icon>["name"];
  /** Optional trailing element, e.g. a show/hide-password toggle. */
  rightAccessory?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
}

export function Input({
  label,
  error,
  hint,
  required,
  icon,
  rightAccessory,
  style,
  containerStyle,
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
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={styles.label} nativeID={`${fieldId}-label`}>
            {label}
            {required ? <Text style={styles.required}> *</Text> : null}
          </Text>
        </View>
      ) : null}
      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          error && styles.fieldError,
        ]}
      >
        {icon ? (
          <View style={styles.icon}>
            <Icon
              name={icon}
              size={17}
              color={focused ? theme.colors.primary : theme.colors.textMuted}
            />
          </View>
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
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Icon name="alert" size={13} color={theme.colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
}

const createStyles = (theme: AppTheme) =>
  StyleSheet.create({
    wrap: { marginBottom: theme.spacing.md },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 6,
    },
    label: {
      color: theme.colors.textSecondary,
      fontSize: theme.textSizes.xs,
      fontWeight: "600",
      letterSpacing: 0.1,
    },
    required: { color: theme.colors.primary },
    field: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      minHeight: 50,
      paddingHorizontal: 14,
    },
    fieldFocused: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surfaceRaised,
    },
    fieldError: { borderColor: theme.colors.danger },
    icon: { marginRight: theme.spacing.sm },
    input: {
      flex: 1,
      color: theme.colors.text,
      fontSize: theme.textSizes.md,
      paddingVertical: 12,
    },
    accessory: { marginLeft: theme.spacing.sm },
    errorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: 6,
    },
    errorText: {
      color: theme.colors.danger,
      fontSize: theme.textSizes.xs,
      flex: 1,
    },
    hintText: {
      color: theme.colors.textMuted,
      fontSize: theme.textSizes.xs,
      marginTop: 6,
    },
  });
