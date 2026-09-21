import { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Path, RadialGradient, Stop } from "react-native-svg";

import { colors, radius } from "../theme";

type Props = {
  initials: string;
  name: string;
  color: string;
  /**
   * Which way to point, in degrees clockwise from the top of the *screen*, or
   * `null` when the direction is unknown.
   *
   * Screen, not north: a marker is a view laid over the map and does not turn
   * with it, so the caller subtracts the map's bearing. Passing a compass
   * heading straight through is what used to make the arrow point sideways
   * whenever the driving view had rotated the map.
   */
  rotation: number | null;
  isSelf: boolean;
  isHost: boolean;
  /** Dimmed styling for a rider whose last update has gone cold. */
  isStale: boolean;
  /** Pulses red while this rider has an SOS raised. */
  isSos?: boolean;
  /** True once this rider's journey is under way. */
  isNavigating?: boolean;
};

/**
 * A rider on the map.
 *
 * Riding, a rider is a navigation arrow in their own colour — shaded on one
 * side so it reads as a solid object, outlined in white so it holds up on any
 * basemap. Parked, they are a disc with their initials, easy to tell apart
 * when the group is clustered at a fuel stop; the direction they face is a
 * soft beam of light for you, and a small notch on the ring for everyone else,
 * so the one beam on screen is always yours.
 *
 * Names sit underneath in upright text, because a label that turns with the
 * heading is unreadable half the time. Your own carries your name too, in a
 * chip filled with your colour, so you can pick yourself out of a cluster.
 */
function RiderMarkerBase({
  initials,
  name,
  color,
  rotation,
  isSelf,
  isHost,
  isStale,
  isSos = false,
  isNavigating = false,
}: Props) {
  const riding = isNavigating && rotation != null;
  const turn = { transform: [{ rotate: `${rotation ?? 0}deg` }] };

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={[styles.frame, isStale && !isSos && styles.stale]}>
        {isSos ? <SosPulse /> : null}

        {riding ? (
          <View style={[StyleSheet.absoluteFill, turn]}>
            <Arrow color={isSos ? SOS_RED : color} size={isSelf ? 50 : 40} halo={isSelf} />
          </View>
        ) : (
          <>
            {rotation != null ? (
              <View style={[StyleSheet.absoluteFill, turn]}>
                {isSelf ? <Beam color={color} /> : <Notch color={color} />}
              </View>
            ) : null}

            <View
              style={[
                styles.disc,
                isSelf
                  ? { backgroundColor: color, borderColor: "#FFFFFF" }
                  : { borderColor: isSos ? SOS_RED : color },
              ]}
            >
              <Text
                style={[styles.initials, { color: isSelf ? "#FFFFFF" : color }]}
                numberOfLines={1}
              >
                {initials}
              </Text>
            </View>

            {isHost ? (
              <View style={[styles.hostBadge, { backgroundColor: color }]}>
                <Text style={styles.hostBadgeText}>★</Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Inside the frame, so the marker's centre stays the rider's spot. */}
      <View
        style={[
          styles.chipRow,
          riding && styles.chipRowRiding,
          riding && isSelf && styles.chipRowSelfRiding,
        ]}
      >
        <View
          style={[
            styles.chip,
            isSelf && { backgroundColor: color },
            isStale && !isSos && styles.stale,
          ]}
        >
          {!isSelf ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
          <Text style={styles.chipText} numberOfLines={1}>
            {isHost ? `${name} ★` : name}
          </Text>
        </View>
      </View>
    </View>
  );
}

export const RiderMarker = memo(RiderMarkerBase);

/**
 * The riding arrow, drawn pointing up; the caller rotates it.
 *
 * Its visual centre — not its tip — sits on the rider's position, so turning
 * it pivots on the spot instead of swinging the tail around.
 */
function Arrow({ color, size, halo }: { color: string; size: number; halo: boolean }) {
  const offset = (FRAME - size) / 2;
  return (
    <>
      {halo ? (
        <View
          style={[styles.halo, { backgroundColor: color, borderColor: color }]}
        />
      ) : null}
      <Svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        style={{ position: "absolute", left: offset, top: offset }}
      >
        {/* Drop shadow: the same outline, offset and faint. */}
        <Path d={ARROW} fill="#000000" opacity={0.28} transform="translate(0.8 2.2)" />
        <Path
          d={ARROW}
          fill="#FFFFFF"
          stroke="#FFFFFF"
          strokeWidth={5}
          strokeLinejoin="round"
        />
        <Path d={ARROW_LEFT} fill={color} />
        <Path d={ARROW_RIGHT} fill={color} />
        {/* Darken one side so the arrow reads as a folded, solid shape. */}
        <Path d={ARROW_RIGHT} fill="#000000" opacity={0.22} />
      </Svg>
    </>
  );
}

/** Your facing direction while parked: a soft cone of light ahead of you. */
function Beam({ color }: { color: string }) {
  return (
    <Svg width={FRAME} height={FRAME} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="beam" cx={C} cy={C} r={BEAM_R} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={color} stopOpacity={0.6} />
          <Stop offset="0.55" stopColor={color} stopOpacity={0.28} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Path d={BEAM} fill="url(#beam)" />
    </Svg>
  );
}

/** Someone else's facing direction: a small pointer on their ring. */
function Notch({ color }: { color: string }) {
  return (
    <Svg width={FRAME} height={FRAME} style={StyleSheet.absoluteFill}>
      <Path
        d={NOTCH}
        fill={color}
        stroke="#FFFFFF"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A ring that swells and fades on a loop, so an SOS cannot be missed. */
function SosPulse() {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 1200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  return (
    <>
      <View style={styles.sosCore} />
      <Animated.View
        style={[
          styles.sosRing,
          {
            opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
            transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.5] }) }],
          },
        ]}
      />
    </>
  );
}

const SOS_RED = "#D32029";

/** The square every marker is drawn in; the rider's position is its centre. */
const FRAME = 128;
const C = FRAME / 2;
const DISC = 38;
const BEAM_R = 60;

// 48-unit arrow: tip at the top, a notch cut into the tail. Its centroid sits
// at (24, 25), close enough to the box centre to turn on the spot.
const ARROW = "M24 5 L40.5 41 Q41.2 43 39.2 42.2 L24 35.5 L8.8 42.2 Q6.8 43 7.5 41 Z";
const ARROW_LEFT = "M24 5 L24 35.5 L8.8 42.2 Q6.8 43 7.5 41 Z";
const ARROW_RIGHT = "M24 5 L40.5 41 Q41.2 43 39.2 42.2 L24 35.5 Z";

/** A 64° wedge fanning up from the centre. */
const BEAM = (() => {
  const half = (32 * Math.PI) / 180;
  const x1 = C - BEAM_R * Math.sin(half);
  const x2 = C + BEAM_R * Math.sin(half);
  const y = C - BEAM_R * Math.cos(half);
  return `M${C} ${C} L${x1} ${y} A${BEAM_R} ${BEAM_R} 0 0 1 ${x2} ${y} Z`;
})();

/** A small triangle just outside the top of the disc. */
const NOTCH = (() => {
  const base = C - DISC / 2 + 1;
  return `M${C} ${base - 11} L${C + 7} ${base} L${C - 7} ${base} Z`;
})();

const styles = StyleSheet.create({
  root: { width: FRAME, height: FRAME },
  frame: {
    width: FRAME,
    height: FRAME,
    alignItems: "center",
    justifyContent: "center",
  },
  stale: { opacity: 0.45 },

  halo: {
    position: "absolute",
    left: C - 30,
    top: C - 30,
    width: 60,
    height: 60,
    borderRadius: 30,
    opacity: 0.16,
    borderWidth: 1,
  },

  sosCore: {
    position: "absolute",
    width: DISC + 22,
    height: DISC + 22,
    borderRadius: (DISC + 22) / 2,
    backgroundColor: "rgba(211, 32, 41, 0.22)",
    borderWidth: 3,
    borderColor: SOS_RED,
  },
  sosRing: {
    position: "absolute",
    width: DISC + 44,
    height: DISC + 44,
    borderRadius: (DISC + 44) / 2,
    borderWidth: 4,
    borderColor: SOS_RED,
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
  initials: { fontSize: 13, fontWeight: "900", letterSpacing: 0.3 },

  hostBadge: {
    position: "absolute",
    top: C - DISC / 2 - 5,
    left: C + DISC / 2 - 12,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  hostBadgeText: { fontSize: 9, color: "#FFFFFF", fontWeight: "900", marginTop: -1 },

  chipRow: {
    position: "absolute",
    top: C + DISC / 2 + 5,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  /** The arrow reaches a little lower than the disc. */
  chipRowRiding: { top: C + 24 },
  /** Your arrow is bigger and sits in a halo; the label clears both. */
  chipRowSelfRiding: { top: C + 31 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    maxWidth: FRAME,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: "rgba(12, 16, 22, 0.86)",
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", flexShrink: 1 },
});
