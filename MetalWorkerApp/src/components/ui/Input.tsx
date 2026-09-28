import { forwardRef } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { theme } from "../../constants/theme";

interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  /** Shown under the field in red and announced as an alert. */
  error?: string | null;
  /** Small muted helper under the label, e.g. "Your supervisor gives you this". */
  hint?: string;
  required?: boolean;
  /** Rendered inside the field on the right, e.g. a show/hide toggle. */
  accessory?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<TextStyle>;
}

/**
 * The only text field in the app. It always renders a real `<label>`, links it
 * to the input for screen readers, and can show a validation message without the
 * caller having to hand-roll a red box somewhere else in the tree.
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, hint, required = false, accessory, containerStyle, style, ...rest },
  ref,
) {
  const hasError = Boolean(error);

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {required ? (
            <Text style={styles.required} accessibilityLabel="required">
              *
            </Text>
          ) : null}
        </View>
      ) : null}

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <View style={[styles.field, hasError && styles.fieldError]}>
        <TextInput
          ref={ref}
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, style]}
          accessibilityLabel={label}
          accessibilityHint={hint}
          // `alert` role makes a screen reader read the error without moving focus.
          accessibilityState={{ disabled: rest.editable === false }}
          {...rest}
        />
        {accessory}
      </View>

      {hasError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginBottom: theme.spacing.md },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
  },
  label: {
    color: theme.colors.text,
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
  },
  required: { color: theme.colors.danger, fontSize: theme.textSizes.md, fontWeight: "800" },
  hint: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    lineHeight: 15,
    marginBottom: 6,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    minHeight: 52,
  },
  fieldError: { borderColor: theme.colors.danger, backgroundColor: theme.colors.danger + "08" },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    paddingVertical: theme.spacing.sm,
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    marginTop: 5,
    lineHeight: 15,
  },
});
