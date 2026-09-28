import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { theme } from "../../constants/theme";

interface SearchInputProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  /** Announced by screen readers and shown as the field's visible label. */
  label?: string;
  clearLabel: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  testID?: string;
}

/**
 * One search field for the whole app: visible label, live filtering, an
 * explicit clear button, and a result count announced to screen readers.
 */
export function SearchInput({
  value,
  onChangeText,
  placeholder,
  label,
  clearLabel,
  autoFocus = false,
  onSubmit,
  testID,
}: SearchInputProps) {
  const hasValue = value.length > 0;

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.field}>
        <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
          🔍
        </Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
          accessibilityLabel={label ?? placeholder}
          testID={testID}
        />
        {hasValue ? (
          <Pressable
            onPress={() => onChangeText("")}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={clearLabel}
            style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: theme.spacing.md },
  label: {
    fontSize: theme.textSizes.sm,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: 6,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    minHeight: 52,
    gap: theme.spacing.sm,
  },
  icon: { fontSize: 15 },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
    // Prevents iOS from clipping the descender on a 52pt field.
    paddingVertical: theme.spacing.sm,
  },
  clear: {
    // 44dp, not a token-sized 32: this only appears once you have typed, so it
    // is easy to ship at 32 and never notice on a screen where the list is empty.
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.textMuted + "1F",
  },
  clearPressed: { backgroundColor: theme.colors.textMuted + "33" },
  clearText: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
});
