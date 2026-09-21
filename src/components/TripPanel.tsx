import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatDistance } from "../lib/geo";
import { formatDuration, formatEta } from "../lib/navigation";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  remainingM: number;
  remainingS: number;
  destinationLabel: string;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  onStop: () => void;
};

/**
 * The trip summary above the rider list while navigating: arrival time, time
 * left, distance left, and the two controls a rider actually reaches for
 * mid-ride.
 */
export function TripPanel({
  remainingM,
  remainingS,
  destinationLabel,
  voiceEnabled,
  onToggleVoice,
  onStop,
}: Props) {
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);

  return (
    <View style={styles.panel}>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{formatEta(remainingS)}</Text>
          <Text style={styles.statLabel}>arrive</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{formatDuration(remainingS)}</Text>
          <Text style={styles.statLabel}>left</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{formatDistance(remainingM)}</Text>
          <Text style={styles.statLabel}>distance</Text>
        </View>

        <Pressable
          onPress={onToggleVoice}
          accessibilityRole="switch"
          accessibilityState={{ checked: voiceEnabled }}
          accessibilityLabel={
            voiceEnabled ? "Turn off voice guidance" : "Turn on voice guidance"
          }
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconButton,
            voiceEnabled && styles.iconButtonOn,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.icon, voiceEnabled && styles.iconOn]}>
            {voiceEnabled ? "♪" : "✕"}
          </Text>
        </Pressable>

        <Pressable
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="Stop navigation"
          hitSlop={8}
          style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
        >
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      </View>

      <Text style={styles.destination} numberOfLines={1}>
        To {destinationLabel}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    panel: {
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderColor: c.border,
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: space.sm,
      gap: space.xs,
    },
    statsRow: { flexDirection: "row", alignItems: "center", gap: space.md },
    stat: { alignItems: "flex-start" },
    statValue: { color: c.text, fontSize: 17, fontWeight: "800" },
    statLabel: {
      color: c.textFaint,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    divider: { width: 1, height: 26, backgroundColor: c.borderSoft },
    iconButton: {
      marginLeft: "auto",
      width: 38,
      height: 38,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    iconButtonOn: { borderColor: c.accent, backgroundColor: c.accentWash },
    icon: { color: c.textDim, fontSize: 16, fontWeight: "800" },
    iconOn: { color: c.accent },
    stopButton: {
      paddingHorizontal: space.lg,
      height: 38,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.danger,
      alignItems: "center",
      justifyContent: "center",
    },
    stopText: { color: c.danger, fontWeight: "800", fontSize: 13 },
    pressed: { opacity: 0.7 },
    destination: { color: c.textDim, fontSize: 12 },
  });
