import { useRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { CODE_LENGTH, normalizeRideCode } from "../lib/rideCode";
import { colors, font, radius, space } from "../theme";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
};

/**
 * Six character boxes driven by one offscreen `TextInput`.
 *
 * Per-box inputs are a common approach but fight the Android keyboard on
 * backspace and paste; a single hidden field keeps text handling native and
 * leaves the boxes as pure presentation.
 */
export function CodeInput({ value, onChange, onComplete, autoFocus }: Props) {
  const inputRef = useRef<TextInput>(null);
  const slots = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? "");
  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);

  const handleChange = (raw: string) => {
    const next = normalizeRideCode(raw);
    onChange(next);
    if (next.length === CODE_LENGTH) onComplete?.(next);
  };

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessibilityRole="none"
      style={styles.row}
    >
      {slots.map((char, index) => (
        <View
          key={index}
          style={[
            styles.slot,
            char !== "" && styles.slotFilled,
            index === activeIndex && value.length < CODE_LENGTH && styles.slotActive,
          ]}
        >
          <Text style={styles.char}>{char}</Text>
        </View>
      ))}

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType="visible-password"
        maxLength={CODE_LENGTH}
        accessibilityLabel="Ride code"
        style={styles.hiddenInput}
        caretHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm, justifyContent: "center" },
  slot: {
    flex: 1,
    aspectRatio: 0.78,
    maxWidth: 54,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  slotFilled: { borderColor: colors.surfaceHigh, backgroundColor: colors.surfaceAlt },
  slotActive: { borderColor: colors.accent },
  char: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    fontFamily: font.mono,
  },
  /**
   * Stretched over the boxes and made invisible rather than moved offscreen,
   * so taps focus it directly and Android keeps the keyboard attached.
   */
  hiddenInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: "transparent",
  },
});
