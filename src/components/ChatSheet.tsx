import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type ChatMessage, MAX_CHAT_LENGTH, QUICK_REPLIES } from "../lib/chat";
import { type Palette, radius, space } from "../theme";
import { useChrome } from "./ChromeTheme";

type Props = {
  visible: boolean;
  messages: ChatMessage[];
  selfId: string;
  colorFor: (id: string) => string;
  onSend: (text: string) => void;
  onClose: () => void;
};

function timeOf(at: number): string {
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The party's group chat, as a sheet over the map.
 *
 * Quick replies sit above the keyboard rather than behind a menu: on a bike
 * the realistic message is "fuel stop", sent with a gloved thumb at a light.
 * The map stays visible above the sheet so nobody loses the group while
 * reading.
 */
export function ChatSheet({ visible, messages, selfId, colorFor, onSend, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const c = useChrome();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (!visible || messages.length === 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [visible, messages.length]);

  const submit = (text: string) => {
    if (!text.trim()) return;
    onSend(text);
    setDraft("");
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close chat"
        />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.sm }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Ride chat</Text>
              <Text style={styles.subtitle}>Only this party · gone when the ride ends</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close chat"
              hitSlop={10}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            style={styles.list}
            contentContainerStyle={
              messages.length === 0 ? styles.emptyContainer : styles.listContent
            }
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptyBody}>
                  Say where you are stopping, or tap a quick reply below.
                </Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const mine = item.from === selfId;
              // Name only on the first of a run, like every chat app.
              const showName =
                !mine && (index === 0 || messages[index - 1].from !== item.from);
              return (
                <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {showName ? (
                      <Text style={[styles.sender, { color: colorFor(item.from) }]}>
                        {item.name}
                      </Text>
                    ) : null}
                    <Text style={[styles.text, mine && styles.textMine]}>{item.text}</Text>
                    <Text style={[styles.time, mine && styles.timeMine]}>{timeOf(item.at)}</Text>
                  </View>
                </View>
              );
            }}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.quickRow}
            style={styles.quickScroll}
          >
            {QUICK_REPLIES.map((reply) => (
              <Pressable
                key={reply}
                onPress={() => submit(reply)}
                accessibilityRole="button"
                accessibilityLabel={`Send ${reply}`}
                style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
              >
                <Text style={styles.quickText}>{reply}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message the group"
              placeholderTextColor={c.textFaint}
              selectionColor={c.accent}
              maxLength={MAX_CHAT_LENGTH}
              returnKeyType="send"
              submitBehavior="submit"
              onSubmitEditing={() => submit(draft)}
              style={styles.input}
              accessibilityLabel="Message"
            />
            <Pressable
              onPress={() => submit(draft)}
              disabled={!draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={({ pressed }) => [
                styles.send,
                !draft.trim() && styles.sendDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.35)" },
    sheet: {
      height: "72%",
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderTopWidth: 1,
      borderColor: c.border,
      overflow: "hidden",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: space.lg,
      paddingTop: space.lg,
      paddingBottom: space.md,
      borderBottomWidth: 1,
      borderBottomColor: c.borderSoft,
    },
    headerText: { flex: 1, gap: 2 },
    title: { color: c.text, fontSize: 18, fontWeight: "900" },
    subtitle: { color: c.textFaint, fontSize: 11, fontWeight: "600" },
    close: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surfaceAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    closeText: { color: c.textDim, fontSize: 15, fontWeight: "800" },

    list: { flex: 1 },
    listContent: { paddingHorizontal: space.md, paddingVertical: space.md, gap: space.xs },
    emptyContainer: { flexGrow: 1, justifyContent: "center" },
    empty: { alignItems: "center", paddingHorizontal: space.xxl, gap: space.xs },
    emptyTitle: { color: c.text, fontSize: 15, fontWeight: "800" },
    emptyBody: { color: c.textDim, fontSize: 13, textAlign: "center", lineHeight: 18 },

    row: { flexDirection: "row" },
    rowMine: { justifyContent: "flex-end" },
    rowTheirs: { justifyContent: "flex-start" },
    bubble: {
      maxWidth: "80%",
      borderRadius: radius.lg,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      gap: 2,
    },
    bubbleMine: { backgroundColor: c.accent, borderBottomRightRadius: radius.sm / 2 },
    bubbleTheirs: { backgroundColor: c.surfaceAlt, borderBottomLeftRadius: radius.sm / 2 },
    sender: { fontSize: 12, fontWeight: "900" },
    text: { color: c.text, fontSize: 15, lineHeight: 20 },
    textMine: { color: c.onAccent },
    time: { color: c.textFaint, fontSize: 10, alignSelf: "flex-end" },
    timeMine: { color: c.onAccent, opacity: 0.7 },

    quickScroll: { flexGrow: 0, borderTopWidth: 1, borderTopColor: c.borderSoft },
    quickRow: { gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
    quick: {
      borderWidth: 1,
      borderColor: c.accentDim,
      backgroundColor: c.accentWash,
      borderRadius: radius.pill,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    quickText: { color: c.accent, fontSize: 13, fontWeight: "800" },

    composer: {
      flexDirection: "row",
      alignItems: "center",
      gap: space.sm,
      paddingHorizontal: space.md,
    },
    input: {
      flex: 1,
      color: c.text,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      fontSize: 15,
    },
    send: {
      backgroundColor: c.accent,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    sendDisabled: { opacity: 0.4 },
    sendText: { color: c.onAccent, fontSize: 14, fontWeight: "900" },
    pressed: { opacity: 0.75 },
  });
