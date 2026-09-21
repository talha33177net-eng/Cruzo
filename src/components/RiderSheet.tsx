import type { LngLat } from "@maplibre/maplibre-react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { STALE_AFTER_MS } from "../lib/config";
import {
  bearingDegrees,
  compassPoint,
  distanceMeters,
  formatAgo,
  formatDistance,
  formatSpeed,
} from "../lib/geo";
import { destinationOf } from "../lib/groupTrip";
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
  onToggle: () => void;
  onFocusRider: (rider: RiderState) => void;
  now: number;
};

/**
 * Bottom panel listing everyone in the party.
 *
 * Collapsed it is a single tappable strip showing the head count, so it never
 * covers much of the map; expanded it lists each rider with their distance and
 * bearing relative to the viewer.
 */
export function RiderSheet({
  riders,
  selfId,
  selfPosition,
  colorFor,
  expanded,
  onToggle,
  onFocusRider,
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

  return (
    <View style={styles.sheet}>
      <Pressable
        onPress={onToggle}
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

      {expanded ? (
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
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
                      rider.bike || null,
                      away,
                      stale ? formatAgo(rider.updatedAt, now) : null,
                    ]
                      .filter(Boolean)
                      .join("  ·  ") || "In the party"}
                  </Text>
                </View>

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
      ) : null}
    </View>
  );
}

const SOS_RED = "#D32029";

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
    list: { maxHeight: 280 },
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
    speedBox: { alignItems: "flex-end", minWidth: 46 },
    speed: { color: c.text, fontSize: 18, fontWeight: "800" },
    speedStale: { color: c.textFaint },
    speedUnit: { color: c.textFaint, fontSize: 10, marginTop: -2 },
    listFoot: { height: space.md },
  });
