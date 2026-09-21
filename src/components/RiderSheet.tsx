import type { LngLat } from "@maplibre/maplibre-react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { STALE_AFTER_MS } from "../lib/config";
import {
  bearingDegrees,
  compassPoint,
  distanceMeters,
  formatAgo,
  formatDistance,
  formatSpeed,
} from "../lib/geo";
import { destinationOf, SAME_PLACE_M } from "../lib/groupTrip";
import { initialsOf } from "../lib/identity";
import type { RiderState } from "../lib/types";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  riders: RiderState[];
  selfId: string;
  selfPosition: LngLat | null;
  colorFor: (id: string) => string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onFocusRider: (rider: RiderState) => void;
  /**
   * Plans this rider's own route to where `rider` is heading.
   *
   * Offered on every rider with a journey under way, not only the one the
   * suggestion card picked: anyone should be able to go wherever anyone
   * else is going.
   */
  onJoinTrip: (rider: RiderState) => void;
  /** Where this rider is already heading, so a matching row can say so. */
  selfDestination: LngLat | null;
  now: number;
};

/**
 * Bottom panel listing everyone in the party.
 *
 * Collapsed it is a single strip showing the head count, so it never covers
 * much of the map; pulled up it lists each rider with their distance and
 * bearing relative to the viewer.
 *
 * It is a swipe-up sheet, as in Google Maps: the list follows the finger while
 * the handle is dragged, and on release settles open or shut by where it was
 * let go and how fast it was flicked. A tap still toggles it.
 */
export function RiderSheet({
  riders,
  selfId,
  selfPosition,
  colorFor,
  expanded,
  onExpandedChange,
  onFocusRider,
  onJoinTrip,
  selfDestination,
  now,
}: Props) {
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);

  const sorted = [...riders].sort((a, b) => {
    // Anyone in trouble outranks everything, including you.
    if (a.sos !== b.sos) return a.sos ? -1 : 1;
    if (a.id === selfId) return -1;
    if (b.id === selfId) return 1;
    if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Open height: every row if they fit, else a scrolling list.
  const listHeight = Math.min(LIST_MAX, sorted.length * ROW_H + FOOT_H);

  /** 0 = shut, 1 = open. Follows the finger while dragging. */
  const openness = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const dragStart = useRef(0);

  const settle = useCallback(
    (open: boolean) => {
      Animated.spring(openness, {
        toValue: open ? 1 : 0,
        useNativeDriver: false, // animates height, which the native driver cannot
        speed: 18,
        bounciness: 2,
      }).start();
      if (open !== expanded) onExpandedChange(open);
    },
    [openness, expanded, onExpandedChange],
  );

  // Opened or closed from outside (say, after joining someone's trip).
  useEffect(() => {
    Animated.spring(openness, {
      toValue: expanded ? 1 : 0,
      useNativeDriver: false,
      speed: 18,
      bounciness: 2,
    }).start();
  }, [expanded, openness]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Capture, so the drag is taken from the Pressable inside once the
        // finger moves; only a mostly-vertical drag counts, so a plain tap
        // still reaches the Pressable.
        onMoveShouldSetPanResponderCapture: (_, g) =>
          Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          openness.stopAnimation((value) => {
            dragStart.current = value;
          });
        },
        onPanResponderMove: (_, g) => {
          const next = dragStart.current - g.dy / listHeight;
          openness.setValue(Math.max(0, Math.min(1, next)));
        },
        onPanResponderRelease: (_, g) => {
          const reached = dragStart.current - g.dy / listHeight;
          // A flick wins over position; otherwise whichever half it is in.
          const open =
            g.vy < -FLICK ? true : g.vy > FLICK ? false : reached > 0.5;
          settle(open);
        },
        onPanResponderTerminate: () => settle(expanded),
      }),
    [openness, listHeight, settle, expanded],
  );

  return (
    <View style={styles.sheet}>
      {/* The drag lives on a wrapper: Pressable installs its own touch
          handlers, which would override any spread onto it. */}
      <View {...pan.panHandlers}>
      <Pressable
        onPress={() => settle(!expanded)}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? "Hide rider list" : `Show rider list, ${riders.length} riding`
        }
        style={styles.handleRow}
      >
        <View style={styles.grabber} />
        <View style={styles.headerRow}>
          <Text style={styles.headerCount}>
            {riders.length} {riders.length === 1 ? "rider" : "riders"}
          </Text>
          <View style={styles.avatarRow}>
            {sorted.slice(0, 5).map((rider) => (
              <View
                key={rider.id}
                style={[styles.avatar, { borderColor: colorFor(rider.id) }]}
              >
                <Text style={[styles.avatarText, { color: colorFor(rider.id) }]}>
                  {initialsOf(rider.name)}
                </Text>
              </View>
            ))}
            {sorted.length > 5 ? (
              <View style={[styles.avatar, styles.avatarMore]}>
                <Text style={styles.avatarMoreText}>+{sorted.length - 5}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.chevron}>{expanded ? "⌄" : "⌃"}</Text>
        </View>
      </Pressable>
      </View>

      <Animated.View
        style={[
          styles.listClip,
          {
            height: openness.interpolate({
              inputRange: [0, 1],
              outputRange: [0, listHeight],
            }),
          },
        ]}
      >
        <ScrollView
          style={{ height: listHeight }}
          showsVerticalScrollIndicator={false}
        >
          {sorted.map((rider) => {
            const isSelf = rider.id === selfId;
            const color = colorFor(rider.id);
            const stale = now - rider.updatedAt > STALE_AFTER_MS;

            const target: LngLat = [rider.lng, rider.lat];
            const away =
              selfPosition && !isSelf
                ? `${formatDistance(distanceMeters(selfPosition, target))} ${compassPoint(
                    bearingDegrees(selfPosition, target),
                  )}`
                : null;

            return (
              <Pressable
                key={rider.id}
                onPress={() => onFocusRider(rider)}
                accessibilityRole="button"
                accessibilityLabel={`Centre the map on ${isSelf ? "you" : rider.name}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View
                  style={[
                    styles.rowAvatar,
                    { borderColor: rider.sos ? SOS_RED : color },
                    rider.sos && styles.rowAvatarSos,
                  ]}
                >
                  <Text style={[styles.rowAvatarText, { color }]}>
                    {initialsOf(rider.name)}
                  </Text>
                </View>

                <View style={styles.rowMain}>
                  <View style={styles.rowTitleLine}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {rider.name || "Rider"}
                    </Text>
                    {rider.sos ? <Text style={styles.tagSos}>SOS</Text> : null}
                    {isSelf ? <Text style={styles.tagYou}>YOU</Text> : null}
                    {rider.isHost ? <Text style={styles.tagHost}>HOST</Text> : null}
                  </View>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {[
                      destinationOf(rider) ? `→ ${destinationOf(rider)!.label}` : null,
                      away,
                      stale ? formatAgo(rider.updatedAt, now) : null,
                    ]
                      .filter(Boolean)
                      .join("  ·  ") || "In the party"}
                  </Text>
                </View>

                {!isSelf && destinationOf(rider) ? (
                  selfDestination &&
                  distanceMeters(selfDestination, destinationOf(rider)!.lngLat) <= SAME_PLACE_M ? (
                    <Text style={styles.withYou}>With you</Text>
                  ) : (
                    <Pressable
                      onPress={() => onJoinTrip(rider)}
                      accessibilityRole="button"
                      accessibilityLabel={`Ride to ${destinationOf(rider)!.label}, where ${rider.name} is heading`}
                      hitSlop={6}
                      style={({ pressed }) => [styles.join, pressed && styles.joinPressed]}
                    >
                      <Text style={styles.joinText}>Ride there</Text>
                    </Pressable>
                  )
                ) : null}

                <View style={styles.speedBox}>
                  <Text style={[styles.speed, stale && styles.speedStale]}>
                    {formatSpeed(rider.speed)}
                  </Text>
                  <Text style={styles.speedUnit}>km/h</Text>
                </View>
              </Pressable>
            );
          })}
          <View style={styles.listFoot} />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const SOS_RED = "#D32029";

/** Tallest the open list gets before it scrolls. */
const LIST_MAX = 300;
/** One rider row: avatar, padding and divider. */
const ROW_H = 63;
const FOOT_H = 12;
/** Release speed (px/ms) that counts as a flick. */
const FLICK = 0.4;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderTopWidth: 1,
      borderColor: c.border,
      paddingHorizontal: space.lg,
    },
    handleRow: { paddingTop: space.sm, paddingBottom: space.md },
    grabber: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.surfaceHigh,
      alignSelf: "center",
      marginBottom: space.md,
    },
    headerRow: { flexDirection: "row", alignItems: "center", gap: space.md },
    headerCount: { color: c.text, fontSize: 16, fontWeight: "800" },
    // Overlapped via each avatar's negative margin; Yoga rejects a negative gap.
    avatarRow: { flexDirection: "row", flex: 1 },
    avatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 2,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -6,
    },
    avatarText: { fontSize: 10, fontWeight: "800" },
    avatarMore: { borderColor: c.border },
    avatarMoreText: { fontSize: 10, fontWeight: "800", color: c.textDim },
    chevron: { color: c.textDim, fontSize: 18, fontWeight: "800" },
    listClip: { overflow: "hidden" },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      paddingVertical: space.md,
      borderTopWidth: 1,
      borderTopColor: c.borderSoft,
    },
    rowPressed: { backgroundColor: c.surfaceAlt },
    rowAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 2,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    rowAvatarSos: { backgroundColor: "rgba(211, 32, 41, 0.18)" },
    rowAvatarText: { fontSize: 13, fontWeight: "800" },
    tagSos: {
      color: "#FFFFFF",
      backgroundColor: SOS_RED,
      fontSize: 9,
      fontWeight: "900",
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: "hidden",
    },
    rowMain: { flex: 1, gap: 2 },
    rowTitleLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
    rowName: { color: c.text, fontSize: 15, fontWeight: "700", flexShrink: 1 },
    tagYou: {
      color: c.surface,
      backgroundColor: c.text,
      fontSize: 9,
      fontWeight: "900",
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: "hidden",
    },
    tagHost: {
      color: c.accent,
      borderColor: c.accentDim,
      borderWidth: 1,
      fontSize: 9,
      fontWeight: "900",
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: "hidden",
    },
    rowMeta: { color: c.textDim, fontSize: 12 },
    join: {
      backgroundColor: c.accent,
      borderRadius: radius.pill,
      paddingHorizontal: space.md,
      paddingVertical: space.xs + 2,
    },
    joinPressed: { opacity: 0.75 },
    joinText: { color: c.onAccent, fontSize: 12, fontWeight: "900" },
    withYou: { color: c.success, fontSize: 11, fontWeight: "800" },
    speedBox: { alignItems: "flex-end", minWidth: 46 },
    speed: { color: c.text, fontSize: 18, fontWeight: "800" },
    speedStale: { color: c.textFaint },
    speedUnit: { color: c.textFaint, fontSize: 10, marginTop: -2 },
    listFoot: { height: space.md },
  });
