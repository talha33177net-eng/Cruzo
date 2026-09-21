/**
 * Party chat.
 *
 * Messages travel over Realtime broadcast and are never written to the
 * database. They live in the memory of the phones in the ride, which is why
 * the chat disappears on its own when the ride is over: there is nothing to
 * clean up.
 */

export type ChatMessage = {
  id: string;
  from: string;
  name: string;
  text: string;
  /** Sender clock, used for ordering and the time label. */
  at: number;
};

export const MAX_CHAT_LENGTH = 280;

/** Older messages are dropped; a ride chat is read now, not scrolled back. */
export const MAX_CHAT_HISTORY = 100;

/**
 * One-tap messages.
 *
 * Typing with gloves on at a traffic light is not realistic, so the things
 * riders actually say to each other are a single press away.
 */
export const QUICK_REPLIES = [
  "Fuel stop",
  "Wait for me",
  "Slow down",
  "Tea break?",
  "All good 👍",
  "On my way",
] as const;

export function cleanChatText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_LENGTH);
}

export function createMessageId(from: string): string {
  return `${from}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Validates a message received from another phone; anything malformed is dropped. */
function asMessage(raw: unknown): ChatMessage | null {
  const m = raw as Partial<ChatMessage> | null;
  if (!m || typeof m !== "object") return null;
  if (typeof m.id !== "string" || typeof m.from !== "string") return null;
  if (typeof m.text !== "string" || typeof m.at !== "number") return null;
  if (!Number.isFinite(m.at)) return null;

  const text = cleanChatText(m.text);
  if (!text) return null;

  return {
    id: m.id.slice(0, 80),
    from: m.from.slice(0, 80),
    name: typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 40) : "Rider",
    text,
    at: m.at,
  };
}

/**
 * Folds incoming messages into the conversation.
 *
 * The same message can arrive twice — live, and again inside a history
 * hand-over — so it is de-duplicated by id. The original array is returned
 * untouched when nothing new arrived, which spares a re-render.
 */
export function mergeMessages(current: ChatMessage[], incoming: unknown[]): ChatMessage[] {
  const seen = new Set(current.map((m) => m.id));
  const added: ChatMessage[] = [];

  for (const raw of incoming) {
    const message = asMessage(raw);
    if (!message || seen.has(message.id)) continue;
    seen.add(message.id);
    added.push(message);
  }

  if (added.length === 0) return current;

  return [...current, ...added]
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
    .slice(-MAX_CHAT_HISTORY);
}

/**
 * Whether this rider is the one who does a chore on behalf of the party.
 *
 * Some things need doing by exactly one phone — answering a newcomer's request
 * for chat history, keeping the party marked as active. The rider with the
 * lowest id takes them; every phone sees the same roster, so every phone
 * reaches the same answer without talking to each other. An empty roster
 * (not yet synced) means nobody else is known, so this rider does it.
 */
export function isCoordinator(selfId: string, riderIds: string[]): boolean {
  const others = riderIds.filter((id) => id !== selfId);
  return others.every((id) => selfId < id);
}
