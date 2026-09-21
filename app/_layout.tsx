import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { RiderProvider } from "../src/components/RiderProvider";
import { colors } from "../src/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <RiderProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="host" />
          <Stack.Screen name="join" />
          <Stack.Screen name="scan" options={{ animation: "fade_from_bottom" }} />
          <Stack.Screen name="ride/[code]" options={{ animation: "fade" }} />
        </Stack>
      </RiderProvider>
    </SafeAreaProvider>
  );
}
