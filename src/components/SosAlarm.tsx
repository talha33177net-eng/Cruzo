import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { formatDistance } from "../lib/geo";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  name: string;
  /** Metres from the viewer to the rider in trouble, if known. */
  distanceM: number | null;
  bearing: string | null;
  onShow: () => void;
  onDismiss: () => void;
};

/**
 * The banner shown to everyone else when a rider raises an SOS.
 *
 * Deliberately loud: full-width, red, pulsing, and sitting over the turn card
 * rather than beside it. Everything else on this screen can wait.
 */
export function SosAlarm({ name, distanceM, bearing, onShow, onDismiss }: Props) {
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 550,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 550,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  const where = [
    distanceM != null ? formatDistance(distanceM) : null,
    bearing,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Animated.View style={[styles.card, { transform: [{ scale }] }]}>
      <Animated.View style={[styles.badge, { opacity: glow }]}>
        <Text style={styles.badgeText}>SOS</Text>
      </Animated.View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {name} needs help
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {where ? `${where} from you` : "Position unknown"}
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onShow}
          accessibilityRole="button"
          accessibilityLabel={`Show ${name} on the map`}
          style={({ pressed }) => [styles.show, pressed && styles.pressed]}
        >
          <Text style={styles.showText}>Show</Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Silence this alert"
          hitSlop={8}
          style={({ pressed }) => [styles.mute, pressed && styles.pressed]}
        >
          <Text style={styles.muteText}>Silence</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const RED = "#D32029";

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      backgroundColor: RED,
      borderRadius: radius.lg,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      elevation: 8,
      shadowColor: RED,
      shadowOpacity: 0.5,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    badge: {
      width: 54,
      height: 54,
      borderRadius: radius.md,
      backgroundColor: "rgba(255,255,255,0.18)",
      borderWidth: 2,
      borderColor: "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900", letterSpacing: 1 },
    body: { flex: 1, gap: 2 },
    title: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
    sub: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
    actions: { alignItems: "stretch", gap: space.xs },
    show: {
      backgroundColor: "#FFFFFF",
      borderRadius: radius.md,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      alignItems: "center",
    },
    showText: { color: RED, fontWeight: "900", fontSize: 13 },
    mute: { paddingHorizontal: space.sm, paddingVertical: 2, alignItems: "center" },
    muteText: { color: "rgba(255,255,255,0.9)", fontWeight: "700", fontSize: 11 },
    pressed: { opacity: 0.75 },
  });
