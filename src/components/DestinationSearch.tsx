import type { LngLat } from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { formatDistance } from "../lib/geo";
import { searchPlaces, type Place } from "../lib/geocode";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  visible: boolean;
  near: LngLat | null;
  onClose: () => void;
  onPick: (place: Place) => void;
  /** Riders in the party, offered as one-tap destinations. */
  riderOptions: { id: string; name: string; lngLat: LngLat; color: string }[];
};

const DEBOUNCE_MS = 350;
const M_PER_DEG = 111320;

function roughDistance(a: LngLat, b: LngLat): number {
  const kx = M_PER_DEG * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * M_PER_DEG);
}

/**
 * Full-screen destination picker.
 *
 * Riding to another rider is offered above free-text search, because on a
 * group ride "catch up with the leader" is a more common intent than any
 * address — and it is the one thing a general mapping app cannot do.
 */
export function DestinationSearch({
  visible,
  near,
  onClose,
  onPick,
  riderOptions,
}: Props) {
  const insets = useSafeAreaInsets();
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setSearched(false);
    }
  }, [visible]);

  // Debounced lookup: the geocoder is a free shared service, and firing on
  // every keystroke would be both slow and rude.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      const found = await searchPlaces(trimmed, near, controller.signal);
      if (controller.signal.aborted) return;

      setResults(found);
      setSearched(true);
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, near]);

  useEffect(() => () => requestRef.current?.abort(), []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search a place or address"
            placeholderTextColor={c.textFaint}
            selectionColor={c.accent}
            autoFocus
            returnKeyType="search"
            style={styles.input}
            accessibilityLabel="Search for a destination"
          />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            hitSlop={10}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>

        {query.trim().length < 2 && riderOptions.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Ride to a rider</Text>
            {riderOptions.map((rider) => (
              <Pressable
                key={rider.id}
                onPress={() =>
                  onPick({
                    id: `rider:${rider.id}`,
                    name: rider.name,
                    context: "Rider in your party",
                    lngLat: rider.lngLat,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Navigate to ${rider.name}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.riderDot, { backgroundColor: rider.color }]} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{rider.name}</Text>
                  <Text style={styles.rowSub}>
                    {near
                      ? `${formatDistance(roughDistance(near, rider.lngLat))} away`
                      : "In your party"}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        {query.trim().length >= 2 ? (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              searching ? (
                <View style={styles.searching}>
                  <ActivityIndicator color={c.accent} size="small" />
                  <Text style={styles.searchingText}>Searching…</Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              !searching && searched ? (
                <Text style={styles.empty}>
                  Nothing found for “{query.trim()}”. Try a nearby landmark, or
                  press and hold anywhere on the map to drop a pin instead.
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onPick(item)}
                accessibilityRole="button"
                accessibilityLabel={`Navigate to ${item.name}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text style={styles.pin}>◎</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.context ? (
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {item.context}
                    </Text>
                  ) : null}
                </View>
                {near ? (
                  <Text style={styles.rowDistance}>
                    {formatDistance(roughDistance(near, item.lngLat))}
                  </Text>
                ) : null}
              </Pressable>
            )}
          />
        ) : null}

        <Text style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
          Search by OpenStreetMap via Photon
        </Text>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  input: {
    flex: 1,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    color: c.text,
    fontSize: 16,
  },
  cancel: { paddingVertical: space.sm },
  cancelText: { color: c.textDim, fontSize: 15, fontWeight: "600" },
  pressed: { opacity: 0.6 },
  section: { paddingTop: space.lg },
  sectionTitle: {
    color: c.textDim,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  list: { paddingVertical: space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  rowPressed: { backgroundColor: c.surface },
  riderDot: { width: 14, height: 14, borderRadius: 7 },
  pin: { color: c.textFaint, fontSize: 16, width: 14, textAlign: "center" },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: c.text, fontSize: 15, fontWeight: "700" },
  rowSub: { color: c.textDim, fontSize: 12 },
  rowDistance: { color: c.textFaint, fontSize: 12, fontWeight: "600" },
  searching: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  searchingText: { color: c.textDim, fontSize: 13 },
  empty: {
    color: c.textDim,
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  footer: {
    color: c.textFaint,
    fontSize: 11,
    textAlign: "center",
    paddingTop: space.sm,
  },
  });
