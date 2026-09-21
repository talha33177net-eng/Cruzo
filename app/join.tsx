import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";

import { Button } from "../src/components/Button";
import { CodeInput } from "../src/components/CodeInput";
import { Screen } from "../src/components/Screen";
import { TopBar } from "../src/components/TopBar";
import { findParty } from "../src/lib/party";
import { isValidRideCode, normalizeRideCode } from "../src/lib/rideCode";
import { colors, space } from "../src/theme";

const MESSAGES: Record<string, string> = {
  not_found: "No ride with that code. It may have ended, or everyone has left — double-check it with the host.",
};

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against re-verifying the same deep-linked code on every re-render.
  const verifiedRef = useRef<string | null>(null);

  const verify = useCallback(async (candidate: string) => {
    setBusy(true);
    setError(null);

    const result = await findParty(candidate);
    setBusy(false);

    if (result.status === "ok") {
      router.replace(`/ride/${candidate}`);
      return;
    }

    verifiedRef.current = null;
    setError(
      result.status === "error"
        ? `Could not reach the server: ${result.message}`
        : MESSAGES[result.status],
    );
  }, []);

  // A code arriving from a QR scan or a deep link verifies itself.
  useEffect(() => {
    const incoming = normalizeRideCode(params.code ?? "");
    if (!isValidRideCode(incoming) || verifiedRef.current === incoming) return;

    verifiedRef.current = incoming;
    setCode(incoming);
    void verify(incoming);
  }, [params.code, verify]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen scroll>
        <TopBar title="Join a ride" onBack={() => router.back()} />

        <Text style={styles.lead}>
          Enter the six-character code from the host, or scan their QR.
        </Text>

        <View style={styles.codeWrap}>
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next);
              setError(null);
            }}
            onComplete={(next) => void verify(next)}
            autoFocus
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          <Button
            label="Join ride"
            onPress={() => void verify(code)}
            disabled={!isValidRideCode(code)}
            loading={busy}
          />
          <Button
            label="Scan QR code"
            variant="secondary"
            onPress={() => router.push("/scan")}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  lead: { color: colors.textDim, fontSize: 15, lineHeight: 22 },
  codeWrap: { paddingVertical: space.lg },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  actions: { gap: space.md },
});
