import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { formatDistance } from "../lib/geo";
import { formatDuration, formatEta } from "../lib/navigation";
import type { Destination, Route } from "../lib/types";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  routes: Route[];
  selectedIndex: number;
  stops: Destination[];
  onSelect: (index: number) => void;
  onAddStop: () => void;
  onRemoveStop: (index: number) => void;
  onStart: () => void;
  onCancel: () => void;
};

/**
 * The panel shown once routes are back but before the ride begins.
 *
 * Nothing is announced and nothing is tracked while this is up: the rider is
 * choosing. On a group ride that pause is the point — everyone agrees on a
 * route and adds the fuel stop before anyone sets off.
 */
export function RoutePreview({
  routes,
  selectedIndex,
  stops,
  onSelect,
  onAddStop,
  onRemoveStop,
  onStart,
  onCancel,
}: Props) {
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);

  const fastest = useMemo(() => {
    if (routes.length === 0) return -1;
    let best = 0;
    routes.forEach((r, i) => {
      if (r.durationS < routes[best].durationS) best = i;
    });
    return best;
  }, [routes]);

  const shortest = useMemo(() => {
    if (routes.length === 0) return -1;
    let best = 0;
    routes.forEach((r, i) => {
      if (r.distanceM < routes[best].distanceM) best = i;
    });
    return best;
  }, [routes]);

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>
          {routes.length > 1 ? `${routes.length} routes` : "Route"}
        </Text>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel this route"
          hitSlop={10}
        >
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>

      {routes.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.optionRow}
        >
          {routes.map((r, i) => {
            const selected = i === selectedIndex;
            // Only badge a route when it is uniquely best, otherwise every
            // option ends up wearing a label and none of them mean anything.
            const badge =
              i === fastest && fastest !== shortest
                ? "Fastest"
                : i === shortest && fastest !== shortest
                  ? "Shortest"
                  : null;

            return (
              <Pressable
                key={i}
                onPress={() => onSelect(i)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Route ${i + 1}, ${formatDuration(r.durationS)}, ${formatDistance(r.distanceM)}`}
                style={[styles.option, selected && styles.optionSelected]}
              >
                <Text style={[styles.optionTime, selected && styles.optionTimeSelected]}>
                  {formatDuration(r.durationS)}
                </Text>
                <Text style={styles.optionDistance}>{formatDistance(r.distanceM)}</Text>
                {badge ? <Text style={styles.optionBadge}>{badge}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.stops}>
        {stops.map((s, i) => {
          const last = i === stops.length - 1;
          return (
            <View key={`${s.label}-${i}`} style={styles.stopRow}>
              <Text style={styles.stopGlyph}>{last ? "◉" : "◍"}</Text>
              <Text style={styles.stopLabel} numberOfLines={1}>
                {s.label}
              </Text>
              {stops.length > 1 ? (
                <Pressable
                  onPress={() => onRemoveStop(i)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove stop ${s.label}`}
                  hitSlop={10}
                >
                  <Text style={styles.stopRemove}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onAddStop}
          accessibilityRole="button"
          accessibilityLabel="Add a stop along the way"
          style={({ pressed }) => [styles.addStop, pressed && styles.pressed]}
        >
          <Text style={styles.addStopText}>+ Add stop</Text>
        </Pressable>

        <Pressable
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel="Start the ride"
          style={({ pressed }) => [styles.start, pressed && styles.pressed]}
        >
          <Text style={styles.startText}>Start</Text>
          <Text style={styles.startEta}>
            {routes[selectedIndex]
              ? `arrive ${formatEta(routes[selectedIndex].durationS)}`
              : ""}
          </Text>
        </Pressable>
      </View>
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
      gap: space.sm,
    },
    headerRow: { flexDirection: "row", alignItems: "center" },
    heading: { flex: 1, color: c.text, fontSize: 16, fontWeight: "800" },
    cancel: { color: c.textDim, fontSize: 14, fontWeight: "600" },

    optionRow: { gap: space.sm, paddingVertical: 2 },
    option: {
      minWidth: 104,
      borderWidth: 1.5,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      backgroundColor: c.surfaceAlt,
    },
    optionSelected: { borderColor: c.accent, backgroundColor: c.accentWash },
    optionTime: { color: c.text, fontSize: 17, fontWeight: "900" },
    optionTimeSelected: { color: c.accent },
    optionDistance: { color: c.textDim, fontSize: 12 },
    optionBadge: {
      color: c.textFaint,
      fontSize: 10,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginTop: 2,
    },

    stops: { gap: space.xs, paddingTop: space.xs },
    stopRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
    stopGlyph: { color: c.accent, fontSize: 13, width: 16, textAlign: "center" },
    stopLabel: { flex: 1, color: c.text, fontSize: 13, fontWeight: "600" },
    stopRemove: { color: c.textFaint, fontSize: 14, fontWeight: "800" },

    actions: { flexDirection: "row", alignItems: "stretch", gap: space.sm },
    addStop: {
      justifyContent: "center",
      paddingHorizontal: space.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    addStopText: { color: c.text, fontWeight: "700", fontSize: 13 },
    start: {
      flex: 1,
      backgroundColor: c.accent,
      borderRadius: radius.md,
      paddingVertical: space.md,
      alignItems: "center",
    },
    startText: { color: c.onAccent, fontWeight: "900", fontSize: 17 },
    startEta: { color: c.onAccent, opacity: 0.85, fontSize: 11 },
    pressed: { opacity: 0.75 },
  });
