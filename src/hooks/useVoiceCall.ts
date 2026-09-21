import type { RealtimeChannel } from "@supabase/supabase-js";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";
import {
  mediaDevices,
  type MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
} from "react-native-webrtc";

import { supabase } from "../lib/supabase";
import {
  asVoiceMember,
  createSessionId,
  MAX_CALL_SIZE,
  parseSignal,
  peerKey,
  type Signal,
  shouldOffer,
  SPEAKING_LEVEL,
  type VoiceMember,
} from "../lib/voice";

export type VoiceState = "idle" | "joining" | "live";

export type VoiceCall = {
  state: VoiceState;
  error: string | null;
  /** Everyone in the call, this rider included once joined. */
  members: VoiceMember[];
  muted: boolean;
  /** Rider ids currently heard talking (this rider included). */
  speaking: string[];
  /** Rider ids whose audio link is up. */
  linked: string[];
  /** False when relay credentials could not be fetched; some riders may not connect. */
  relayed: boolean;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
};

type Peer = {
  pc: RTCPeerConnection;
  member: VoiceMember;
  offerTimer: ReturnType<typeof setTimeout> | null;
};

/** Used when relay credentials are unavailable: direct connections only. */
const STUN_ONLY = [{ urls: "stun:stun.cloudflare.com:3478" }];

/** How long to wait for network routes before sending an offer or answer anyway. */
const GATHER_TIMEOUT_MS = 4000;

/** An offer with no answer by now is dropped and retried. */
const ANSWER_TIMEOUT_MS = 15000;

const STATS_INTERVAL_MS = 700;

/** Re-arms the screen wake lock, which `InCallManager.stop()` clears. */
const KEEP_AWAKE_TAG = "cruzo-voice";

/**
 * Resolves once the connection has found its network routes.
 *
 * Offers go out with every route already inside them rather than trickled one
 * message at a time: Realtime rate-limits broadcasts, and a party of six
 * trickling candidates would blow straight through it.
 */
function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        resolve();
      }
    };
  });
}

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (mic !== PermissionsAndroid.RESULTS.GRANTED) return false;

  // Needed on Android 12+ to route the call through a helmet intercom. Not
  // fatal if refused: the call still works on the phone's speaker.
  if (Number(Platform.Version) >= 31) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  }
  return true;
}

/**
 * The party's live voice call.
 *
 * Every rider in the party watches the voice channel, so the app can show who
 * is talking before anyone joins; only riders who join announce themselves on
 * it and open audio connections. See `lib/voice.ts` for why it is a mesh.
 */
export function useVoiceCall(
  code: string,
  self: { id: string; name: string },
  enabled: boolean,
): VoiceCall {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<VoiceMember[]>([]);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState<string[]>([]);
  const [linked, setLinked] = useState<string[]>([]);
  const [relayed, setRelayed] = useState(true);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const iceServersRef = useRef<RTCIceServer[]>(STUN_ONLY);
  /** This rider's session while in the call; null when out of it. */
  const sessionRef = useRef<string | null>(null);
  const membersRef = useRef<VoiceMember[]>([]);
  const mutedRef = useRef(false);
  const selfRef = useRef(self);
  selfRef.current = self;

  const refreshLinked = useCallback(() => {
    const up = [...peersRef.current.values()]
      .filter((p) => p.pc.connectionState === "connected")
      .map((p) => p.member.id);
    setLinked((current) =>
      current.length === up.length && current.every((id) => up.includes(id)) ? current : up,
    );
  }, []);

  const closePeer = useCallback(
    (key: string) => {
      const peer = peersRef.current.get(key);
      if (!peer) return;
      if (peer.offerTimer) clearTimeout(peer.offerTimer);
      peersRef.current.delete(key);
      peer.pc.close();
      refreshLinked();
    },
    [refreshLinked],
  );

  const sendSignal = useCallback((signal: Signal) => {
    void channelRef.current?.send({ type: "broadcast", event: "signal", payload: signal });
  }, []);

  // Declared before `createPeer` uses it; assigned below.
  const reconcileRef = useRef<() => void>(() => undefined);

  const createPeer = useCallback(
    (member: VoiceMember): Peer => {
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      const stream = streamRef.current;
      stream?.getTracks().forEach((track) => pc.addTrack(track, stream));

      const peer: Peer = { pc, member, offerTimer: null };
      const key = peerKey(member);
      peersRef.current.set(key, peer);

      // Remote audio plays by itself once its track arrives; nothing to render.
      pc.onconnectionstatechange = () => {
        refreshLinked();
        if (pc.connectionState === "failed") {
          // Torn down and rebuilt from scratch: after a network change a fresh
          // connection is quicker and more reliable than repairing this one.
          closePeer(key);
          setTimeout(() => reconcileRef.current(), 2000);
        }
      };

      return peer;
    },
    [closePeer, refreshLinked],
  );

  const offerTo = useCallback(
    async (member: VoiceMember) => {
      const session = sessionRef.current;
      if (!session) return;

      const peer = createPeer(member);
      const key = peerKey(member);
      try {
        const offer = await peer.pc.createOffer({});
        await peer.pc.setLocalDescription(offer);
        await gathered(peer.pc);
        if (peersRef.current.get(key) !== peer || !peer.pc.localDescription) return;

        sendSignal({
          kind: "offer",
          from: selfRef.current.id,
          fromSession: session,
          to: member.id,
          toSession: member.session,
          sdp: peer.pc.localDescription.sdp,
        });

        peer.offerTimer = setTimeout(() => {
          if (peersRef.current.get(key) === peer && !peer.pc.remoteDescription) {
            closePeer(key);
            reconcileRef.current();
          }
        }, ANSWER_TIMEOUT_MS);
      } catch {
        closePeer(key);
      }
    },
    [createPeer, closePeer, sendSignal],
  );

  /** Brings the set of open connections in line with who is in the call. */
  const reconcile = useCallback(() => {
    if (!sessionRef.current || !streamRef.current) return;
    const selfId = selfRef.current.id;
    const others = membersRef.current.filter((m) => m.id !== selfId);
    const wanted = new Set(others.map(peerKey));

    for (const key of [...peersRef.current.keys()]) {
      if (!wanted.has(key)) closePeer(key);
    }
    for (const member of others) {
      if (peersRef.current.has(peerKey(member))) continue;
      // The other side opens this one; its offer arrives over broadcast.
      if (shouldOffer(selfId, member.id)) void offerTo(member);
    }
  }, [closePeer, offerTo]);
  reconcileRef.current = reconcile;

  const onSignal = useCallback(
    async (raw: unknown) => {
      const signal = parseSignal(raw);
      const session = sessionRef.current;
      if (!signal || !session || !streamRef.current) return;
      if (signal.to !== selfRef.current.id || signal.toSession !== session) return;

      const key = peerKey({ id: signal.from, session: signal.fromSession });

      if (signal.kind === "answer") {
        const peer = peersRef.current.get(key);
        if (!peer || peer.pc.signalingState !== "have-local-offer") return;
        try {
          await peer.pc.setRemoteDescription(
            new RTCSessionDescription({ type: "answer", sdp: signal.sdp }),
          );
          if (peer.offerTimer) clearTimeout(peer.offerTimer);
        } catch {
          closePeer(key);
        }
        return;
      }

      // An offer only ever comes from the lower id; anything else is noise.
      if (shouldOffer(selfRef.current.id, signal.from)) return;

      closePeer(key); // a fresh offer replaces whatever was there
      const member =
        membersRef.current.find((m) => m.id === signal.from && m.session === signal.fromSession) ??
        { id: signal.from, session: signal.fromSession, name: "Rider", muted: false };
      const peer = createPeer(member);

      try {
        await peer.pc.setRemoteDescription(
          new RTCSessionDescription({ type: "offer", sdp: signal.sdp }),
        );
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await gathered(peer.pc);
        if (peersRef.current.get(key) !== peer || !peer.pc.localDescription) return;

        sendSignal({
          kind: "answer",
          from: selfRef.current.id,
          fromSession: session,
          to: signal.from,
          toSession: signal.fromSession,
          sdp: peer.pc.localDescription.sdp,
        });
      } catch {
        closePeer(key);
      }
    },
    [closePeer, createPeer, sendSignal],
  );

  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  // The voice channel is watched for as long as the rider is in the party.
  useEffect(() => {
    if (!enabled || !code || !self.id) return;

    const channel = supabase.channel(`voice:${code}`, {
      config: {
        broadcast: { self: false },
        presence: { key: self.id, enabled: true },
      },
    });
    channelRef.current = channel;

    const sync = () => {
      const next = Object.values(channel.presenceState())
        .map((entries) => asVoiceMember(entries[entries.length - 1]))
        .filter((m): m is VoiceMember => m !== null);
      membersRef.current = next;
      setMembers(next);
      reconcileRef.current();
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .on("broadcast", { event: "signal" }, ({ payload }) => void onSignalRef.current(payload))
      .subscribe((status) => {
        // Re-announce after a reconnect, or this rider silently drops out.
        if (status === "SUBSCRIBED" && sessionRef.current) {
          void channel.track({
            id: selfRef.current.id,
            name: selfRef.current.name,
            session: sessionRef.current,
            muted: mutedRef.current,
          });
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
      membersRef.current = [];
      setMembers([]);
    };
  }, [code, self.id, enabled]);

  /**
   * Ends this rider's part in the call.
   *
   * `InCallManager.stop()` clears the screen wake lock the ride screen relies
   * on, so it is re-armed afterwards — except when the screen itself is going
   * away, where re-arming would race the release and could leave it stuck on.
   */
  const hangUp = useCallback((rearmKeepAwake: boolean) => {
    const wasInCall = sessionRef.current !== null || streamRef.current !== null;
    sessionRef.current = null;
    void channelRef.current?.untrack();

    for (const key of [...peersRef.current.keys()]) closePeer(key);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current?.release();
    streamRef.current = null;

    if (wasInCall) {
      InCallManager.stop();
      if (rearmKeepAwake) void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    }
    mutedRef.current = false;
    setMuted(false);
    setSpeaking([]);
    setLinked([]);
    setState("idle");
  }, [closePeer]);

  const leave = useCallback(() => hangUp(true), [hangUp]);

  const join = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel || sessionRef.current) return;

    const others = membersRef.current.filter((m) => m.id !== selfRef.current.id);
    if (others.length >= MAX_CALL_SIZE) {
      setError(`The call is full (${MAX_CALL_SIZE} riders).`);
      return;
    }

    setError(null);
    setState("joining");

    if (!(await requestPermissions())) {
      setState("idle");
      setError("Microphone permission is needed to join the call.");
      return;
    }

    // Relay credentials come from our own server function, which keeps the
    // Cloudflare token off the phone. Without them the call still runs, but
    // only between riders whose networks allow a direct connection.
    const { data, error: fnError } = await supabase.functions.invoke("turn-credentials", {
      body: { code },
    });
    const servers = (data as { iceServers?: RTCIceServer[] } | null)?.iceServers;
    if (!fnError && Array.isArray(servers) && servers.length > 0) {
      iceServersRef.current = servers;
      setRelayed(true);
    } else {
      iceServersRef.current = STUN_ONLY;
      setRelayed(false);
    }

    try {
      streamRef.current = await mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setState("idle");
      setError("Could not open the microphone.");
      return;
    }

    // "video" mode, although this is audio only: it defaults to the
    // loudspeaker and leaves the proximity sensor off. "audio" mode would
    // route to the earpiece and blank the screen whenever something passed in
    // front of a handlebar-mounted phone. A Bluetooth or wired headset still
    // takes over automatically when connected.
    InCallManager.start({ media: "video", auto: true });

    const session = createSessionId();
    sessionRef.current = session;
    await channel.track({ id: selfRef.current.id, name: selfRef.current.name, session, muted: false });
    setState("live");
    reconcileRef.current();
  }, [code]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    if (sessionRef.current) {
      void channelRef.current?.track({
        id: selfRef.current.id,
        name: selfRef.current.name,
        session: sessionRef.current,
        muted: next,
      });
    }
  }, []);

  // Who is talking, read from the audio levels each connection reports.
  useEffect(() => {
    if (state !== "live") return;

    const timer = setInterval(async () => {
      const talking = new Set<string>();
      let ownLevel = 0;

      for (const peer of peersRef.current.values()) {
        try {
          const stats: Map<string, Record<string, unknown>> = await peer.pc.getStats();
          stats.forEach((report) => {
            const level = typeof report.audioLevel === "number" ? report.audioLevel : 0;
            if (report.type === "inbound-rtp" && level > SPEAKING_LEVEL) {
              talking.add(peer.member.id);
            }
            if (report.type === "media-source") ownLevel = Math.max(ownLevel, level);
          });
        } catch {
          // A connection closing mid-read is expected; skip it this round.
        }
      }
      if (!mutedRef.current && ownLevel > SPEAKING_LEVEL) talking.add(selfRef.current.id);

      const next = [...talking].sort();
      setSpeaking((current) => (current.join() === next.join() ? current : next));
    }, STATS_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [state]);

  // Leaving the ride screen, or the party ending, hangs up.
  useEffect(() => {
    if (!enabled) leave();
  }, [enabled, leave]);

  useEffect(
    () => () => {
      hangUp(false);
      // Harmless if it was never re-armed; nothing to report either way.
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    },
    [hangUp],
  );

  return { state, error, members, muted, speaking, linked, relayed, join, leave, toggleMute };
}
