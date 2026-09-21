import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type ChatMessage,
  cleanChatText,
  createMessageId,
  isCoordinator,
  mergeMessages,
} from "../lib/chat";
import { supabase } from "../lib/supabase";

export type RideChat = {
  messages: ChatMessage[];
  /** Messages from others that arrived while the chat was closed. */
  unread: number;
  /** The newest message from someone else, for the on-map preview. */
  latest: ChatMessage | null;
  send: (text: string) => void;
  markRead: () => void;
};

/**
 * The party's group chat.
 *
 * Runs on its own broadcast channel, beside the presence channel that carries
 * positions, so a burst of messages never competes with location updates.
 * Nothing is stored server-side: each phone holds the conversation in memory,
 * and when the last rider leaves it is gone.
 *
 * A rider who joins late, or whose app restarted, asks for the history on
 * connecting. One rider already in the ride answers (see `isCoordinator`), so
 * a party of ten does not send ten copies of the same conversation.
 */
export function useRideChat(
  code: string,
  self: { id: string; name: string },
  riderIds: string[],
  enabled: boolean,
  isOpen: boolean,
): RideChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<ChatMessage | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);

  // Read inside channel handlers, which are registered once per party.
  const selfRef = useRef(self);
  selfRef.current = self;
  const rosterRef = useRef(riderIds);
  rosterRef.current = riderIds;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  useEffect(() => {
    if (!enabled || !code || !self.id) return;

    const channel = supabase.channel(`chat:${code}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "msg" }, ({ payload }) => {
        // Validated on its own first, so a malformed payload is dropped here.
        const [arrived] = mergeMessages([], [payload]);
        if (!arrived) return;
        if (messagesRef.current.some((m) => m.id === arrived.id)) return;

        // Functional update: two messages landing in one tick must both stick.
        setMessages((current) => mergeMessages(current, [arrived]));
        if (arrived.from !== selfRef.current.id) {
          setLatest(arrived);
          if (!openRef.current) setUnread((n) => n + 1);
        }
      })
      .on("broadcast", { event: "history_request" }, ({ payload }) => {
        const requester = (payload as { from?: unknown }).from;
        if (typeof requester !== "string") return;
        if (messagesRef.current.length === 0) return;

        const others = rosterRef.current.filter((id) => id !== requester);
        if (!isCoordinator(selfRef.current.id, others)) return;

        void channel.send({
          type: "broadcast",
          event: "history",
          payload: { to: requester, messages: messagesRef.current },
        });
      })
      .on("broadcast", { event: "history" }, ({ payload }) => {
        const incoming = (payload as { messages?: unknown }).messages;
        if (!Array.isArray(incoming)) return;
        // Merged by everyone, not only the rider who asked: it costs nothing
        // and fills in anything a brief disconnect made others miss.
        setMessages((current) => mergeMessages(current, incoming));
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        void channel.send({
          type: "broadcast",
          event: "history_request",
          payload: { from: selfRef.current.id },
        });
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
      setMessages([]);
      setUnread(0);
      setLatest(null);
    };
  }, [code, self.id, enabled]);

  const send = useCallback((text: string) => {
    const clean = cleanChatText(text);
    const channel = channelRef.current;
    if (!clean || !channel) return;

    const { id, name } = selfRef.current;
    const message: ChatMessage = {
      id: createMessageId(id),
      from: id,
      name: name || "Rider",
      text: clean,
      at: Date.now(),
    };

    // Shown at once rather than after a round trip: `self: false` means the
    // server never echoes it back.
    setMessages((current) => mergeMessages(current, [message]));
    void channel.send({ type: "broadcast", event: "msg", payload: message });
  }, []);

  const markRead = useCallback(() => setUnread(0), []);

  return { messages, unread, latest, send, markRead };
}
