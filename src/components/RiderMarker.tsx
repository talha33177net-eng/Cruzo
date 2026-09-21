import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, radius } from "../theme";

type Props = {
  initials: string;
  name: string;
  color: string;
  /** Degrees clockwise from north, or `null` when the direction is unknown. */
  heading: number | null;
  isSelf: boolean;
  isHost: boolean;
  /** Dimmed styling for a rider whose last fix has gone cold. */
  isStale: boolean;
  /** Ringed in red while this rider has an SOS raised. */
  isSos?: boolean;
  /** True once this rider's journey is under way. */
  isNavigating?: boolean;
};

/**
 * A rider's pin on the map.
 *
 * The shape carries the rider's state. Parked, they are a disc with their
 * initials — easy to tell apart when a group is clustered at a fuel stop.
 * Riding, they become a chevron pointing where they are going, which is far
 * easier to read at a glance and at speed than a circle with a small arrow
 * stuck to it.
 *
 * Every rider keeps their own colour in both shapes, and the name always sits
 * underneath in upright text, because a label that rotates with the heading is
 * unreadable half the time.
 */
function RiderMarkerBase({
  initials,
  name,
  color,
  heading,
  isSelf,
  isHost,
  isStale,
  isSos = false,
  isNavigating = false,
}: Props) {
  const showDirection = heading != null;
  const riding = isNavigating && showDirection;

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={[styles.stack, isStale && !isSos && styles.stale]}>
        {/* A halo rather than a recolour, so the rider keeps their own colour
            and stays identifiable in the list at the same time. */}
        {isSos ? <View style={styles.sosHalo} /> : null}

        {riding ? (
          <View style={[styles.rotator, { transform: [{ rotate: `${heading}deg` }] }]}>
            {isSelf ? <View style={styles.beamWide} /> : null}
            {/* White triangle behind a slightly smaller coloured one, which
                gives the chevron an outline against any basemap. */}
            <View style={styles.chevronOutline} />
            <View style={[styles.chevron, { borderBottomColor: isSos ? SOS_RED : color }]} />
          </View>
        ) : (
          <>
            {showDirection ? (
              <View
                style={[styles.rotator, { transform: [{ rotate: `${heading}deg` }] }]}
              >
                {isSelf ? (
                  <>
                    <View style={styles.beamWide} />
                    <View style={styles.beamCore} />
                  </>
                ) : (
                  <View style={[styles.arrow, { borderBottomColor: color }]} />
                )}
              </View>
            ) : null}

            <View
              style={[
                styles.disc,
                { borderColor: isSos ? SOS_RED : color },
                isSelf && styles.discSelf,
                isSelf && { backgroundColor: color },
              ]}
            >
              <Text
                style={[styles.initials, { color: isSelf ? "#0B0E13" : color }]}
                numberOfLines={1}
              >
                {initials}
              </Text>
            </View>
          </>
        )}

        {isHost && !riding ? (
          <View style={[styles.hostDot, { backgroundColor: color }]}>
            <Text style={styles.hostDotText}>H</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.chip, riding && styles.chipRiding]}>
        <Text style={styles.chipText} numberOfLines={1}>
          {isSelf ? "You" : name}
        </Text>
      </View>
    </View>
  );
}

export const RiderMarker = memo(RiderMarkerBase);

const SOS_RED = "#D32029";

const DISC = 40;
/** The rotating frame; the marker sits at its centre. */
const RING = 116;

const CHEVRON_W = 17;
const CHEVRON_H = 40;
const OUTLINE = 4;

const styles = StyleSheet.create({
  root: { alignItems: "center", width: RING },
  stack: {
    width: RING,
    height: RING,
    alignItems: "center",
    justifyContent: "center",
  },
  stale: { opacity: 0.45 },
  sosHalo: {
    position: "absolute",
    width: DISC + 26,
    height: DISC + 26,
    borderRadius: (DISC + 26) / 2,
    borderWidth: 4,
    borderColor: SOS_RED,
    backgroundColor: "rgba(211, 32, 41, 0.25)",
  },

  rotator: {
    position: "absolute",
    width: RING,
    height: RING,
    alignItems: "center",
  },

  /**
   * The riding chevron, centred on the marker point.
   *
   * `top` places the triangle so its middle sits at the centre of rotation;
   * otherwise it would swing around the rider instead of turning on the spot.
   */
  chevron: {
    position: "absolute",
    top: (RING - CHEVRON_H) / 2,
    width: 0,
    height: 0,
    borderLeftWidth: CHEVRON_W,
    borderRightWidth: CHEVRON_W,
    borderBottomWidth: CHEVRON_H,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  chevronOutline: {
    position: "absolute",
    top: (RING - CHEVRON_H) / 2 - OUTLINE,
    width: 0,
    height: 0,
    borderLeftWidth: CHEVRON_W + OUTLINE,
    borderRightWidth: CHEVRON_W + OUTLINE,
    borderBottomWidth: CHEVRON_H + OUTLINE * 1.5,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#FFFFFF",
  },

  /**
   * Both beams are downward-pointing triangles whose apex sits on the marker
   * and whose base fans out ahead of it. `bottom: RING / 2` puts that apex
   * exactly at the centre of rotation.
   */
  beamWide: {
    position: "absolute",
    bottom: RING / 2,
    width: 0,
    height: 0,
    borderLeftWidth: 30,
    borderRightWidth: 30,
    borderTopWidth: 44,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(255, 92, 26, 0.22)",
  },
  beamCore: {
    position: "absolute",
    bottom: RING / 2,
    width: 0,
    height: 0,
    borderLeftWidth: 13,
    borderRightWidth: 13,
    borderTopWidth: 40,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "rgba(255, 92, 26, 0.85)",
  },

  /** Compact arrowhead for a parked rider facing a known direction. */
  arrow: {
    position: "absolute",
    top: (RING - DISC) / 2 - 15,
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 11,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },

  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    borderWidth: 3,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  discSelf: { borderColor: "#FFFFFF" },
  initials: { fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },

  hostDot: {
    position: "absolute",
    top: (RING - DISC) / 2 - 2,
    right: (RING - DISC) / 2 - 2,
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  hostDotText: { fontSize: 9, fontWeight: "900", color: "#0B0E13" },

  chip: {
    marginTop: -28,
    maxWidth: RING,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1,
    borderColor: colors.border,
  },
  /** The chevron reaches lower than the disc, so the label drops with it. */
  chipRiding: { marginTop: -18 },
  chipText: { color: colors.text, fontSize: 11, fontWeight: "700" },
});
