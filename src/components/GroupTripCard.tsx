import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatDistance } from "../lib/geo";
import { initialsOf } from "../lib/identity";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  leaderName: string;
  leaderColor: string;
  leaderIsHost: boolean;
  destinationLabel: string;
  /** Stops on the way, not counting the destination itself. */
  viaCount: number;
  /** Other riders already heading there, besides the leader. */
  alsoGoing: number;
  /** Straight-line distance from this rider to the destination. */
  distanceM: number | null;
  /** This rider is already navigating somewhere else. */
  switching: boolean;
  /** The rider being followed has changed where the group is going. */
  changed: boolean;
  /**
   * Shrunk to a single slim bar after "Later".
   *
   * It never disappears outright: waving the card away used to leave no way
   * back to the group's destination, which is the one thing a group ride
   * needs to be able to do at any time.
   */
  collapsed?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
};

/**
 * Offers this rider the destination someone else in the party is riding to.
 *
 * Accepting does not copy the leader's route: it plans a fresh one from where
 * *this* rider is, through the same stops. Two riders starting from opposite
 * ends of town get two different routes that meet at the same place.
 */
export function GroupTripCard({
  leaderName,
  leaderColor,
  leaderIsHost,
  destinationLabel,
  viaCount,
  alsoGoing,
  distanceM,
  switching,
  changed,
  collapsed = false,
  onAccept,
  onDismiss,
}: Props) {
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);

  if (collapsed) {
    return (
      <Pressable
        onPress={onAccept}
        accessibilityRole="button"
        accessibilityLabel={`Ride with ${leaderName} to ${destinationLabel}`}
        style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
      >
        <View style={[styles.barDot, { backgroundColor: leaderColor }]} />
        <Text style={styles.barText} numberOfLines={1}>
          <Text style={styles.barLeader}>{leaderName}</Text>
          {"  →  "}
          {destinationLabel}
        </Text>
        <Text style={styles.barAction}>{switching ? "Switch" : "Join"}</Text>
      </Pressable>
    );
  }

  const headline = changed
    ? `${leaderName} changed destination`
    : `${leaderName} is riding to`;

  const details = [
    viaCount > 0 ? `via ${viaCount} ${viaCount === 1 ? "stop" : "stops"}` : null,
    distanceM != null ? `${formatDistance(distanceM)} from you` : null,
    alsoGoing > 0 ? `+${alsoGoing} going` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={[styles.avatar, { borderColor: leaderColor }]}>
        <Text style={[styles.avatarText, { color: leaderColor }]}>
          {initialsOf(leaderName)}
        </Text>
        <View style={styles.flag}>
          <Text style={styles.flagGlyph}>◉</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.headlineRow}>
          <Text style={styles.headline} numberOfLines={1}>
            {headline}
          </Text>
          {leaderIsHost ? <Text style={styles.hostTag}>HOST</Text> : null}
        </View>
        <Text style={styles.destination} numberOfLines={1}>
          {destinationLabel}
        </Text>
        {details ? (
          <Text style={styles.details} numberOfLines={1}>
            {details}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onAccept}
          accessibilityRole="button"
          accessibilityLabel={`Plan your own route to ${destinationLabel}`}
          style={({ pressed }) => [styles.accept, pressed && styles.pressed]}
        >
          <Text style={styles.acceptText}>{switching ? "Switch" : "Ride there"}</Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Decide later"
          hitSlop={8}
          style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
        >
          <Text style={styles.dismissText}>Later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      marginHorizontal: space.md,
      marginBottom: space.sm,
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderColor: c.accent,
      borderRadius: radius.lg,
      paddingVertical: space.md,
      paddingHorizontal: space.md,
      elevation: 4,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 2.5,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontSize: 14, fontWeight: "900" },
    // The destination glyph pinned to the avatar ties "who" to "where".
    flag: {
      position: "absolute",
      right: -5,
      bottom: -5,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: "#FF5C1A",
      borderWidth: 2,
      borderColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    flagGlyph: { color: "#1A0A02", fontSize: 9, fontWeight: "900" },
    body: { flex: 1, gap: 1 },
    headlineRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
    headline: { color: c.textDim, fontSize: 12, fontWeight: "700", flexShrink: 1 },
    hostTag: {
      color: c.accent,
      borderColor: c.accentDim,
      borderWidth: 1,
      fontSize: 8,
      fontWeight: "900",
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: "hidden",
    },
    destination: { color: c.text, fontSize: 16, fontWeight: "900" },
    details: { color: c.textFaint, fontSize: 11, fontWeight: "600" },
    actions: { alignItems: "stretch", gap: space.xs },
    accept: {
      backgroundColor: c.accent,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm + 2,
      alignItems: "center",
    },
    acceptText: { color: c.onAccent, fontWeight: "900", fontSize: 13 },
    dismiss: { paddingVertical: 2, alignItems: "center" },
    dismissText: { color: c.textDim, fontWeight: "700", fontSize: 11 },
    pressed: { opacity: 0.75 },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      marginHorizontal: space.md,
      marginBottom: space.sm,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.accentDim,
      borderRadius: radius.pill,
      paddingVertical: space.sm,
      paddingLeft: space.md,
      paddingRight: space.xs,
    },
    barDot: { width: 10, height: 10, borderRadius: 5 },
    barText: { flex: 1, color: c.textDim, fontSize: 13, fontWeight: "600" },
    barLeader: { color: c.text, fontWeight: "800" },
    barAction: {
      color: c.onAccent,
      backgroundColor: c.accent,
      fontWeight: "900",
      fontSize: 12,
      paddingHorizontal: space.md,
      paddingVertical: space.xs + 2,
      borderRadius: radius.pill,
      overflow: "hidden",
    },
  });
