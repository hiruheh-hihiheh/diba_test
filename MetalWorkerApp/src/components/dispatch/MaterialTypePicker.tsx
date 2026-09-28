import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../../constants/theme";
import type { TranslationDictionary } from "../../constants/translations";
import { getMaterialLabelKey, type MaterialType } from "../../services/dispatch";

const OPTIONS: MaterialType[] = ["scrap", "ferrous", "non_ferrous", "other"];

interface MaterialTypePickerProps {
  value: MaterialType | null;
  onChange: (type: MaterialType) => void;
  t: TranslationDictionary;
  disabled?: boolean;
  invalid?: boolean;
}

/**
 * A real radio group. The previous 2x2 grid used `minWidth: "45%"` with
 * auto-height rows, so the Hindi labels wrapped to two lines and left the four
 * tiles at four different heights. Here every tile is a fixed 64dp and the
 * selection is announced, not just coloured.
 */
export function MaterialTypePicker({
  value,
  onChange,
  t,
  disabled = false,
  invalid = false,
}: MaterialTypePickerProps) {
  return (
    <View
      style={[styles.grid, invalid && styles.gridInvalid]}
      accessibilityRole="radiogroup"
      accessibilityLabel={t.material_type}
    >
      {OPTIONS.map((option) => {
        const selected = value === option;
        const label = t[getMaterialLabelKey(option)];
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={label}
            hitSlop={4}
            style={({ pressed }) => [
              styles.tile,
              selected && styles.tileSelected,
              invalid && !selected && styles.tileInvalid,
              pressed && !selected && !disabled && styles.tilePressed,
              disabled && styles.tileDisabled,
            ]}
          >
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={2}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  gridInvalid: {
    // The group is flagged as a whole, but the individual selected tile still
    // reads as selected.
  },
  tile: {
    // flexBasis + gap keeps two columns at 360dp and lets them grow on tablets
    // instead of leaving a ragged third tile.
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  tileSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryLight },
  tileInvalid: { borderColor: theme.colors.danger + "66" },
  tilePressed: { backgroundColor: theme.colors.primary + "0D" },
  tileDisabled: { opacity: 0.5 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: theme.colors.primary },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
  },
  label: {
    flex: 1,
    fontSize: theme.textSizes.sm,
    fontWeight: "600",
    color: theme.colors.text,
  },
  labelSelected: { color: "#065F46", fontWeight: "800" },
});
