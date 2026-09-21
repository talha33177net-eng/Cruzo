import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  NAV_POSITION_SEND_MS,
  POSITION_KEEPALIVE_MS,
  POSITION_SEND_MS,
  PRESENCE_MIN_GAP_MS,
  PRESENCE_REFRESH_MS,
} from "../lib/config";
import { supabase } from "../lib/supabase";
import type { ConnectionStatus, Destination, Fix, RiderState } from "../lib/types";

type Profile = {
  id: string;
  name: string;
  isHost: boolean;
  sos: boolean;
  navigating: boolean;
  trip: Destination[] | null;
};

export type RideChannel = {
  status: ConnectionStatus;
  riders: RiderState[];
  error: string | null;
  publish: (fix: Fix) => void;
  /**
   * Re-sends this rider's state without waiting for the next GPS fix.
   *
   * Raising an SOS or starting a journey must reach the party now.
   */
  republish: () => void;
  /**
   * Bumped when someone announces the ride is over.
   *
   * Only a hint: anyone in the channel can send it, so the ride screen checks
   * the party is really gone before acting on it.
   */
  endedSignal: number;
  /** Tells everyone in the party the ride is over. Host only. */
  announceEnd: () => Promise<void>;
};

type PresenceEntry = RiderState & { presence_ref: string };

/** How long to wait before rebuilding a channel the server closed. */
const REJOIN_DELAY_MS = 3000;

/**
 * Checks a rider state received from another phone.
 *
 * Anything on the channel is whatever a peer chose to send; a malformed one is
 * dropped rather than drawn at [NaN, NaN].
 */
function isRiderState(value: unknown): value is RiderState {
  const v = value as Partial<RiderState> | null;
  return (
    typeof v?.id === "string" &&
    v.id.length > 0 &&
    typeof v.lng === "number" &&
    typeof v.lat === "number" &&
    Number.isFinite(v.lng) &&
    Number.isFinite(v.lat)
  );
}

/**
 * Joins the realtime channel for a party and keeps the rider roster in sync.
 *
 * Two Realtime features split the work, because the free tier limits each
 * very differently:
 *
 * - **Presence** says who is in the party. The server drops a rider the
 *   moment their connection goes, which is exactly right for a bike riding
 *   out of coverage. But each phone may only update its presence 5 times in
 *   30 seconds; the old design sent a position through it every second, got
 *   throttled, and riders vanished or never saw a journey start. Presence is
 *   now updated only when something about the rider changes, never faster
 *   than `PRESENCE_MIN_GAP_MS`, plus a slow refresh so a late joiner gets a
 *   recent position straight away.
 * - **Broadcast** carries the live position every few seconds, along with the
 *   same state, so an SOS or a new destination arrives at once.
 *
 * A broadcast from a rider not in the presence roster is ignored, so a rider
 * still disappears from every map the moment they disconnect. Nothing is
 * persisted either way.
 */
export function useRideChannel(
  code: string,
  profile: Profile,
  enabled: boolean,
): RideChannel {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [roster, setRoster] = useState<RiderState[]>([]);
  const [live, setLive] = useState<Record<string, RiderState>>({});
  const [error, setError] = useState<string | null>(null);
  const [endedSignal, setEndedSignal] = useState(0);
  /** Bumped to tear the channel down and join afresh. */
  const [generation, setGeneration] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const lastFixRef = useRef<Fix | null>(null);
  const lastSendRef = useRef(0);
  const lastTrackRef = useRef(0);
  const trackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<ConnectionStatus>("idle");
  statusRef.current = status;

  // Read inside the senders so a name change never re-creates the channel.
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const payloadFor = useCallback((fix: Fix): RiderState => {
    const { id, name, isHost, sos, navigating, trip } = profileRef.current;
    return {
      id,
      name,
      isHost,
      sos,
      navigating,
      trip: navigating ? trip : null,
      lng: fix.lngLat[0],
      lat: fix.lngLat[1],
      heading: fix.heading,
      speed: fix.speed,
      accuracy: fix.accuracy,
      updatedAt: Date.now(),
    };
  }, []);

  const sendPosition = useCallback(() => {
    const channel = channelRef.current;
    const fix = lastFixRef.current;
    if (!channel || !fix || !subscribedRef.current) return;
    lastSendRef.current = Date.now();
    void channel.send({ type: "broadcast", event: "pos", payload: payloadFor(fix) });
  }, [payloadFor]);

  /**
   * Updates presence, within the free tier's budget.
   *
   * A request inside the minimum gap is not dropped: it is deferred to the
   * end of the gap, and further requests meanwhile ride along with it.
   */
  const requestTrack = useCallback(() => {
    if (trackTimerRef.current) return;
    const fire = () => {
      trackTimerRef.current = null;
      const channel = channelRef.current;
      const fix = lastFixRef.current;
      if (!channel || !fix || !subscribedRef.current) return;
      lastTrackRef.current = Date.now();
      void channel.track(payloadFor(fix));
    };
    const wait = lastTrackRef.current + PRESENCE_MIN_GAP_MS - Date.now();
    if (wait <= 0) fire();
    else trackTimerRef.current = setTimeout(fire, wait);
  }, [payloadFor]);

  const publish = useCallback(
    (fix: Fix) => {
      const first = lastFixRef.current == null;
      lastFixRef.current = fix;

      const gap = profileRef.current.navigating ? NAV_POSITION_SEND_MS : POSITION_SEND_MS;
      if (Date.now() - lastSendRef.current >= gap) sendPosition();

      if (first || Date.now() - lastTrackRef.current >= PRESENCE_REFRESH_MS) {
        requestTrack();
      }
    },
    [sendPosition, requestTrack],
  );

  useEffect(() => {
    if (!enabled || !code) return;

    let disposed = false;
    let rejoinTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRejoin = () => {
      if (disposed || rejoinTimer) return;
      rejoinTimer = setTimeout(() => {
        rejoinTimer = null;
        if (!disposed) setGeneration((n) => n + 1);
      }, REJOIN_DELAY_MS);
    };

    setStatus(generation === 0 ? "connecting" : "reconnecting");
    setError(null);

    const channel = supabase.channel(`ride:${code}`, {
      config: {
        // `enabled` is what lets this client *receive* the roster; without it
        // presence events never fire and we would only ever see ourselves.
        presence: { key: profile.id, enabled: true },
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;
    subscribedRef.current = false;

    const syncRoster = () => {
      const state = channel.presenceState<PresenceEntry>();
      const next = Object.values(state)
        .map((entries) => entries[entries.length - 1])
        .filter((entry): entry is PresenceEntry => isRiderState(entry));
      setRoster(next);
      // Forget live positions of anyone who has left.
      setLive((current) => {
        const ids = new Set(next.map((r) => r.id));
        const kept: Record<string, RiderState> = {};
        let changed = false;
        for (const [id, state] of Object.entries(current)) {
          if (ids.has(id)) kept[id] = state;
          else changed = true;
        }
        return changed ? kept : current;
      });
    };

    channel
      .on("presence", { event: "sync" }, syncRoster)
      .on("presence", { event: "join" }, syncRoster)
      .on("presence", { event: "leave" }, syncRoster)
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        if (!isRiderState(payload)) return;
        setLive((current) => ({ ...current, [payload.id]: payload }));
      })
      .on("broadcast", { event: "ended" }, () => setEndedSignal((n) => n + 1))
      .subscribe((subscribeStatus, err) => {
        if (disposed) return;

        if (subscribeStatus === "SUBSCRIBED") {
          subscribedRef.current = true;
          setStatus("connected");
          setError(null);
          // Re-announce immediately so a reconnect does not leave this rider
          // invisible until their next GPS fix arrives.
          lastTrackRef.current = 0;
          requestTrack();
          sendPosition();
          return;
        }

        subscribedRef.current = false;

        if (subscribeStatus === "CHANNEL_ERROR" || subscribeStatus === "TIMED_OUT") {
          setStatus("error");
          setError(err?.message ?? "Lost contact with the party.");
          // The client retries on its own too; this is the backstop for when
          // it gives up, so a rider never has to type the code in again.
          scheduleRejoin();
          return;
        }

        if (subscribeStatus === "CLOSED") {
          // Closed by the server (say, for going over a limit) is never
          // retried by the client, so rebuild the channel from scratch.
          setStatus("reconnecting");
          scheduleRejoin();
        }
      });

    return () => {
      disposed = true;
      if (rejoinTimer) clearTimeout(rejoinTimer);
      if (trackTimerRef.current) {
        clearTimeout(trackTimerRef.current);
        trackTimerRef.current = null;
      }
      channelRef.current = null;
      subscribedRef.current = false;
      void channel.untrack();
      void supabase.removeChannel(channel);
      setRoster([]);
      setLive({});
      setStatus("idle");
    };
  }, [code, profile.id, enabled, generation, requestTrack, sendPosition]);

  // Keep a parked rider fresh on everyone's map: no movement, no GPS fixes.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (Date.now() - lastSendRef.current >= POSITION_KEEPALIVE_MS) sendPosition();
    }, POSITION_KEEPALIVE_MS / 2);
    return () => clearInterval(timer);
  }, [enabled, sendPosition]);

  // Android suspends the app in the background and the socket dies with it.
  // Coming back, rejoin at once rather than waiting out a retry timer.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && statusRef.current !== "connected") {
        setGeneration((n) => n + 1);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const republish = useCallback(() => {
    sendPosition();
    requestTrack();
  }, [sendPosition, requestTrack]);

  const announceEnd = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel) return;
    await channel.send({ type: "broadcast", event: "ended", payload: {} });
  }, []);

  /** The roster, with each rider's latest broadcast laid over their presence. */
  const riders = useMemo(
    () =>
      roster.map((entry) => {
        const latest = live[entry.id];
        return latest && latest.updatedAt >= entry.updatedAt ? latest : entry;
      }),
    [roster, live],
  );

  return { status, riders, error, publish, republish, endedSignal, announceEnd };
}
