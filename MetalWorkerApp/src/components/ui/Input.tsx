import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { theme } from "../../constants/theme";

interface InputProps extends TextInputProps {
  label?: string;
}

export function Input({ label, style, ...rest }: InputProps) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput 
        placeholderTextColor={theme.colors.textMuted} 
        style={[styles.input, style]} 
        {...rest} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: theme.spacing.md },
  label: { 
    color: theme.colors.text, 
    fontSize: theme.textSizes.xs, 
    fontWeight: "700",
    marginBottom: theme.spacing.xs,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
  },
});