import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button } from "../src/components/Button";
import { Field } from "../src/components/Field";
import { useRider } from "../src/components/RiderProvider";
import { Screen } from "../src/components/Screen";
import { isBackendConfigured } from "../src/lib/config";
import { colors, radius, space } from "../src/theme";

export default function HomeScreen() {
  const { rider, ready, updateProfile } = useRider();
  const [name, setName] = useState("");
  const [bike, setBike] = useState("");

  // Seed the inputs once the stored profile arrives.
  useEffect(() => {
    if (!rider) return;
    setName(rider.name);
    setBike(rider.bike);
  }, [rider]);

  const trimmedName = name.trim();
  const canContinue = ready && trimmedName.length > 0 && isBackendConfigured;

  const go = async (path: "/host" | "/join") => {
    await updateProfile(trimmedName, bike);
    router.push(path);
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

        <View style={styles.form}>
          <Field
            label="Your name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Rafi"
            autoCapitalize="words"
            maxLength={24}
            returnKeyType="next"
          />
          <Field
            label="Your bike"
            value={bike}
            onChangeText={setBike}
            placeholder="Optional — e.g. R15 V4"
            autoCapitalize="words"
            maxLength={24}
            hint="Shown to other riders in the party list."
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
