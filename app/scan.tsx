import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../src/components/Button";
import { parseScannedPayload } from "../src/lib/rideCode";
import { colors, radius, space } from "../src/theme";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [rejected, setRejected] = useState(false);
  const insets = useSafeAreaInsets();

  // The camera fires continuously; this latches the first valid read so we
  // navigate exactly once.
  const handled = useRef(false);

  const onBarcode = ({ data }: { data: string }) => {
    if (handled.current) return;

    const code = parseScannedPayload(data);
    if (!code) {
      setRejected(true);
      return;
    }

    handled.current = true;
    router.replace({ pathname: "/join", params: { code } });
  };

  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.body}>
          Cruzo uses the camera only to read a party&apos;s QR code. Nothing is
          recorded or uploaded.
        </Text>
        <View style={styles.permActions}>
          <Button label="Allow camera" onPress={() => void requestPermission()} />
          <Button
            label="Enter code instead"
            variant="secondary"
            onPress={() => router.back()}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={onBarcode}
      />

      <View style={[styles.overlay, { paddingTop: insets.top + space.lg }]}>
        <Text style={styles.overlayTitle}>Scan the host&apos;s QR</Text>

        <View style={styles.reticle}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        <Text style={styles.overlayHint}>
          {rejected
            ? "That QR isn't a Cruzo ride code."
            : "Line the code up inside the frame"}
        </Text>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
          <Button
            label="Enter code instead"
            variant="secondary"
            onPress={() => router.back()}
          />
        </View>
      </View>
    </View>
  );
}

const RETICLE = 250;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  centered: {
    justifyContent: "center",
    paddingHorizontal: space.xl,
    gap: space.md,
    backgroundColor: colors.bg,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "800" },
  body: { color: colors.textDim, fontSize: 15, lineHeight: 22 },
  permActions: { gap: space.md, paddingTop: space.lg },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: space.xl,
  },
  overlayTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 8,
  },
  reticle: {
    width: RETICLE,
    height: RETICLE,
    marginTop: space.xxl * 1.5,
  },
  corner: {
    position: "absolute",
    width: 42,
    height: 42,
    borderColor: colors.accent,
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 5,
    borderLeftWidth: 5,
    borderTopLeftRadius: radius.md,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 5,
    borderRightWidth: 5,
    borderTopRightRadius: radius.md,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 5,
    borderLeftWidth: 5,
    borderBottomLeftRadius: radius.md,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderBottomRightRadius: radius.md,
  },
  overlayHint: {
    color: "#FFFFFF",
    fontSize: 14,
    marginTop: space.xl,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 8,
  },
  bottom: { position: "absolute", bottom: 0, left: space.xl, right: space.xl },
});
