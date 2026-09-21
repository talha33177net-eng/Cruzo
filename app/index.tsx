import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "../src/components/Button";
import { Field } from "../src/components/Field";
import { useRider } from "../src/components/RiderProvider";
import { Screen } from "../src/components/Screen";
import { isBackendConfigured } from "../src/lib/config";
import { findParty } from "../src/lib/party";
import { forgetRide, loadRecentRides, type RecentRide } from "../src/lib/recentRides";
import { colors, radius, space } from "../src/theme";

export default function HomeScreen() {
  const { rider, ready, updateProfile } = useRider();
  const [name, setName] = useState("");

  // Seed the inputs once the stored profile arrives.
  useEffect(() => {
    if (!rider) return;
    setName(rider.name);
  }, [rider]);

  const [activeRides, setActiveRides] = useState<RecentRide[]>([]);

  /**
   * Rides this phone was in that are still going.
   *
   * Checked every time the screen comes back into view, because that is
   * exactly when it matters: a rider thrown out of a ride by a dropped
   * connection or a stray back swipe lands here, and should be one tap from
   * getting back in rather than asking for the code again.
   */
  useFocusEffect(
    useCallback(() => {
      if (!isBackendConfigured) return;
      let cancelled = false;

      void (async () => {
        const recent = await loadRecentRides();
        const checked = await Promise.all(
          recent.map(async (ride) => {
            const result = await findParty(ride.code);
            if (result.status === "not_found") {
              void forgetRide(ride.code);
              return null;
            }
            // A failed lookup is not proof the ride is over; keep offering it.
            return result.status === "ok"
              ? { ...ride, hostName: result.party.hostName }
              : ride;
          }),
        );
        if (!cancelled) setActiveRides(checked.filter((r): r is RecentRide => r !== null));
      })();

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const trimmedName = name.trim();
  const canContinue = ready && trimmedName.length > 0 && isBackendConfigured;

  const go = async (path: "/host" | "/join") => {
    await updateProfile(trimmedName);
    router.push(path);
  };

  const rejoin = async (code: string) => {
    await updateProfile(trimmedName);
    router.push(`/ride/${code}`);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen scroll>
        <View style={styles.brand}>
          <Image
            source={require("../assets/icon.png")}
            style={styles.mark}
            accessibilityIgnoresInvertColors
          />
          <Text style={styles.wordmark}>CRUZO</Text>
          <Text style={styles.tagline}>
            Ride together. See every bike in your party, live on the map.
          </Text>
        </View>

        {!isBackendConfigured ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Backend not configured</Text>
            <Text style={styles.noticeBody}>
              Add your Supabase URL and anon key to the project&apos;s{" "}
              <Text style={styles.code}>.env</Text> file, then restart the dev
              server. See <Text style={styles.code}>README.md</Text> for the
              two-minute setup.
            </Text>
          </View>
        ) : null}

        {activeRides.map((ride) => (
          <Pressable
            key={ride.code}
            onPress={() => void rejoin(ride.code)}
            disabled={!canContinue}
            accessibilityRole="button"
            accessibilityLabel={`Rejoin ${ride.hostName}'s ride, code ${ride.code.split("").join(" ")}`}
            style={({ pressed }) => [
              styles.active,
              pressed && styles.activePressed,
              !canContinue && styles.activeDisabled,
            ]}
          >
            <View style={styles.liveDot} />
            <View style={styles.activeBody}>
              <Text style={styles.activeLabel}>RIDE STILL GOING</Text>
              <Text style={styles.activeTitle} numberOfLines={1}>
                {ride.hostName}&apos;s ride
              </Text>
              <Text style={styles.activeCode}>{ride.code}</Text>
            </View>
            <View style={styles.rejoinPill}>
              <Text style={styles.rejoinText}>Rejoin</Text>
            </View>
          </Pressable>
        ))}

        <View style={styles.form}>
          <Field
            label="Your name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Rafi"
            autoCapitalize="words"
            maxLength={24}
            returnKeyType="done"
            hint="Shown to the other riders in your party."
          />
        </View>

        <View style={styles.actions}>
          <Button
            label="Host a ride"
            onPress={() => void go("/host")}
            disabled={!canContinue}
          />
          <Button
            label="Join a ride"
            variant="secondary"
            onPress={() => void go("/join")}
            disabled={!canContinue}
          />
        </View>

        <Text style={styles.footer}>
          Maps by OpenStreetMap contributors via OpenFreeMap. Your location is
          shared only with riders in your party, and only while the ride screen
          is open.
        </Text>

        <Text style={styles.credit}>
          Made with <Text style={styles.heart}>♥</Text> by Talha
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  brand: { alignItems: "center", gap: space.md, paddingTop: space.xxl },
  mark: {
    width: 84,
    height: 84,
    borderRadius: radius.xl,
    transform: [{ rotate: "-6deg" }],
  },
  wordmark: {
    color: colors.text,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: 6,
  },
  tagline: {
    color: colors.textDim,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: space.md,
  },
  notice: {
    backgroundColor: colors.accentWash,
    borderWidth: 1,
    borderColor: colors.accentDim,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
  noticeTitle: { color: colors.accent, fontWeight: "800", fontSize: 14 },
  noticeBody: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  code: { color: colors.text, fontFamily: "monospace" },
  form: { gap: space.lg, paddingTop: space.md },
  active: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.success,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  activePressed: { opacity: 0.8 },
  activeDisabled: { opacity: 0.5 },
  liveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 3,
    borderColor: "rgba(32, 164, 100, 0.3)",
  },
  activeBody: { flex: 1, gap: 1 },
  activeLabel: {
    color: colors.success,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  activeTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  activeCode: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    fontFamily: "monospace",
  },
  rejoinPill: {
    backgroundColor: colors.success,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
  },
  rejoinText: { color: "#04140B", fontWeight: "900", fontSize: 14 },
  actions: { gap: space.md, paddingTop: space.sm },
  credit: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    paddingTop: space.xs,
  },
  heart: { color: colors.accent },
  footer: {
    color: colors.textFaint,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    paddingTop: space.sm,
  },
});
