import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { formatManeuverDistance } from "../lib/navigation";
import { maneuverGlyph } from "../lib/routing";
import type { Maneuver } from "../lib/types";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  maneuver: Maneuver | null;
  distanceM: number;
  /** Street the rider will be on after the turn, shown as a secondary line. */
  thenInstruction: string | null;
  rerouting: boolean;
  arrived: boolean;
};

/**
 * The turn card at the top of the navigation screen.
 *
 * Sized for a glance at speed: the arrow and the distance carry the message,
 * and the wording is secondary. During a reroute the card keeps its shape and
 * swaps in a spinner rather than collapsing, so the layout never jumps under
 * the rider's eye.
 */
export function ManeuverBanner({
  maneuver,
  distanceM,
  thenInstruction,
  rerouting,
  arrived,
}: Props) {
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);

  if (arrived) {
    return (
      <View style={[styles.card, styles.cardArrived]}>
        <View style={[styles.glyphBox, styles.glyphBoxArrived]}>
          <Text style={styles.glyphArrived}>◉</Text>
        </View>
        <View style={styles.body}>
          <Text style={styles.arrivedTitle}>You have arrived</Text>
          <Text style={styles.sub} numberOfLines={1}>
            Ride complete
          </Text>
        </View>
      </View>
    );
  }

  if (rerouting) {
    return (
      <View style={styles.card}>
        <View style={styles.glyphBox}>
          <ActivityIndicator color={c.accent} />
        </View>
        <View style={styles.body}>
          <Text style={styles.distance}>Rerouting</Text>
          <Text style={styles.sub} numberOfLines={1}>
            Finding a new way from here
          </Text>
        </View>
      </View>
    );
  }

  if (!maneuver) return null;

  return (
    <View style={styles.card}>
      <View style={styles.glyphBox}>
        <Text style={styles.glyph}>{maneuverGlyph(maneuver.type)}</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.distance}>{formatManeuverDistance(distanceM)}</Text>
        <Text style={styles.instruction} numberOfLines={2}>
          {maneuver.instruction}
        </Text>
        {thenInstruction ? (
          <Text style={styles.sub} numberOfLines={1}>
            Then {thenInstruction.toLowerCase()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.lg,
      backgroundColor: c.scrim,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      padding: space.lg,
      elevation: 4,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    cardArrived: { borderColor: c.success },
    glyphBox: {
      width: 62,
      height: 62,
      borderRadius: radius.md,
      backgroundColor: c.accentWash,
      alignItems: "center",
      justifyContent: "center",
    },
    glyphBoxArrived: { backgroundColor: "rgba(46, 213, 115, 0.16)" },
    glyph: { color: c.accent, fontSize: 38, lineHeight: 44 },
    glyphArrived: { color: c.success, fontSize: 32, lineHeight: 38 },
    body: { flex: 1, gap: 2 },
    distance: {
      color: c.text,
      fontSize: 26,
      fontWeight: "900",
      letterSpacing: -0.5,
    },
    arrivedTitle: { color: c.success, fontSize: 22, fontWeight: "900" },
    instruction: { color: c.text, fontSize: 15, fontWeight: "600", lineHeight: 20 },
    sub: { color: c.textDim, fontSize: 12 },
  });
