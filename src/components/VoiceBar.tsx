import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { initialsOf } from "../lib/identity";
import type { VoiceMember } from "../lib/voice";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  selfId: string;
  members: VoiceMember[];
  inCall: boolean;
  joining: boolean;
  muted: boolean;
  speaking: string[];
  linked: string[];
  relayed: boolean;
  error: string | null;
  colorFor: (id: string) => string;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
};

const TALKING = "#2ED573";

/**
 * The party's voice call, as a strip above the rider list.
 *
 * Out of the call it is an invitation that only appears once someone is
 * talking; in it, each rider's avatar lights up green while they speak, which
 * is how you tell who said "left here" without looking for long.
 */
export function VoiceBar({
  selfId,
  members,
  inCall,
  joining,
  muted,
  speaking,
  linked,
  relayed,
  error,
  colorFor,
  onJoin,
  onLeave,
  onToggleMute,
}: Props) {
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);

  const others = members.filter((m) => m.id !== selfId);
  const waiting = others.filter((m) => !linked.includes(m.id)).length;

  const status = error
    ? error
    : joining
      ? "Joining the call…"
      : !inCall
        ? `${others.length} ${others.length === 1 ? "rider is" : "riders are"} talking`
        : others.length === 0
          ? "Waiting for others to join"
          : waiting > 0
            ? relayed
              ? `Connecting to ${waiting}…`
              : `Connecting to ${waiting}… (relay unavailable, some may not connect)`
            : `Connected to ${others.length}`;

  // You first, then everyone else in a stable order.
  const shown = [...members].sort((a, b) =>
    a.id === selfId ? -1 : b.id === selfId ? 1 : a.name.localeCompare(b.name),
  );

  return (
    <View style={[styles.bar, inCall && styles.barLive]}>
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <View style={[styles.liveDot, inCall && styles.liveDotOn]} />
          <Text style={styles.title}>Voice call</Text>
        </View>
        <Text style={[styles.status, error && styles.statusError]} numberOfLines={1}>
          {status}
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.avatars}
        >
          {shown.map((m) => {
            const talking = speaking.includes(m.id);
            const self = m.id === selfId;
            const connecting = inCall && !self && !linked.includes(m.id);
            const color = colorFor(m.id);
            return (
              <View
                key={m.id}
                style={[
                  styles.avatar,
                  { borderColor: talking ? TALKING : color },
                  talking && styles.avatarTalking,
                  connecting && styles.avatarConnecting,
                ]}
                accessibilityLabel={`${self ? "You" : m.name}${m.muted ? ", muted" : ""}${talking ? ", talking" : ""}`}
              >
                <Text style={[styles.avatarText, { color }]}>{initialsOf(m.name)}</Text>
                {m.muted ? (
                  <View style={styles.mutedMark}>
                    <Text style={styles.mutedGlyph}>✕</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.actions}>
        {inCall ? (
          <>
            <Pressable
              onPress={onToggleMute}
              accessibilityRole="switch"
              accessibilityState={{ checked: muted }}
              accessibilityLabel={muted ? "Unmute your microphone" : "Mute your microphone"}
              style={({ pressed }) => [
                styles.button,
                muted ? styles.muteOn : styles.muteOff,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonText, muted ? styles.muteOnText : styles.muteOffText]}>
                {muted ? "Unmute" : "Mute"}
              </Text>
            </Pressable>
            <Pressable
              onPress={onLeave}
              accessibilityRole="button"
              accessibilityLabel="Leave the voice call"
              style={({ pressed }) => [styles.button, styles.leave, pressed && styles.pressed]}
            >
              <Text style={[styles.buttonText, styles.leaveText]}>Leave</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={onJoin}
            disabled={joining}
            accessibilityRole="button"
            accessibilityLabel="Join the voice call"
            style={({ pressed }) => [
              styles.button,
              styles.join,
              joining && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.buttonText, styles.joinText]}>
              {joining ? "Joining…" : "Join"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.md,
      marginHorizontal: space.md,
      marginBottom: space.sm,
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderColor: c.border,
      borderRadius: radius.lg,
      paddingVertical: space.sm + 2,
      paddingHorizontal: space.md,
      elevation: 4,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    barLive: { borderColor: TALKING },
    main: { flex: 1, gap: 2 },
    titleRow: { flexDirection: "row", alignItems: "center", gap: space.xs + 2 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.textFaint },
    liveDotOn: { backgroundColor: TALKING },
    title: { color: c.text, fontSize: 14, fontWeight: "900" },
    status: { color: c.textDim, fontSize: 11, fontWeight: "600" },
    statusError: { color: c.danger },
    avatars: { gap: space.xs + 2, paddingTop: space.xs, paddingRight: space.sm },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarTalking: { borderWidth: 3, backgroundColor: "rgba(46, 213, 115, 0.18)" },
    avatarConnecting: { opacity: 0.45 },
    avatarText: { fontSize: 11, fontWeight: "900" },
    mutedMark: {
      position: "absolute",
      right: -4,
      bottom: -4,
      width: 15,
      height: 15,
      borderRadius: 8,
      backgroundColor: c.danger,
      borderWidth: 1.5,
      borderColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    mutedGlyph: { color: "#FFFFFF", fontSize: 7, fontWeight: "900" },
    actions: { gap: space.xs + 2, alignItems: "stretch" },
    button: {
      minWidth: 74,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm + 1,
      alignItems: "center",
      borderWidth: 1.5,
    },
    buttonText: { fontSize: 13, fontWeight: "900" },
    join: { backgroundColor: TALKING, borderColor: TALKING },
    joinText: { color: "#04210F" },
    muteOff: { borderColor: c.border, backgroundColor: c.surfaceAlt },
    muteOffText: { color: c.text },
    muteOn: { borderColor: c.danger, backgroundColor: c.danger },
    muteOnText: { color: "#FFFFFF" },
    leave: { borderColor: c.danger, backgroundColor: "transparent" },
    leaveText: { color: c.danger },
    disabled: { opacity: 0.6 },
    pressed: { opacity: 0.75 },
  });
