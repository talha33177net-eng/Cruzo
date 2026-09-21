import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import type { ChatMessage } from "../lib/chat";
import { initialsOf } from "../lib/identity";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  message: ChatMessage;
  color: string;
  top: number;
  onOpen: () => void;
};

/**
 * A new message, previewed over the map for a few seconds.
 *
 * Mid-ride nobody opens a chat to check it, so the message comes to the
 * rider instead; tapping it opens the conversation.
 */
export function ChatToast({ message, color, top, onOpen }: Props) {
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
  }, [message.id, enter]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] });

  return (
    <Animated.View style={[styles.wrap, { top, opacity: enter, transform: [{ translateY }] }]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${message.name} says ${message.text}. Open chat.`}
        style={({ pressed }) => [styles.toast, pressed && styles.pressed]}
      >
        <View style={[styles.avatar, { borderColor: color }]}>
          <Text style={[styles.avatarText, { color }]}>{initialsOf(message.name)}</Text>
        </View>
        <View style={styles.body}>
          <Text style={[styles.name, { color }]} numberOfLines={1}>
            {message.name}
          </Text>
          <Text style={styles.text} numberOfLines={2}>
            {message.text}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // Stops short of the control column on the right.
    wrap: { position: "absolute", left: space.md, right: 46 + space.md * 2 },
    toast: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      backgroundColor: c.scrim,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      elevation: 5,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      backgroundColor: c.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontSize: 11, fontWeight: "900" },
    body: { flex: 1 },
    name: { fontSize: 12, fontWeight: "900" },
    text: { color: c.text, fontSize: 14, fontWeight: "600" },
    pressed: { opacity: 0.8 },
  });
