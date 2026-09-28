import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";
import { useLanguage } from "../../contexts/LanguageContext";

interface Props {
  /** `compact` is the header pill; `list` is the full-width segmented control. */
  layout?: "compact" | "list";
}

/**
 * The app had three different language switchers in three different sizes, all
 * under the 44dp touch minimum, and none of them labelled for screen readers.
 * This is the only one now.
 */
export function LanguageSwitch({ layout = "compact" }: Props) {
  const { language, setLanguage, t } = useLanguage();
  const isList = layout === "list";

  const options = [
    { value: "en" as const, short: "EN", long: t.language_english },
    { value: "hi" as const, short: "हिं", long: t.language_hindi },
  ];

  return (
    <View
      style={[styles.group, isList && styles.groupList]}
      accessibilityRole="radiogroup"
      accessibilityLabel={t.language_label}
    >
      {options.map((opt) => {
        const selected = language === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => setLanguage(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.long}
            style={({ pressed }) => [
              styles.option,
              isList ? styles.optionList : styles.optionCompact,
              selected && styles.optionSelected,
              pressed && !selected && styles.optionPressed,
            ]}
          >
            <Text style={[styles.text, selected && styles.textSelected]}>
              {isList ? opt.long : opt.short}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 3,
    gap: 3,
  },
  groupList: { alignSelf: "stretch" },
  option: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.sm,
    // The pressable itself, not the surrounding pill, has to clear 44dp — the
    // extra 3dp of group padding on each side is what made the tappable area
    // fall short of the minimum a gloved thumb needs.
    minHeight: 44,
  },
  optionCompact: { minWidth: 48, paddingHorizontal: 10 },
  optionList: { flex: 1, paddingHorizontal: theme.spacing.md },
  optionSelected: { backgroundColor: theme.colors.primary },
  optionPressed: { backgroundColor: theme.colors.primary + "1A" },
  text: { fontSize: theme.textSizes.sm, fontWeight: "700", color: theme.colors.textMuted },
  textSelected: { color: "#FFFFFF" },
});
