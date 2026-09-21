import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { Button } from "../src/components/Button";
import { useRider } from "../src/components/RiderProvider";
import { Screen } from "../src/components/Screen";
import { TopBar } from "../src/components/TopBar";
import { createParty, type Party } from "../src/lib/party";
import { rideCodeToLink } from "../src/lib/rideCode";
import { colors, font, radius, space } from "../src/theme";

/**
 * Creates the party immediately on open.
 *
 * There is no form: the ride is named after the host, so the only thing
 * between tapping "Host a ride" and having a code to share is a round trip.
 */
export default function HostScreen() {
  const { rider, ready } = useRider();
  const [party, setParty] = useState<Party | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ready || !rider) return;
    let cancelled = false;

    setError(null);
    void createParty(rider.id, rider.name).then((result) => {
      if (cancelled) return;
      if (result.status === "ok") setParty(result.party);
      else setError(result.message);
    });

    return () => {
      cancelled = true;
    };
  }, [ready, rider, attempt]);

  const copyCode = async () => {
    if (!party) return;
    await Clipboard.setStringAsync(party.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const shareCode = async () => {
    if (!party) return;
    await Share.share({
      message: `Join my ride on Cruzo.\n\nCode: ${party.code}\n${rideCodeToLink(party.code)}`,
    });
  };

  if (error) {
    return (
      <Screen scroll>
        <TopBar title="Host a ride" onBack={() => router.back()} />
        <Text style={styles.error}>{error}</Text>
        <Button label="Try again" onPress={() => setAttempt((n) => n + 1)} />
      </Screen>
    );
  }

  if (!party) {
    return (
      <Screen scroll>
        <TopBar title="Host a ride" onBack={() => router.back()} />
        <Text style={styles.lead}>Opening your party…</Text>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <TopBar title="Party ready" onBack={() => router.back()} />

      <Text style={styles.lead}>
        Share this with your group. They can scan it, or type the code.
      </Text>

      <View style={styles.qrCard}>
        <View style={styles.qrFrame}>
          <QRCode
            value={rideCodeToLink(party.code)}
            size={196}
            backgroundColor="#FFFFFF"
            color="#0B0E13"
          />
        </View>
      </View>

      <Pressable
        onPress={() => void copyCode()}
        accessibilityRole="button"
        accessibilityLabel={`Ride code ${party.code.split("").join(" ")}. Tap to copy.`}
        style={({ pressed }) => [styles.codeCard, pressed && styles.codeCardPressed]}
      >
        <Text style={styles.codeLabel}>RIDE CODE</Text>
        <Text style={styles.code}>{party.code}</Text>
        <Text style={styles.copyHint}>{copied ? "Copied" : "Tap to copy"}</Text>
      </Pressable>

      <View style={styles.actions}>
        <Button label="Share invite" onPress={() => void shareCode()} />
        <Button
          label="Open the map"
          variant="secondary"
          onPress={() => router.replace(`/ride/${party.code}`)}
        />
      </View>

      <Text style={styles.footer}>
        The party stays open for 12 hours. Riders can join at any time, and you
        can share the code again from the map.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { color: colors.textDim, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  qrCard: { alignItems: "center", gap: space.md },
  qrFrame: {
    backgroundColor: "#FFFFFF",
    padding: space.lg,
    borderRadius: radius.lg,
  },
  codeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
    alignItems: "center",
    gap: space.xs,
  },
  codeCardPressed: { backgroundColor: colors.surfaceAlt },
  codeLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  code: {
    color: colors.accent,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: 9,
    fontFamily: font.mono,
    marginLeft: 9,
  },
  copyHint: { color: colors.textFaint, fontSize: 12 },
  actions: { gap: space.md },
  footer: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
});
