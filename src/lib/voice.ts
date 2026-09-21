/**
 * Group voice call: the decisions, kept apart from the WebRTC plumbing so
 * they can be tested without a phone.
 *
 * The call is a mesh: every rider in it holds a direct audio connection to
 * every other. Supabase Realtime only introduces the phones to each other;
 * the audio itself never touches it. That is what keeps the call free, and
 * also why it suits a riding group rather than a conference — each rider
 * sends one stream per person, so it is capped at `MAX_CALL_SIZE`.
 */

/** Beyond this, each phone would be uploading too many streams on mobile data. */
export const MAX_CALL_SIZE = 8;

/** Someone in the call, as announced on the voice channel's presence. */
export type VoiceMember = {
  id: string;
  name: string;
  /** New every time a rider joins, so a rejoin is never mistaken for the old connection. */
  session: string;
  muted: boolean;
};

export type Signal = {
  kind: "offer" | "answer";
  from: string;
  fromSession: string;
  to: string;
  toSession: string;
  sdp: string;
};

/** One connection per pair of sessions, not per pair of riders. */
export function peerKey(member: Pick<VoiceMember, "id" | "session">): string {
  return `${member.id}#${member.session}`;
}

/**
 * Which side of a pair starts the connection.
 *
 * Exactly one must: if both sent an offer they would cross in flight and the
 * connection would never settle. The lower id offers, which both phones work
 * out the same way without having to agree on it.
 */
export function shouldOffer(selfId: string, otherId: string): boolean {
  return selfId < otherId;
}

export function createSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Validates an offer or answer received over broadcast; anything else is dropped. */
export function parseSignal(raw: unknown): Signal | null {
  const s = raw as Partial<Signal> | null;
  if (!s || typeof s !== "object") return null;
  if (s.kind !== "offer" && s.kind !== "answer") return null;
  for (const field of ["from", "fromSession", "to", "toSession", "sdp"] as const) {
    if (typeof s[field] !== "string" || !s[field]) return null;
  }
  // A real audio-only SDP is a few kilobytes; anything far larger is not one.
  if ((s.sdp as string).length > 20000) return null;
  return s as Signal;
}

/** Validates a presence entry on the voice channel. */
export function asVoiceMember(raw: unknown): VoiceMember | null {
  const m = raw as Partial<VoiceMember> | null;
  if (!m || typeof m.id !== "string" || typeof m.session !== "string") return null;
  return {
    id: m.id,
    session: m.session,
    name: typeof m.name === "string" && m.name ? m.name.slice(0, 40) : "Rider",
    muted: m.muted === true,
  };
}

/** Above this received audio level (0–1), a rider is shown as speaking. */
export const SPEAKING_LEVEL = 0.04;
