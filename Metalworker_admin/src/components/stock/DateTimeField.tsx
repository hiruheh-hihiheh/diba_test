import React, { useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import DateTimePicker from "@expo/ui/community/datetime-picker";
import { theme } from "../../constants/theme";

interface DateTimeFieldProps {
  label?: string;
  value: string; // ISO string or empty
  onChange: (value: string) => void;
  placeholder?: string;
}

export function DateTimeField({
  label,
  value,
  onChange,
  placeholder = "Select date & time",
}: DateTimeFieldProps) {
  const [mode, setMode] = useState<"date" | "time" | "datetime">("date");
  const [show, setShow] = useState(false);
  const [tempDate, setTempDate] = useState<Date | null>(null);

  const dateValue = value ? new Date(value) : new Date();

  const handlePress = () => {
    if (Platform.OS === "android") {
      setMode("date");
      setShow(true);
      setTempDate(null);
    } else {
      setMode("datetime");
      setShow(true);
    }
  };

  const handleChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      if (event.type === "set" && selectedDate) {
        if (mode === "date") {
          // Store selected date and transition to time picker
          setTempDate(selectedDate);
          setMode("time");
          // Re-triggering picker via state change works in React Native for Android
        } else {
          // Time selected
          setShow(false);
          const finalDate = tempDate ? new Date(tempDate) : new Date();
          finalDate.setHours(selectedDate.getHours());
          finalDate.setMinutes(selectedDate.getMinutes());
          onChange(finalDate.toISOString());
        }
      } else {
        // Cancelled
        setShow(false);
      }
    } else {
      // iOS
      if (selectedDate) {
        onChange(selectedDate.toISOString());
      }
      
      // On iOS 14+, default display is a compact picker that auto-dismisses when interacting
      // outside or via 'dismissed' event if it was a modal. 
      // If we are getting the onChange, we can optionally hide it or just keep it open 
      // until they tap out (which triggers dismissed).
      if (event.type === "dismissed") {
        setShow(false);
      } else if (event.type === "set") {
        // for some iOS modes, 'set' is triggered on every scroll.
        // We will just let the user dismiss it naturally.
      }
    }
  };

  const getDisplayValue = () => {
    if (!value) return placeholder;
    const d = new Date(value);
    if (isNaN(d.getTime())) return placeholder;

    return d.toLocaleString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      
      <TouchableOpacity
        style={[styles.inputContainer, !value && styles.inputEmpty]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <Text style={[styles.inputText, !value && styles.placeholderText]}>
          {value ? `📅 ${getDisplayValue()}` : placeholder}
        </Text>
      </TouchableOpacity>

      {show && (
        <DateTimePicker
          value={dateValue}
          mode={mode as any}
          display="default"
          onChange={handleChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.md,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.textSizes.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: theme.spacing.xs,
  },
  inputContainer: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    minHeight: 48,
    justifyContent: "center",
  },
  inputEmpty: {
    borderStyle: "dashed",
  },
  inputText: {
    color: theme.colors.text,
    fontSize: theme.textSizes.md,
  },
  placeholderText: {
    color: theme.colors.textMuted,
  },
});
